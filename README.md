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

Si despliegas sin disco persistente, la app funciona, pero Render puede perder los datos guardados al recrear la instancia.

## Modelo de uso

- Todos los visitantes entran como invitados y solo pueden ver calendario, resultados y clasificacion.
- El boton `Admin` abre el inicio de sesion.
- Solo el administrador autenticado puede editar nombre del torneo, equipos y partidos.

## Futuro Android

La interfaz ya incluye `manifest.webmanifest` y `sw.js`, por lo que puede evolucionar a PWA. Si despues quieres publicarla como app Android, el camino natural es envolver esta web con Capacitor y reutilizar la misma API.
