// server.js
//
// Servidor HTTP del modulo de recopilacion documental de Debify.
// Escrito solo con la libreria estandar de Node.js (http, fs, node:sqlite):
// en este entorno no hay acceso al registro de npm, y de este modo el
// proyecto arranca en cualquier maquina con "node server.js", sin
// "npm install" previo. Requiere Node.js 22.5 o superior (por node:sqlite).
//
// Estructura:
//  - Sirve el frontend estatico (public/admin y public/cliente).
//  - Expone /api/admin/... para el panel interno (abogados/administracion).
//  - Expone /api/cliente/:token/... para el formulario del cliente.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const db = require('./db');
const { enviarEmail } = require('./lib/mailer');
const { crearZip } = require('./lib/zip');
const { ejecutarRecordatorios } = require('./scripts/enviar-recordatorios');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_KEY = process.env.ADMIN_KEY || 'cambia-esta-clave';

// IMPORTANTE - PERSISTENCIA: si STORAGE_DIR esta definida (por ejemplo
// /var/data, apuntando a un Disco persistente de Render), los archivos
// subidos por los clientes se guardan ahi y sobreviven a los reinicios del
// servicio. Sin esa variable, se guardan dentro del proyecto (solo valido
// para desarrollo local, se pierden en cada reinicio en hosting con disco
// efimero).
const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------
// Utilidades HTTP
// ---------------------------------------------------------------------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, mensaje) {
  sendJson(res, status, { error: mensaje });
}

function readJsonBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Cuerpo de la petición demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
};

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return sendError(res, 404, 'No encontrado');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function checkAdminKey(req, url) {
  const key = url.searchParams.get('key') || req.headers['x-admin-key'];
  return key && key === ADMIN_KEY;
}

// ---------------------------------------------------------------------
// Progreso -> texto legible para notificaciones
// ---------------------------------------------------------------------

function resumenPendientes(progreso) {
  const bloquesIncompletos = progreso.bloques.filter((b) => b.porcentaje < 100);
  if (bloquesIncompletos.length === 0) return 'Ya no falta nada, ¡expediente completo!';
  return bloquesIncompletos
    .map((b) => `- ${b.nombre}: ${b.completados}/${b.total} completado (${b.porcentaje}%)`)
    .join('\n');
}

function enlaceCliente(token) {
  return `${BASE_URL}/cliente/?token=${token}`;
}

// ---------------------------------------------------------------------
// Rutas: ADMIN (panel interno de abogados / administración)
// ---------------------------------------------------------------------

