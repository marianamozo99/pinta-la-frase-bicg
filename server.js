'use strict';
// Servidor de "El cambio, en trazos" (BICG). Sin dependencias: solo Node 18+.
// Estado en memoria; las salas se borran tras 12 h sin actividad.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'public', 'index.html');
const MAX_BODY = 300 * 1024;
const MAX_PARTICIPANTS = 80;
const MAX_ROOMS = 500;
const ROOM_TTL = 12 * 3600 * 1000;
const GRACE_MS = 5000;           // margen tras el fin del tiempo para recibir los últimos dibujos
const DEFAULT_DURATION = 90000;  // 1 min 30 s
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CANVAS_W = 960, CANVAS_H = 600;

const rooms = new Map();

function newCode() {
  let c;
  do {
    c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  } while (rooms.has(c));
  return c;
}

function safeEq(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function publicId(pid) {
  return crypto.createHash('sha256').update(pid).digest('hex').slice(0, 10);
}

// Lo que ve cada cliente. Los dibujos de los demás solo se envían al revelar.
function view(room, cl, full) {
  const idle = room.phase === 'idle';
  const cur = idle ? [] : [...room.drawings.values()].filter(d => d.round === room.round);
  const online = new Set([...room.clients].filter(c => !c.isHost && c.pid).map(c => c.pid)).size;
  const v = {
    phrase: idle ? '' : room.phrase, phase: room.phase, round: room.round,
    showNames: room.showNames, count: cur.length, online, host: cl.isHost,
    endAt: room.endAt, now: Date.now()
  };
  if (room.phase === 'reveal') {
    v.drawings = cur.sort((a, b) => a.t - b.t).map(d => ({
      id: d.id,
      t: d.t,
      name: room.showNames ? d.name : '',
      strokes: d.strokes,
      mine: d.pid === cl.pid
    }));
  } else if (room.phase === 'draw' && full && cl.pid) {
    const m = room.drawings.get(cl.pid);
    if (m && m.round === room.round) v.mine = { strokes: m.strokes };
  }
  return v;
}

function send(cl, v) {
  try { cl.res.write('event: state\ndata: ' + JSON.stringify(v) + '\n\n'); } catch (e) {}
}
function broadcast(room, except) {
  room.touched = Date.now();
  for (const cl of room.clients) if (cl !== except) send(cl, view(room, cl, false));
}

// A los 90 s (+ margen) la galería se abre sola.
function scheduleReveal(room, ms) {
  clearTimeout(room.timer);
  const round = room.round;
  room.timer = setTimeout(() => {
    room.timer = null;
    if (room.phase === 'draw' && room.round === round) {
      room.phase = 'reveal';
      broadcast(room);
    }
  }, ms);
}

function cleanStrokes(s) {
  if (!Array.isArray(s) || s.length > 600) return null;
  const out = [];
  let pts = 0;
  for (const x of s) {
    if (!x || typeof x.c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(x.c)) return null;
    if (typeof x.w !== 'number' || !Array.isArray(x.p)) return null;
    if (x.p.length % 2 || x.p.length > 8000) return null;
    pts += x.p.length;
    if (pts > 40000) return null;
    const p = x.p.map((n, i) => {
      const max = i % 2 ? CANVAS_H : CANVAS_W;
      return Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
    });
    out.push({ c: x.c, w: Math.max(1, Math.min(60, x.w)), p });
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: https://bicg.com; " +
  "connect-src 'self'; frame-ancestors 'none'";

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      fs.readFile(INDEX, (err, data) => {
        if (err) return json(res, 500, { error: 'no index' });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer'
        });
        res.end(data);
      });
      return;
    }
    if (p === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });

    if (req.method === 'POST' && p === '/api/rooms') {
      if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'Servidor lleno, inténtalo más tarde.' });
      const code = newCode();
      const hostKey = crypto.randomBytes(16).toString('hex');
      rooms.set(code, {
        code, hostKey, phrase: '', phase: 'idle', round: 0, showNames: true, endAt: 0, timer: null,
        drawings: new Map(), clients: new Set(), touched: Date.now()
      });
      return json(res, 201, { code, hostKey });
    }

    const m = p.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/([a-z]+))?$/);
    if (!m) return json(res, 404, { error: 'not found' });
    const room = rooms.get(m[1]);
    if (!room) return json(res, 404, { error: 'Sesión no encontrada' });
    const action = m[2];

    if (req.method === 'GET' && !action) return json(res, 200, { ok: true, code: room.code });

    if (req.method === 'GET' && action === 'events') {
      const pid = String(u.searchParams.get('pid') || '');
      const cl = {
        res,
        pid: /^[\w-]{8,64}$/.test(pid) ? pid : null,
        isHost: safeEq(u.searchParams.get('k'), room.hostKey)
      };
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 2000\n\n');
      room.clients.add(cl);
      send(cl, view(room, cl, true));
      broadcast(room, cl); // actualiza el contador de conectados a los demás
      const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch (e) {} }, 25000);
      req.on('close', () => { clearInterval(ka); room.clients.delete(cl); broadcast(room); });
      return;
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    const body = await readBody(req);
    const isHost = safeEq(body.k, room.hostKey);
    room.touched = Date.now();

    // Comenzar una ronda: fija la consigna y arranca la cuenta atrás.
    if (action === 'phrase') {
      if (!isHost) return json(res, 403, { error: 'Solo el facilitador' });
      const phrase = String(body.phrase || '').trim().slice(0, 200);
      if (!phrase) return json(res, 400, { error: 'Falta la frase' });
      const dur = Math.max(10000, Math.min(1800000, Number(body.duration) || DEFAULT_DURATION));
      room.phrase = phrase;
      room.phase = 'draw';
      room.round += 1;
      room.endAt = Date.now() + dur;
      if (typeof body.showNames === 'boolean') room.showNames = body.showNames;
      scheduleReveal(room, dur + GRACE_MS);
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    // 'reveal' muestra la galería; 'idle' prepara una nueva ronda.
    if (action === 'phase') {
      if (!isHost) return json(res, 403, { error: 'Solo el facilitador' });
      if (body.phase !== 'idle' && body.phase !== 'reveal') return json(res, 400, { error: 'Fase no válida' });
      if (body.phase === 'reveal' && room.phase === 'idle') return json(res, 400, { error: 'Aún no hay ronda' });
      clearTimeout(room.timer);
      room.timer = null;
      room.phase = body.phase;
      if (body.phase === 'idle') room.endAt = 0;
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    if (action === 'names') {
      if (!isHost) return json(res, 403, { error: 'Solo el facilitador' });
      room.showNames = !!body.showNames;
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    if (action === 'remove') {
      if (!isHost) return json(res, 403, { error: 'Solo el facilitador' });
      for (const [pid, d] of room.drawings) if (d.id === body.id) room.drawings.delete(pid);
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    // Dibujos de ejemplo para explorar la galería (solo el facilitador, fuera de una ronda en curso).
    if (action === 'demo') {
      if (!isHost) return json(res, 403, { error: 'Solo el facilitador' });
      if (room.phase === 'draw') return json(res, 409, { error: 'Los ejemplos solo están disponibles antes o después de la ronda.' });
      const items = Array.isArray(body.items) ? body.items.slice(0, 6) : [];
      if (room.round === 0) room.round = 1;
      if (room.phase === 'idle') room.phrase = String(body.phrase || '').trim().slice(0, 200) || 'Ejemplo';
      items.forEach((it, i) => {
        const strokes = cleanStrokes(it && it.strokes);
        if (!strokes || !strokes.length) return;
        const pid = 'demo-' + i;
        room.drawings.set(pid, {
          pid, id: publicId(pid), round: room.round, strokes,
          name: String((it && it.name) || 'Ejemplo').trim().slice(0, 30) || 'Ejemplo',
          t: Date.now() + i
        });
      });
      clearTimeout(room.timer);
      room.timer = null;
      room.phase = 'reveal';
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    if (action === 'drawing') {
      if (room.phase !== 'draw') return json(res, 409, { error: 'Ahora no se pueden enviar dibujos.' });
      if (Date.now() > room.endAt + GRACE_MS + 1000) return json(res, 409, { error: 'El tiempo ha terminado.' });
      const pid = String(body.pid || '');
      if (!/^[\w-]{8,64}$/.test(pid)) return json(res, 400, { error: 'Identificador no válido' });
      if (!room.drawings.has(pid) && room.drawings.size >= MAX_PARTICIPANTS)
        return json(res, 429, { error: 'La sesión está llena.' });
      const strokes = cleanStrokes(body.strokes);
      if (!strokes || !strokes.length) return json(res, 400, { error: 'Dibujo no válido' });
      room.drawings.set(pid, {
        pid, id: publicId(pid), round: room.round, strokes,
        name: String(body.name || 'Participante').trim().slice(0, 45) || 'Participante',
        t: Date.now()
      });
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'error' });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - r.touched > ROOM_TTL && r.clients.size === 0) { clearTimeout(r.timer); rooms.delete(code); }
  }
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log('El cambio, en trazos en http://localhost:' + PORT));
}
module.exports = server;
