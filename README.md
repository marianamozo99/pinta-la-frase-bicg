# El cambio, en trazos (BICG)

Dinámica de grupo con la interfaz de «El cambio, en trazos»: el facilitador pone la consigna, cada participante la dibuja durante 1 minuto y 30 segundos desde su dispositivo y, al terminar el tiempo, la galería se abre sola para todos.

A diferencia de la versión con PeerJS, aquí los navegadores no se conectan entre sí: todos hablan con un pequeño servidor. Por eso no dependen de firewalls ni de NAT, y el facilitador puede recargar la página sin perder la sesión.

- Sin cuentas: los participantes entran con un enlace o un código de 6 caracteres y su nombre.
- Los dibujos de los demás no llegan a ningún navegador hasta que se muestra la galería (ni siquiera al del facilitador).
- Sin dependencias: solo Node 18 o superior.

## Probar en tu ordenador

```
node server.js
```

Abre http://localhost:3000 y pulsa «Soy facilitador/a · Crear sesión». Para probar como participante usa otro navegador o una ventana de incógnito (el navegador del facilitador recuerda que es facilitador de esa sesión).

## Publicarla en internet (Render, gratis)

1. Sube el contenido de esta carpeta a un repositorio de GitHub (`server.js`, `package.json`, `README.md` y la carpeta `public`, en la raíz del repositorio).
2. En https://render.com crea un **Web Service** con ese repositorio: Language **Node**, Build Command `npm install`, Start Command `node server.js`, Instance Type **Free**.
3. Render te dará una dirección tipo `https://tu-nombre.onrender.com`.

Si ya tenías publicada otra versión en Render, o bien reemplazas los archivos del repositorio (Render se actualiza solo) o bien creas un repositorio y un servicio nuevos.

## Cómo se usa

1. El facilitador abre la dirección y pulsa «Soy facilitador/a · Crear sesión».
2. Comparte el enlace de invitación o el código de 6 caracteres.
3. Los participantes escriben su nombre y esperan.
4. El facilitador edita la consigna y pulsa «Comenzar 1:30».
5. Cada participante dibuja. Puede enviar antes de tiempo (y modificar mientras quede tiempo), o dejar que se envíe solo al acabar la cuenta atrás.
6. A los 90 segundos, más un margen de 5 para recibir los últimos dibujos, la galería aparece sola. El facilitador también puede pulsar «Mostrar dibujos» antes.
7. El facilitador puede descargar la galería como HTML autónomo, proyectarla en pantalla completa, ocultar los nombres o quitar un dibujo desde la vista ampliada.

## Cosas a tener en cuenta

- Las sesiones viven en la memoria del servidor: si el servidor se reinicia, se pierden. En el plan gratuito de Render el servicio se duerme tras 15 minutos sin visitas y tarda cerca de un minuto en despertar: ábrelo unos minutos antes de empezar.
- El facilitador, si recarga o cambia de dispositivo, vuelve a entrar con su enlace de facilitador (botón «Copiar enlace de facilitador»). No lo compartas.
- Una sesión admite hasta 80 participantes y se borra tras 12 horas sin actividad.
- El logo se carga desde la web de BICG; si no está disponible, la página funciona igual sin él.
- Los ejemplos de prueba sirven para explorar la galería y no corresponden a participantes reales.