async function handleAdminApi(req, res, url) {
  if (!checkAdminKey(req, url)) {
    return sendError(res, 401, 'Clave de administración incorrecta o ausente (?key=...)');
  }

  const parts = url.pathname.split('/').filter(Boolean); // ['api','admin', ...]
  const sub = parts.slice(2); // tras 'api','admin'

  // GET o POST /api/admin/recordatorios/probar
  // Fuerza ahora mismo la comprobación de recordatorios de 48h (sin esperar
  // a que pasen esas 48h de verdad). Pensado solo para probar que el envío
  // funciona correctamente. Acepta GET (para poder probarlo abriendo la URL
  // directamente en el navegador) y POST con {"horasAviso": N} en el body,
  // o ?horasAviso=N como parámetro en la URL, para forzar el umbral.
  if (
    (req.method === 'GET' || req.method === 'POST') &&
    sub.length === 2 &&
    sub[0] === 'recordatorios' &&
    sub[1] === 'probar'
  ) {
    const body = req.method === 'POST' ? await readJsonBody(req).catch(() => ({})) : {};
    const horasAvisoQuery = url.searchParams.get('horasAviso');
    const horasAviso =
      typeof body.horasAviso === 'number'
        ? body.horasAviso
        : horasAvisoQuery !== null
        ? Number(horasAvisoQuery)
        : undefined;
    const opciones = typeof horasAviso === 'number' && !Number.isNaN(horasAviso) ? { horasAviso } : undefined;
    const enviados = await ejecutarRecordatorios(opciones);
    return sendJson(res, 200, { enviados });
  }

  // GET /api/admin/expedientes
  if (req.method === 'GET' && sub.length === 1 && sub[0] === 'expedientes') {
    const expedientes = db.listarExpedientes().map((exp) => {
      const progreso = db.calcularProgreso(exp.id);
      return { ...exp, porcentaje: progreso.porcentajeTotal };
    });
    return sendJson(res, 200, { expedientes });
  }

  // POST /api/admin/expedientes
  if (req.method === 'POST' && sub.length === 1 && sub[0] === 'expedientes') {
    const body = await readJsonBody(req);
    if (!body.nombre || !body.email) {
      return sendError(res, 400, 'Nombre y email son obligatorios');
    }
    const expediente = db.crearExpediente({
      nombre: body.nombre,
      email: body.email,
      telefono: body.telefono,
      abogado: body.abogado,
    });
    const link = enlaceCliente(expediente.token);

    await enviarEmail({
      to: expediente.email,
      subject: 'Debify — Documentación para tu expediente de Segunda Oportunidad',
      body:
        `Hola ${expediente.nombre},\n\n` +
        `Para poder preparar tu demanda necesitamos que nos aportes una serie de datos y documentos.\n` +
        `Accede a este enlace personal y ve completándolo a tu ritmo — te iremos indicando qué porcentaje te falta:\n\n` +
        `${link}\n\n` +
        `Un saludo,\nEquipo Debify`,
    });

    return sendJson(res, 201, { expediente, link });
  }

  // GET /api/admin/expedientes/:id
  if (req.method === 'GET' && sub.length === 2 && sub[0] === 'expedientes') {
    const id = Number(sub[1]);
    const expediente = db.getExpedientePorId(id);
    if (!expediente) return sendError(res, 404, 'Expediente no encontrado');
    const progreso = db.calcularProgreso(id);
    return sendJson(res, 200, { expediente, progreso, link: enlaceCliente(expediente.token) });
  }

  // POST /api/admin/expedientes/:id/item/:itemId/rechazar
  if (
    req.method === 'POST' &&
    sub.length === 5 &&
    sub[0] === 'expedientes' &&
    sub[2] === 'item' &&
    sub[4] === 'rechazar'
  ) {
    const id = Number(sub[1]);
    const itemId = Number(sub[3]);
    return rechazarItem(req, res, id, itemId);
  }

  // GET /api/admin/expedientes/:id/item/:itemId/archivo -> abre el documento subido
  // (para que el abogado pueda revisarlo antes de aceptarlo o rechazarlo)
  if (
    req.method === 'GET' &&
    sub.length === 5 &&
    sub[0] === 'expedientes' &&
    sub[2] === 'item' &&
    sub[4] === 'archivo'
  ) {
    const id = Number(sub[1]);
    const itemId = Number(sub[3]);
    const respuesta = db
      .getRespuestasPorExpediente(id)
      .find((r) => r.item_id === itemId);
    if (!respuesta || !respuesta.archivo_path) {
      return sendError(res, 404, 'Este documento no existe o todavía no se ha subido');
    }
    const abs = path.join(__dirname, respuesta.archivo_path);
    if (!fs.existsSync(abs)) {
      return sendError(res, 404, 'El archivo ya no está disponible en el servidor');
    }
    const ext = path.extname(respuesta.archivo_nombre || abs).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const data = fs.readFileSync(abs);
    res.writeHead(200, {
      'Content-Type': contentType,
      // "inline" para que PDFs e imágenes se abran en el navegador en vez de forzar descarga
      'Content-Disposition': `inline; filename="${(respuesta.archivo_nombre || 'documento').replace(/"/g, '')}"`,
      'Content-Length': data.length,
    });
    return res.end(data);
  }

  // POST /api/admin/expedientes/:id/marcar-redaccion
  if (
    req.method === 'POST' &&
    sub.length === 3 &&
    sub[0] === 'expedientes' &&
    sub[2] === 'marcar-redaccion'
  ) {
    const id = Number(sub[1]);
    const expediente = db.getExpedientePorId(id);
    if (!expediente) return sendError(res, 404, 'Expediente no encontrado');
    db.actualizarEstadoExpediente(id, 'en_redaccion');
    db.registrarAuditoria(id, 'abogado', 'marcado_en_redaccion', null);
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/admin/expedientes/:id/descargar  -> ZIP con todos los documentos
  if (
    req.method === 'GET' &&
    sub.length === 3 &&
    sub[0] === 'expedientes' &&
    sub[2] === 'descargar'
  ) {
    const id = Number(sub[1]);
    const expediente = db.getExpedientePorId(id);
    if (!expediente) return sendError(res, 404, 'Expediente no encontrado');

    const respuestas = db.getRespuestasPorExpediente(id).filter((r) => r.archivo_path);
    const entradas = [];
    for (const r of respuestas) {
      const abs = path.join(__dirname, r.archivo_path);
      if (fs.existsSync(abs)) {
        entradas.push({ name: r.archivo_nombre || path.basename(abs), data: fs.readFileSync(abs) });
      }
    }
    if (entradas.length === 0) {
      return sendError(res, 404, 'Este expediente todavía no tiene documentos subidos');
    }
    const zipBuffer = crearZip(entradas);
    const nombreZip = `expediente-${id}-${expediente.nombre.replace(/[^a-z0-9]+/gi, '_')}.zip`;
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nombreZip}"`,
      'Content-Length': zipBuffer.length,
    });
    return res.end(zipBuffer);
  }

  // GET /api/admin/config -> checklist completo (bloques + items)
  if (req.method === 'GET' && sub.length === 1 && sub[0] === 'config') {
    return sendJson(res, 200, { bloques: db.getChecklist() });
  }

  // POST /api/admin/config/bloque
  if (req.method === 'POST' && sub.length === 2 && sub[0] === 'config' && sub[1] === 'bloque') {
    const body = await readJsonBody(req);
    if (!body.nombre) return sendError(res, 400, 'El bloque necesita un nombre');
    const id = db.crearBloque({ nombre: body.nombre, orden: body.orden ?? 99 });
    return sendJson(res, 201, { id });
  }

  // PUT /api/admin/config/bloque/:id
  if (req.method === 'PUT' && sub.length === 3 && sub[0] === 'config' && sub[1] === 'bloque') {
    const body = await readJsonBody(req);
    db.actualizarBloque(Number(sub[2]), body);
    return sendJson(res, 200, { ok: true });
  }

  // DELETE /api/admin/config/bloque/:id
  if (req.method === 'DELETE' && sub.length === 3 && sub[0] === 'config' && sub[1] === 'bloque') {
    db.eliminarBloque(Number(sub[2]));
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/admin/config/item
  if (req.method === 'POST' && sub.length === 2 && sub[0] === 'config' && sub[1] === 'item') {
    const body = await readJsonBody(req);
    if (!body.bloque_id || !body.etiqueta || !body.tipo) {
      return sendError(res, 400, 'bloque_id, tipo y etiqueta son obligatorios');
    }
    const id = db.crearItem(body);
    return sendJson(res, 201, { id });
  }

  // PUT /api/admin/config/item/:id
  if (req.method === 'PUT' && sub.length === 3 && sub[0] === 'config' && sub[1] === 'item') {
    const body = await readJsonBody(req);
    db.actualizarItem(Number(sub[2]), body);
    return sendJson(res, 200, { ok: true });
  }

  // DELETE /api/admin/config/item/:id
  if (req.method === 'DELETE' && sub.length === 3 && sub[0] === 'config' && sub[1] === 'item') {
    db.eliminarItem(Number(sub[2]));
    return sendJson(res, 200, { ok: true });
  }

  return sendError(res, 404, 'Ruta de administración no encontrada');
}

