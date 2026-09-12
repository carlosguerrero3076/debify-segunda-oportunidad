// db.js
// Capa de datos. Usa el modulo nativo node:sqlite (Node >= 22.5) para no
// depender de paquetes externos ni de instalar nada con npm: el proyecto
// funciona con "node server.js" y ya esta.
//
// IMPORTANTE - PERSISTENCIA: en Render (y en cualquier hosting con disco
// efimero) los archivos escritos en la carpeta del proyecto desaparecen
// cada vez que el servicio se reinicia o "duerme". Para que los expedientes
// y documentos no se pierdan, hay que montar un Disco persistente y decirle
// a la app donde esta, con la variable de entorno STORAGE_DIR (por ejemplo
// STORAGE_DIR=/var/data). Sin esa variable, se sigue guardando dentro del
// proyecto como hasta ahora (valido solo para desarrollo local).
//
// Si en el futuro preferis Postgres/MySQL (por ejemplo para compartir base
// de datos con el resto del software de Debify), esta es la unica capa que
// habria que reescribir: el resto de la aplicacion solo llama a las
// funciones exportadas aqui.

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const DATA_DIR = path.join(STORAGE_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'debify.sqlite');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS bloques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bloque_id INTEGER NOT NULL REFERENCES bloques(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('campo','documento')),
  etiqueta TEXT NOT NULL,
  ayuda TEXT,
  obligatorio INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expedientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  telefono TEXT,
  abogado TEXT,
  token TEXT UNIQUE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'en_progreso',
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  recordatorio_3d_enviado INTEGER NOT NULL DEFAULT 0,
  recordatorio_7d_enviado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS respuestas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expediente_id INTEGER NOT NULL REFERENCES expedientes(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','aportado','rechazado')),
  valor_texto TEXT,
  archivo_nombre TEXT,
  archivo_path TEXT,
  motivo_rechazo TEXT,
  updated_at TEXT,
  UNIQUE(expediente_id, item_id)
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expediente_id INTEGER NOT NULL,
  actor TEXT NOT NULL,
  accion TEXT NOT NULL,
  detalle TEXT,
  created_at TEXT NOT NULL
);
`);

// --- Migracion: columna para el recordatorio recurrente cada 48h ---
// (las columnas recordatorio_3d_enviado / recordatorio_7d_enviado se dejan
// tal cual, sin usarlas ya, para no romper filas antiguas)
try {
  db.exec('ALTER TABLE expedientes ADD COLUMN ultimo_recordatorio_at TEXT');
} catch (err) {
  // ya existe la columna (SQLite no soporta "ADD COLUMN IF NOT EXISTS")
}

// --- Seed: checklist documental por defecto (editable luego desde el panel) ---
function seedChecklistSiVacio() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM bloques').get();
  if (count > 0) return;

  const bloques = [
    {
      nombre: 'Identidad y situación familiar',
      items: [
        ['documento', 'Copia del DNI / NIE en vigor', null, 1],
        ['campo', 'Estado civil', 'Soltero/a, casado/a, divorciado/a, viudo/a...', 1],
        ['campo', 'Régimen económico matrimonial', 'Gananciales, separación de bienes... (si aplica)', 0],
        ['documento', 'Libro de familia o certificado de matrimonio', 'Solo si estás casado/a', 0],
      ],
    },
    {
      nombre: 'Ingresos',
      items: [
        ['documento', 'Últimas 3 nóminas o certificado de ingresos/prestación', null, 1],
        ['documento', 'Última declaración de la Renta (IRPF)', null, 1],
        ['campo', '¿Eres o has sido autónomo en los últimos 2 años?', 'Responde sí o no', 1],
        ['documento', 'Declaraciones fiscales de autónomo (IVA, IRPF trimestral)', 'Solo si eres/has sido autónomo', 0],
      ],
    },
    {
      nombre: 'Información bancaria',
      items: [
        ['documento', 'Extractos bancarios de los últimos 6 meses (todas tus cuentas)', null, 1],
        ['campo', 'Entidades bancarias en las que tienes cuenta abierta', 'Indica el nombre de cada banco', 1],
      ],
    },
    {
      nombre: 'Deudas y garantías',
      items: [
        ['documento', 'Listado de acreedores con importes pendientes', 'Bancos, tarjetas, préstamos, particulares...', 1],
        ['documento', 'Contratos de préstamos, tarjetas de crédito o avales', null, 1],
        ['campo', 'Número aproximado de acreedores', null, 1],
      ],
    },
    {
      nombre: 'Patrimonio y cargas',
      items: [
        ['documento', 'Escrituras de propiedad (vivienda u otros inmuebles)', 'Si tienes bienes inmuebles', 0],
        ['documento', 'Nota simple del Registro de la Propiedad', null, 0],
        ['documento', 'Último recibo del IBI', null, 0],
        ['campo', '¿Tienes vehículos a tu nombre?', 'Indica marca, modelo y año aproximado', 1],
      ],
    },
    {
      nombre: 'Crédito público',
      items: [
        ['documento', 'Certificado de deudas con la AEAT (Hacienda)', null, 1],
        ['documento', 'Certificado de deudas con la TGSS (Seguridad Social)', null, 1],
        ['documento', 'Declaraciones de impuestos de los últimos 3 años', 'Solo si hay procedimiento de liquidación', 0],
      ],
    },
  ];

  const insBloque = db.prepare('INSERT INTO bloques (nombre, orden) VALUES (?, ?)');
  const insItem = db.prepare(
    'INSERT INTO items (bloque_id, tipo, etiqueta, ayuda, obligatorio, orden) VALUES (?, ?, ?, ?, ?, ?)'
  );

  bloques.forEach((bloque, bIdx) => {
    insBloque.run(bloque.nombre, bIdx);
    const bloqueId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
    bloque.items.forEach((item, iIdx) => {
      const [tipo, etiqueta, ayuda, obligatorio] = item;
      insItem.run(bloqueId, tipo, etiqueta, ayuda, obligatorio, iIdx);
    });
  });
}
seedChecklistSiVacio();

// ---------- Helpers ----------
function nowIso() {
  return new Date().toISOString();
}

function generarToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function registrarAuditoria(expedienteId, actor, accion, detalle) {
  db.prepare(
    'INSERT INTO auditoria (expediente_id, actor, accion, detalle, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(expedienteId, actor, accion, detalle ?? null, nowIso());
}

// ---------- Checklist / configuracion ----------
function getChecklist() {
  const bloques = db.prepare('SELECT * FROM bloques ORDER BY orden, id').all();
  const items = db.prepare('SELECT * FROM items ORDER BY orden, id').all();
  return bloques.map((b) => ({
    ...b,
    items: items.filter((i) => i.bloque_id === b.id),
  }));
}

function crearBloque({ nombre, orden }) {
  db.prepare('INSERT INTO bloques (nombre, orden) VALUES (?, ?)').run(
    nombre,
    orden ?? 0
  );
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

function actualizarBloque(id, { nombre, orden }) {
  db.prepare('UPDATE bloques SET nombre = ?, orden = ? WHERE id = ?').run(
    nombre,
    orden ?? 0,
    id
  );
}

function eliminarBloque(id) {
  db.prepare('DELETE FROM bloques WHERE id = ?').run(id);
}

function crearItem({ bloque_id, tipo, etiqueta, ayuda, obligatorio, orden }) {
  db.prepare(
    'INSERT INTO items (bloque_id, tipo, etiqueta, ayuda, obligatorio, orden) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(bloque_id, tipo, etiqueta, ayuda ?? null, obligatorio ? 1 : 0, orden ?? 0);
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

function actualizarItem(id, { tipo, etiqueta, ayuda, obligatorio, orden }) {
  db.prepare(
    'UPDATE items SET tipo = ?, etiqueta = ?, ayuda = ?, obligatorio = ?, orden = ? WHERE id = ?'
  ).run(tipo, etiqueta, ayuda ?? null, obligatorio ? 1 : 0, orden ?? 0, id);
}

function eliminarItem(id) {
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
}

// ---------- Expedientes ----------
function crearExpediente({ nombre, email, telefono, abogado }) {
  const token = generarToken();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO expedientes (nombre, email, telefono, abogado, token, estado, created_at, last_activity_at)
     VALUES (?, ?, ?, ?, ?, 'en_progreso', ?, ?)`
  ).run(nombre, email, telefono ?? null, abogado ?? null, token, ts, ts);
  const id = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
  registrarAuditoria(id, 'sistema', 'expediente_creado', `Alta de expediente para ${email}`);
  return getExpedientePorId(id);
}

