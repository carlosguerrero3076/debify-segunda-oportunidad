# Debify — Módulo de documentación (sustituto de Parallel)

Software propio para reemplazar Parallel (600 €/mes) en el único uso que
Debify le da hoy: enviar a cada cliente un enlace por email con un
cuestionario guiado que recopila la información y documentos exigidos por la
Ley Concursal / Ley de Segunda Oportunidad, mostrando en todo momento el %
de expediente completado, hasta que el abogado puede redactar la demanda.

## Cómo funciona (resumen)

1. El abogado da de alta un expediente desde el panel interno con el nombre
   y email del cliente.
2. El sistema genera un enlace único y personal, y "envía" un email al
   cliente (de momento simulado, ver más abajo).
3. El cliente abre el enlace, sin necesidad de registrarse, y va rellenando
   campos y subiendo documentos organizados por bloques (identidad,
   ingresos, cuentas bancarias, deudas, patrimonio, crédito público).
4. El % de completado se recalcula al instante, en global y por bloque.
5. El abogado ve el estado de todos los expedientes desde el panel, puede
   rechazar un documento con un motivo (el cliente lo ve y lo vuelve a
   subir), y descargar toda la documentación de un expediente en un .zip.
6. Al llegar al 100 %, el sistema avisa automáticamente al equipo legal.

El checklist de bloques y documentos **no está grabado a fuego en el
código**: se edita desde "Configuración del checklist" en el panel, así que
si el despacho cambia de criterio o la ley cambia, no hace falta tocar nada
de programación.

## Requisitos

- Node.js **22.5 o superior** (usa el módulo nativo `node:sqlite`, por eso
  no hace falta instalar nada con `npm install`: este proyecto no tiene
  dependencias externas). Comprueba tu versión con `node -v`.

  > Nota: en el entorno donde se ha construido este proyecto no había acceso
  > al registro de npm, así que todo está hecho con la librería estándar de
  > Node (servidor HTTP, base de datos SQLite embebida, generación de ZIP).
  > Es intencionado y no falta nada por instalar. Si en vuestro entorno de
  > desarrollo sí tenéis acceso a npm y preferís usar Express/Postgres/etc.,
  > es una migración sencilla porque toda la lógica de datos está aislada en
  > `db.js`.

## Puesta en marcha

```bash
# 1. Copiar la configuración de ejemplo (opcional, funciona sin hacerlo)
cp .env.example .env
# Edita .env y cambia especialmente ADMIN_KEY antes de usarlo en serio.

# 2. Arrancar
node server.js
```

Verás algo así:

```
Panel interno:  http://localhost:3000/admin/?key=cambia-esta-clave
```

Abre esa URL en el navegador (la clave se guarda automáticamente para no
tener que volver a escribirla). Desde ahí:

- **Expedientes**: crea un expediente nuevo → se genera el enlace del
  cliente y se registra el email "enviado".
- **Configuración del checklist**: añade, edita o elimina bloques y
  documentos/campos.

El enlace de cada cliente tiene esta forma:
`http://localhost:3000/cliente/?token=xxxxxxxx` — no necesita contraseña,
el token del enlace es su acceso.

## Envío de emails (importante)

**De momento los emails NO se envían de verdad.** Se escriben en
`data/emails.log` y en la consola del servidor, para poder probar todo el
flujo sin depender de un proveedor. Cuando queráis activarlo:

1. Contratad un proveedor transaccional (SendGrid, Postmark, Amazon SES, o
   vuestro propio SMTP).
2. Editad `lib/mailer.js` y sustituid el cuerpo de `enviarEmail()` por la
   llamada real a la API de ese proveedor (hay un ejemplo comentado con
   SendGrid dentro del archivo). El resto de la aplicación no cambia.

## Recordatorios automáticos

`scripts/enviar-recordatorios.js` avisa a los clientes que llevan 3 o 7 días
sin actividad y no han llegado al 100 %. No depende de que el servidor esté
encendido. Para automatizarlo, añadid una tarea programada (cron) que lo
ejecute una vez al día, por ejemplo:

```
0 9 * * *  cd /ruta/al/proyecto && node scripts/enviar-recordatorios.js
```

## Seguridad — pendiente antes de producción

Este MVP resuelve la funcionalidad, pero antes de usarlo con datos reales
de clientes hay que reforzar:

- **Autenticación real del panel interno.** Ahora mismo se protege con una
  única clave compartida (`ADMIN_KEY`). Para un despacho con varios
  abogados hace falta login por usuario y registro de quién hace qué
  (ya existe una tabla `auditoria` que registra las acciones, pero no
  usuarios identificados individualmente).
- **HTTPS** en producción (este servidor de ejemplo habla HTTP plano;
  desplegadlo detrás de un proxy con TLS, o añadid un certificado).
- **Copias de seguridad** periódicas de `data/debify.sqlite` y de la
  carpeta `uploads/` (ahí vive toda la documentación de los clientes).
- Revisar con vuestro DPO/asesoría el tratamiento de datos personales y
  financieros (RGPD) — cifrado en reposo del volumen donde corra esto,
  política de retención y borrado, etc.

## Estructura del proyecto

```
server.js                  Servidor HTTP y rutas de la API
db.js                       Base de datos (SQLite embebida) y lógica de negocio
lib/mailer.js                Envío de emails (stub, sustituible)
lib/zip.js                   Generador de .zip sin dependencias
scripts/enviar-recordatorios.js   Recordatorios de inactividad
public/admin/                Panel interno (abogados/administración)
public/cliente/               Formulario público del cliente
data/                         Base de datos y log de emails (se crea sola)
uploads/                       Documentos subidos por los clientes
```

## Próximos pasos sugeridos

- Añadir firma electrónica antes de la fase de redacción.
- Añadir verificación automática (OCR) de los documentos subidos.
- Login individual por abogado, con permisos.
- Cuando se aborde la sustitución de HubSpot, decidir si ese módulo vive en
  el mismo proyecto o en uno separado que comparta la misma base de datos
  de clientes.