async function rechazarItem(req, res, expedienteId, itemId) {
  const expediente = db.getExpedientePorId(expedienteId);
  if (!expediente) return sendError(res, 404, 'Expediente no encontrado');
  const body = await readJsonBody(req);
  const motivo = body.motivo || 'No se ha especificado el motivo';

  const existente = db
    .getRespuestasPorExpediente(expedienteId)
    .find((r) => r.item_id === itemId);

  db.upsertRespuesta(expedienteId, itemId, {
    estado: 'rechazado',
    valor_texto: existente?.valor_texto ?? null,
    archivo_nombre: existente?.archivo_nombre ?? null,
    archivo_path: existente?.archivo_path ?? null,
    motivo_rechazo: motivo,
  });
  db.registrarAuditoria(expedienteId, 'abogado', 'item_rechazado', `item ${itemId}: ${motivo}`);

  if (expediente.estado !== 'en_progreso') {
    db.actualizarEstadoExpediente(expedienteId, 'en_progreso');
  }

  await enviarEmail({
    to: expediente.email,
    subject: 'Debify — Necesitamos que revises un documento de tu expediente',
    body:
      `Hola ${expediente.nombre},\n\n` +
      `Hemos revisado tu expediente y necesitamos que corrijas lo siguiente:\n\n` +
      `${motivo}\n\n` +
      `Puedes hacerlo desde tu enlace personal:\n${enlaceCliente(expediente.token)}\n\n` +
      `Un saludo,\nEquipo Debify`,
  });

  return sendJson(res, 200, { ok: true });
}

