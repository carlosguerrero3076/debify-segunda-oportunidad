// scripts/enviar-avisos-impago.js
//
// Secuencia automática de avisos por email para honorarios impagados, con
// tono cada vez más serio:
//
//   Nivel 1 (al registrar el impago): recordatorio de la cuota pendiente.
//   Nivel 2 (a los 30 días sin pagar): aviso de suspensión del proceso.
//   Nivel 3 en adelante (cada 7 días desde entonces): aviso de que se
//   acudirá al juzgado a reclamar la cantidad.
//
// Se detiene en cuanto el abogado marca el impago como "Pagado" desde el
// panel. Igual que con los recordatorios de documentación, esto lo llama
// server.js automáticamente cada hora mientras el servidor está encendido
// (no hace falta un Cron Job aparte de Render).

const db = require('../db');
const { enviarEmail } = require('../lib/mailer');

const DIAS_SUSPENSION = Number(process.env.DIAS_IMPAGO_SUSPENSION || 30);
const DIAS_ENTRE_AVISOS_JUZGADO = Number(process.env.DIAS_IMPAGO_JUZGADO || 7);
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function formatoImporte(importe) {
  return Number(importe).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function textoAviso(nivel, impago, expediente) {
  const importe = formatoImporte(impago.importe);
  const concepto = impago.concepto ? ` (${impago.concepto})` : '';

  if (nivel === 1) {
    return {
      subject: 'Debify — Recordatorio de pago de honorarios pendiente',
      body:
        `Hola ${expediente.nombre},\n\n` +
        `Te recordamos que tienes pendiente el pago de ${importe} €${concepto} correspondiente a los honorarios de tu expediente.\n\n` +
        `Te agradecemos que regularices el pago a la mayor brevedad posible.\n\n` +
        `Un saludo,\nEquipo Debify`,
    };
  }

  if (nivel === 2) {
    return {
      subject: 'Debify — Suspensión del proceso por falta de pago',
      body:
        `Hola ${expediente.nombre},\n\n` +
        `Han pasado ${DIAS_SUSPENSION} días desde el vencimiento del pago de ${importe} €${concepto} sin que hayamos recibido el ingreso.\n\n` +
        `Lamentamos comunicarte que, mientras no se regularice esta situación, nos vemos obligados a suspender la tramitación de tu expediente.\n\n` +
        `Puedes ponerte en contacto con nosotros en cuanto realices el pago para reanudarlo.\n\n` +
        `Un saludo,\nEquipo Debify`,
    };
  }

  // nivel 3 en adelante: avisos semanales, tono cada vez mas serio
  return {
    subject: 'Debify — Aviso previo a reclamación judicial por impago',
    body:
      `Hola ${expediente.nombre},\n\n` +
      `Seguimos sin recibir el pago de ${importe} €${concepto}, pendiente desde hace ya un tiempo considerable.\n\n` +
      `Si no recibimos el ingreso en los próximos días, nos veremos obligados a iniciar acciones legales de reclamación de cantidad ante los juzgados, lo que generará costes adicionales.\n\n` +
      `Te rogamos que regularices esta situación cuanto antes.\n\n` +
      `Un saludo,\nEquipo Debify`,
  };
}

async function ejecutarAvisosImpago() {
  const impagos = db.listarImpagos().filter((i) => i.estado === 'pendiente');
  const ahora = Date.now();
  let enviados = 0;

  for (const impago of impagos) {
    const expediente = db.getExpedientePorId(impago.expediente_id);
    if (!expediente) continue;

    const diasDesdeImpago = Math.floor((ahora - new Date(impago.fecha_impago).getTime()) / UN_DIA_MS);
    let nivelASubir = null;

    if (impago.nivel_aviso === 0) {
      nivelASubir = 1; // recordatorio inicial, se envia en cuanto se registra
    } else if (impago.nivel_aviso === 1 && diasDesdeImpago >= DIAS_SUSPENSION) {
      nivelASubir = 2; // suspension a los 30 dias
    } else if (impago.nivel_aviso >= 2) {
      const diasDesdeUltimoAviso = impago.ultimo_aviso_at
        ? (ahora - new Date(impago.ultimo_aviso_at).getTime()) / UN_DIA_MS
        : Infinity;
      if (diasDesdeUltimoAviso >= DIAS_ENTRE_AVISOS_JUZGADO) {
        nivelASubir = impago.nivel_aviso + 1; // siguiente aviso semanal de juzgado
      }
    }

    if (nivelASubir !== null) {
      const { subject, body } = textoAviso(Math.min(nivelASubir, 3), impago, expediente);
      await enviarEmail({ to: expediente.email, subject, body });
      db.actualizarAvisoImpago(impago.id, nivelASubir);
      db.registrarAuditoria(expediente.id, 'sistema', 'aviso_impago_enviado', `Nivel ${nivelASubir}`);
      enviados++;
    }
  }

  if (enviados > 0) console.log(`Avisos de impago enviados: ${enviados}`);
  return enviados;
}

module.exports = { ejecutarAvisosImpago };

if (require.main === module) {
  ejecutarAvisosImpago().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
