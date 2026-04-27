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

El archivo `render.yaml` deja preparado un Web Service de Node conectado a Firestore. En este modo no hace falta Persistent Disk ni `DATA_FILE`.

Si creas el servicio manualmente, configura las variables de Firestore de la seccion `Almacenamiento`. Para volver al modo de pruebas local con JSON, usa `DATA_STORE=json`.

Si ves `EACCES: permission denied, mkdir '/var/data'`, elimina `DATA_FILE` de las variables de entorno de Render o cambia `DATA_STORE` a `json` solo para pruebas.

Despues de cada despliegue, si el navegador muestra una version antigua, haz una recarga fuerte. La app actualiza el service worker para evitar que HTML, CSS y JS queden obsoletos.

## Almacenamiento

Por defecto la app usa JSON local. Esto permite desarrollar y probar sin crear ningun servicio externo:

```bash
DATA_STORE=json
DATA_FILE=./data/copafacil.json
```

Tambien queda preparada para Firestore. En ese modo no hace falta `DATA_FILE` ni disco persistente en Render:

```bash
DATA_STORE=firestore
FIREBASE_PROJECT_ID=tu-proyecto
FIREBASE_CLIENT_EMAIL=cuenta-servicio@tu-proyecto.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIRESTORE_COLLECTION=copaFacil
FIRESTORE_DOCUMENT=production
```

Como alternativa, en vez de separar las credenciales puedes pasar el JSON completo de la cuenta de servicio en una de estas variables:

```bash
FIREBASE_SERVICE_ACCOUNT_JSON={...}
FIREBASE_SERVICE_ACCOUNT_BASE64=...
```

Para hacer la adaptacion final a Firestore necesito:

- ID del proyecto Firebase.
- Credenciales de una cuenta de servicio con permiso para leer y escribir Firestore.
- Nombre de la coleccion y documento que quieres usar, si no quieres los valores por defecto `copaFacil/production`.
- No guardes estas credenciales en el repositorio. Configuralas solo como variables de entorno en Render.
- Si una clave privada se comparte por error, borra esa clave y genera una nueva desde Firebase.

### Firestore sin Storage

Como no se va a usar Firebase Storage, los logos se guardan optimizados dentro de Firestore junto al equipo. La app limita cada logo a unos 70 KB y lo convierte a WEBP antes de enviarlo al servidor. Esto es suficiente para escudos pequenos, pero conviene mantener imagenes simples para no acercarse al limite de tamano de documento de Firestore.

## Modelo de uso

- Todos los visitantes entran como invitados y solo pueden ver calendario, resultados y clasificacion.
- Los visitantes pueden elegir la temporada que quieren consultar.
- El boton `Admin` abre el inicio de sesion.
- Solo el administrador autenticado puede crear temporadas, editar nombre del torneo, equipos y partidos.
- Cada equipo puede tener un logo propio en PNG, JPG o WEBP. La app lo optimiza antes de guardarlo.
- Cada temporada puede definir un numero de jornadas y la vista publica permite filtrar los partidos por jornada.
- Al guardar un partido, el administrador puede registrar goleadores, asistentes, tarjetas amarillas/rojas y MVP.
- La vista publica calcula tablas de clasificacion, maximos goleadores, asistentes, tarjetas y MVPs por temporada.
- Cada visitante puede marcar equipos favoritos en su navegador y activar notificaciones locales de resultados mientras la web/PWA este abierta.

## PWA y futuro Android

La web incluye `manifest.webmanifest`, iconos instalables y `sw.js`. En navegadores compatibles se puede anadir a la pantalla de inicio y conservar una copia cacheada de la vista publica. Cuando se despliega una nueva version, la PWA muestra un aviso para actualizar. Si despues quieres publicarla como app Android, el camino natural es envolver esta web con Capacitor y reutilizar la misma API.

Las notificaciones actuales son locales: funcionan cuando la web o la PWA esta abierta y comprueba nuevos resultados. Para avisos con la app completamente cerrada haria falta implementar Web Push con suscripciones por dispositivo.