// ---------------------------------------------------------------------
// Rutas: CLIENTE (formulario público por token)
// ---------------------------------------------------------------------

function expedienteParaCliente(expediente) {
  // No exponemos el token de vuelta ni datos internos innecesarios.
  return {
    id: expediente.id,
    nombre: expediente.nombre,
    estado: expediente.estado,
  };
}

async function handleClienteApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','cliente', token, ...]
  const token = parts[2];
  const expediente = token && db.getExpedientePorToken(token);
  if (!expediente) return sendError(res, 404, 'Enlace no válido o expediente no encontrado');

  const sub = parts.slice(3);

  // GET /api/cliente/:token  -> estado del expediente + checklist con progreso
  if (req.method === 'GET' && sub.length === 0) {
    const progreso = db.calcularProgreso(expediente.id);
    return sendJson(res, 200, { expediente: expedienteParaCliente(expediente), progreso });
  }

  // POST /api/cliente/:token/item/:itemId/texto   { valor }
  if (req.method === 'POST' && sub.length === 3 && sub[0] === 'item' && sub[2] === 'texto') {
    const itemId = Number(sub[1]);
    const body = await readJsonBody(req);
    const valor = (body.valor ?? '').toString().trim();
    if (!valor) return sendError(res, 400, 'El valor no puede estar vacío');

    db.upsertRespuesta(expediente.id, itemId, {
      estado: 'aportado',
      valor_texto: valor,
    });
    db.registrarAuditoria(expediente.id, 'cliente', 'campo_respondido', `item ${itemId}`);

    return finalizarActualizacion(res, expediente);
  }

  // POST /api/cliente/:token/item/:itemId/archivo   { nombre, contenido_base64 }
  if (req.method === 'POST' && sub.length === 3 && sub[0] === 'item' && sub[2] === 'archivo') {
    const itemId = Number(sub[1]);
    const body = await readJsonBody(req);
    const { nombre, contenido_base64: contenidoBase64 } = body;
    if (!nombre || !contenidoBase64) {
      return sendError(res, 400, 'Faltan el nombre o el contenido del archivo');
    }

    let buffer;
    try {
      buffer = Buffer.from(contenidoBase64, 'base64');
    } catch (err) {
      return sendError(res, 400, 'Archivo inválido');
    }
    if (buffer.length === 0) return sendError(res, 400, 'El archivo está vacío');
    if (buffer.length > 20 * 1024 * 1024) {
      return sendError(res, 400, 'El archivo supera el límite de 20 MB');
    }

    const carpetaExpediente = path.join(UPLOADS_DIR, String(expediente.id));
    if (!fs.existsSync(carpetaExpediente)) fs.mkdirSync(carpetaExpediente, { recursive: true });

    const nombreSeguro = `${itemId}-${Date.now()}-${nombre.replace(/[^a-zA-Z0-9._-]+/g, '_')}`;
    const destino = path.join(carpetaExpediente, nombreSeguro);
    fs.writeFileSync(destino, buffer);

    const rutaRelativa = path.relative(__dirname, destino);
    db.upsertRespuesta(expediente.id, itemId, {
      estado: 'aportado',
      archivo_nombre: nombre,
      archivo_path: rutaRelativa,
    });
    db.registrarAuditoria(expediente.id, 'cliente', 'documento_subido', `item ${itemId}: ${nombre}`);

    return finalizarActualizacion(res, expediente);
  }

  return sendError(res, 404, 'Ruta de cliente no encontrada');
}