function getExpedientePorId(id) {
  return db.prepare('SELECT * FROM expedientes WHERE id = ?').get(id);
}

function getExpedientePorToken(token) {
  return db.prepare('SELECT * FROM expedientes WHERE token = ?').get(token);
}

function listarExpedientes() {
  return db.prepare('SELECT * FROM expedientes ORDER BY created_at DESC').all();
}

function actualizarEstadoExpediente(id, estado) {
  db.prepare('UPDATE expedientes SET estado = ? WHERE id = ?').run(estado, id);
}

function tocarActividad(id) {
  db.prepare('UPDATE expedientes SET last_activity_at = ? WHERE id = ?').run(nowIso(), id);
}

// ---------- Respuestas (progreso del expediente) ----------
function getRespuestasPorExpediente(expedienteId) {
  return db
    .prepare('SELECT * FROM respuestas WHERE expediente_id = ?')
    .all(expedienteId);
}

function upsertRespuesta(expedienteId, itemId, campos) {
  const existente = db
    .prepare('SELECT * FROM respuestas WHERE expediente_id = ? AND item_id = ?')
    .get(expedienteId, itemId);

  const base = {
    estado: campos.estado,
    valor_texto: campos.valor_texto ?? null,
    archivo_nombre: campos.archivo_nombre ?? null,
    archivo_path: campos.archivo_path ?? null,
    motivo_rechazo: campos.motivo_rechazo ?? null,
    updated_at: nowIso(),
  };

  if (existente) {
    db.prepare(
      `UPDATE respuestas SET estado=?, valor_texto=?, archivo_nombre=?, archivo_path=?, motivo_rechazo=?, updated_at=?
       WHERE id = ?`
    ).run(
      base.estado,
      base.valor_texto,
      base.archivo_nombre,
      base.archivo_path,
      base.motivo_rechazo,
      base.updated_at,
      existente.id
    );
  } else {
    db.prepare(
      `INSERT INTO respuestas (expediente_id, item_id, estado, valor_texto, archivo_nombre, archivo_path, motivo_rechazo, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      expedienteId,
      itemId,
      base.estado,
      base.valor_texto,
      base.archivo_nombre,
      base.archivo_path,
      base.motivo_rechazo,
      base.updated_at
    );
  }
  tocarActividad(expedienteId);
}

// ---------- Calculo de progreso ----------
// Solo los items marcados como "obligatorio" cuentan para el % (los
// opcionales se muestran pero no bloquean el 100%). Un item se considera
// completado cuando su respuesta esta en estado "aportado".
function calcularProgreso(expedienteId) {
  const checklist = getChecklist();
  const respuestas = getRespuestasPorExpediente(expedienteId);
  const respuestaPorItem = new Map(respuestas.map((r) => [r.item_id, r]));

  let totalObligatorios = 0;
  let completadosObligatorios = 0;

  const bloques = checklist.map((bloque) => {
    let bloqueTotal = 0;
    let bloqueCompletados = 0;

    const items = bloque.items.map((item) => {
      const respuesta = respuestaPorItem.get(item.id) || null;
      const estado = respuesta ? respuesta.estado : 'pendiente';

      if (item.obligatorio) {
        bloqueTotal += 1;
        totalObligatorios += 1;
        if (estado === 'aportado') {
          bloqueCompletados += 1;
          completadosObligatorios += 1;
        }
      }

      return { ...item, respuesta: respuesta && {
        estado: respuesta.estado,
        valor_texto: respuesta.valor_texto,
        archivo_nombre: respuesta.archivo_nombre,
        motivo_rechazo: respuesta.motivo_rechazo,
        updated_at: respuesta.updated_at,
      } };
    });

    const porcentaje = bloqueTotal === 0 ? 100 : Math.round((bloqueCompletados / bloqueTotal) * 100);
    return { ...bloque, items, porcentaje, completados: bloqueCompletados, total: bloqueTotal };
  });

  const porcentajeTotal =
    totalObligatorios === 0 ? 100 : Math.round((completadosObligatorios / totalObligatorios) * 100);

  return { bloques, porcentajeTotal, totalObligatorios, completadosObligatorios };
}

module.exports = {
  db,
  nowIso,
  registrarAuditoria,
  getChecklist,
  crearBloque,
  actualizarBloque,
  eliminarBloque,
  crearItem,
  actualizarItem,
  eliminarItem,
  crearExpediente,
  getExpedientePorId,
  getExpedientePorToken,
  listarExpedientes,
  actualizarEstadoExpediente,
  tocarActividad,
  getRespuestasPorExpediente,
  upsertRespuesta,
  calcularProgreso,
};
