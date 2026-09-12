// scripts/enviar-recordatorios.js
//
// Envía un recordatorio por email a los clientes cuyo expediente lleva 48
// horas sin actividad y todavía no está al 100%. Se repite cada 48 horas
// mientras el expediente siga incompleto (si el cliente sube algo, el
// contador de 48h se reinicia a partir de esa nueva actividad).
//
// Esta función la llama automáticamente server.js cada hora mientras el
// servidor está encendido (ver ejecutarRecordatoriosPeriodicamente en
// server.js) — así no hace falta un Cron Job aparte de Render, que no
// podría compartir el disco persistente de este servicio.
//
// También se puede ejecutar a mano, en cualquier momento, para probarlo o
// forzar el envío inmediato:
//
//   node scripts/enviar-recordatorios.js
//
// (usa STORAGE_DIR igual que server.js, para leer el mismo disco persistente
// si esa variable está definida)

const db = require('../db');
const { enviarEmail } = require('../lib/mailer');

async function ejecutarRecordatorios({ horasAviso = Number(process.env.HORAS_RECORDATORIO || 48) } = {}) {
  const intervaloMs = horasAviso * 60 * 60 * 1000;
  const expedientes = db.listarExpedientes().filter((e) => e.estado === 'en_progreso');
  const ahora = Date.now();
  let enviados = 0;

  for (const exp of expedientes) {
    const progreso = db.calcularProgreso(exp.id);
    if (progreso.porcentajeTotal >= 100) continue;

    const ultimaActividadMs = new Date(exp.last_activity_at).getTime();
    const ultimoRecordatorioMs = exp.ultimo_recordatorio_at ? new Date(exp.ultimo_recordatorio_at).getTime() : 0;
    // Punto de referencia: lo que sea más reciente entre la última actividad
    // del cliente y el último recordatorio ya enviado. Así, si el cliente
    // sube algo, el contador de 48h se reinicia.
    const referencia = Math.max(ultimaActividadMs, ultimoRecordatorioMs);

    if (ahora - referencia >= intervaloMs) {
      await enviarRecordatorio(exp, progreso);
      db.db
        .prepare('UPDATE expedientes SET ultimo_recordatorio_at = ? WHERE id = ?')
        .run(new Date(ahora).toISOString(), exp.id);
      enviados++;
    }
  }

  if (enviados > 0) console.log(`Recordatorios enviados: ${enviados}`);
  return enviados;
}

async function enviarRecordatorio(expediente, progreso) {
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  const link = `${BASE_URL}/cliente/?token=${expediente.token}`;
  await enviarEmail({
    to: expediente.email,
    subject: `Debify — Te faltan ${100 - progreso.porcentajeTotal}% de documentos por aportar`,
    body:
      `Hola ${expediente.nombre},\n\n` +
      `Llevas un ${progreso.porcentajeTotal}% completado de tu expediente. Te faltan ${100 - progreso.porcentajeTotal}% de documentos por aportar para que podamos presentar tu demanda.\n\n` +
      `Puedes continuar donde lo dejaste en este enlace:\n${link}\n\n` +
      `Un saludo,\nEquipo Debify`,
  });
  db.registrarAuditoria(expediente.id, 'sistema', 'recordatorio_enviado', `${progreso.porcentajeTotal}% completado`);
}

module.exports = { ejecutarRecordatorios };

// Si se ejecuta directamente ("node scripts/enviar-recordatorios.js"), lanza
// la comprobación una vez y termina.
if (require.main === module) {
  ejecutarRecordatorios().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