// Tras cada respuesta del cliente: recalcula progreso, marca 100% si toca,
// y avisa al abogado por email la primera vez que se completa.
async function finalizarActualizacion(res, expediente) {
  const progreso = db.calcularProgreso(expediente.id);

  if (progreso.porcentajeTotal >= 100 && expediente.estado === 'en_progreso') {
    db.actualizarEstadoExpediente(expediente.id, 'completo');
    db.registrarAuditoria(expediente.id, 'sistema', 'expediente_completado', null);

    await enviarEmail({
      to: 'equipo-legal@debify.es', // TODO: usar el email real del abogado asignado (campo "abogado")
      subject: `Debify — Expediente de ${expediente.nombre} completo al 100%`,
      body:
        `El cliente ${expediente.nombre} (${expediente.email}) ha completado toda la documentación obligatoria.\n\n` +
        `Ya se puede revisar y redactar la demanda.\n\n` +
        `Panel: ${BASE_URL}/admin/?key=${ADMIN_KEY}`,
    });
  }

  const expedienteActualizado = db.getExpedientePorId(expediente.id);
  return sendJson(res, 200, {
    expediente: expedienteParaCliente(expedienteActualizado),
    progreso,
  });
}

// ---------------------------------------------------------------------
// Servidor HTTP y enrutado principal
// ---------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    // --- API ---
    if (url.pathname.startsWith('/api/admin')) {
      return await handleAdminApi(req, res, url);
    }
    if (url.pathname.startsWith('/api/cliente')) {
      return await handleClienteApi(req, res, url);
    }

    // --- Frontend estático ---
    if (url.pathname === '/' ) {
      res.writeHead(302, { Location: '/admin/' });
      return res.end();
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      return serveStatic(res, path.join(PUBLIC_DIR, 'admin', 'index.html'));
    }
    if (url.pathname === '/cliente' || url.pathname === '/cliente/') {
      return serveStatic(res, path.join(PUBLIC_DIR, 'cliente', 'index.html'));
    }
    if (url.pathname.startsWith('/admin/')) {
      return serveStatic(res, path.join(PUBLIC_DIR, 'admin', url.pathname.replace('/admin/', '')));
    }
    if (url.pathname.startsWith('/cliente/')) {
      return serveStatic(res, path.join(PUBLIC_DIR, 'cliente', url.pathname.replace('/cliente/', '')));
    }

    return sendError(res, 404, 'No encontrado');
  } catch (err) {
    console.error(err);
    return sendError(res, 500, 'Error interno del servidor: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`\nDebify · módulo de documentación (Segunda Oportunidad)`);
  console.log(`Panel interno:  ${BASE_URL}/admin/?key=${ADMIN_KEY}`);
  console.log(`(los enlaces de cada cliente se generan al crear su expediente)\n`);
});

// ---------------------------------------------------------------------
// Recordatorios automáticos cada 48h de inactividad
// ---------------------------------------------------------------------
// Se comprueba cada hora, mientras el servidor está encendido, si algún
// expediente lleva 48h sin actividad y sin estar al 100%. No hace falta un
// Cron Job aparte de Render: un servicio aparte no podría leer el mismo
// disco persistente donde está la base de datos.
const UNA_HORA_MS = 60 * 60 * 1000;
function comprobarRecordatorios() {
  ejecutarRecordatorios().catch((err) => {
    console.error('Error comprobando recordatorios:', err.message);
  });
}
comprobarRecordatorios(); // primera comprobación nada más arrancar
setInterval(comprobarRecordatorios, UNA_HORA_MS);
