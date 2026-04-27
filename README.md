# Copa Facil

Web ligera para publicar resultados de una copa y gestionar el contenido desde un unico panel de administrador.

## Ejecutar en local

```bash
npm start
```

Abre `http://localhost:3000`.

Credenciales locales por defecto:

- Usuario: `admin`
- Contrasena: `admin123`

En produccion configura siempre estas variables:

```bash
ADMIN_USER=admin
ADMIN_PASSWORD=una-contrasena-segura
SESSION_SECRET=un-secreto-largo
```

## Despliegue en Render

El archivo `render.yaml` deja preparado un Web Service de Node. Para que los datos no se pierdan entre reinicios, usa un disco persistente montado en `/var/data` y deja:

```bash
DATA_FILE=/var/data/copafacil.json
```

Si creas el servicio manualmente y no has anadido un Persistent Disk en `/var/data`, no configures `DATA_FILE=/var/data/copafacil.json`. La app usara `data/copafacil.json` como almacenamiento temporal. Funcionara, pero Render puede perder los datos al recrear la instancia.

Si ves `EACCES: permission denied, mkdir '/var/data'`, significa que `DATA_FILE` apunta a `/var/data`, pero Render no tiene un disco persistente montado ahi o no puede escribir en esa ruta.

Despues de cada despliegue, si el navegador muestra una version antigua, haz una recarga fuerte. La app actualiza el service worker para evitar que HTML, CSS y JS queden obsoletos.

## Modelo de uso

- Todos los visitantes entran como invitados y solo pueden ver calendario, resultados y clasificacion.
- Los visitantes pueden elegir la temporada que quieren consultar.
- El boton `Admin` abre el inicio de sesion.
- Solo el administrador autenticado puede crear temporadas, editar nombre del torneo, equipos y partidos.
- Cada equipo puede tener un logo propio en PNG, JPG o WEBP. La app lo optimiza antes de guardarlo.
- Al guardar un partido, el administrador puede registrar goleadores, asistentes, tarjetas amarillas/rojas y MVP.
- La vista publica calcula tablas de clasificacion, maximos goleadores, asistentes, tarjetas y MVPs por temporada.
- Desde el panel de administrador puedes exportar un JSON con todas las temporadas, equipos, partidos y estadisticas, e importarlo despues para restaurar esos datos.

## Futuro Android

La interfaz ya incluye `manifest.webmanifest` y `sw.js`, por lo que puede evolucionar a PWA. Si despues quieres publicarla como app Android, el camino natural es envolver esta web con Capacitor y reutilizar la misma API.
