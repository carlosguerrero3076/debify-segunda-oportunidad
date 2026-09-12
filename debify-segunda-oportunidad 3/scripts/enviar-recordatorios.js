// scripts/enviar-recordatorios.js
//
// Envía un recordatorio a los clientes cuyo expediente lleva 3 o 7 días sin
// actividad y todavía no está al 100%. Pensado para ejecutarse periódicamente
// con un cron del sistema, por ejemplo una vez al día:
//
//   0 9 * * *  cd /ruta/al/proyecto && node scripts/enviar-recordatorios.js
//
// No depende de que el servidor esté encendido: abre la base de datos
// directamente.

const db = require('../db');
const { enviarEmail } = require('../lib/mailer');

const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000;
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

async function main() {
  const expedientes = db.listarExpedientes().filter((e) => e.estado === 'en_progreso');
  const ahora = Date.now();
  let enviados = 0;

  for (const exp of expedientes) {
    const progreso = db.calcularProgreso(exp.id);
    if (progreso.porcentajeTotal >= 100) continue;

    const inactivoMs = ahora - new Date(exp.last_activity_at).getTime();

    if (inactivoMs >= SIETE_DIAS_MS && !exp.recordatorio_7d_enviado) {
      await enviarRecordatorio(exp, progreso, 7);
      db.db.prepare('UPDATE expedientes SET recordatorio_7d_enviado = 1 WHERE id = ?').run(exp.id);
      enviados++;
    } else if (inactivoMs >= TRES_DIAS_MS && !exp.recordatorio_3d_enviado) {
      await enviarRecordatorio(exp, progreso, 3);
      db.db.prepare('UPDATE expedientes SET recordatorio_3d_enviado = 1 WHERE id = ?').run(exp.id);
      enviados++;
    }
  }

  console.log(`Recordatorios enviados: ${enviados}`);
}

async function enviarRecordatorio(expediente, progreso, dias) {
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  const link = `${BASE_URL}/cliente/?token=${expediente.token}`;
  await enviarEmail({
    to: expediente.email,
    subject: `Debify — Te faltan ${100 - progreso.porcentajeTotal}% de documentos por aportar`,
    body:
      `Hola ${expediente.nombre},\n\n` +
      `Han pasado ${dias} días sin novedades en tu expediente. Llevas un ${progreso.porcentajeTotal}% completado.\n\n` +
      `Puedes continuar donde lo dejaste en este enlace:\n${link}\n\n` +
      `Cuanto antes lo completes, antes podremos presentar tu demanda.\n\n` +
      `Un saludo,\nEquipo Debify`,
  });
  db.registrarAuditoria(expediente.id, 'sistema', 'recordatorio_enviado', `${dias} días de inactividad`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
