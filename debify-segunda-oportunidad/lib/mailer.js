// lib/mailer.js
//
// Envio de notificaciones por email. De momento NO envia correos reales:
// los escribe en consola y los anexa a data/emails.log, para poder probar
// todo el flujo (enlace al cliente, avisos de progreso, recordatorios...)
// sin necesidad de contratar un proveedor todavia.
//
// Cuando Debify tenga un proveedor transaccional (SendGrid, Postmark,
// Amazon SES, SMTP propio...), sustituir el cuerpo de enviarEmail() por la
// llamada real a su API. El resto de la aplicacion no cambia: siempre llama
// a esta funcion.

const fs = require('node:fs');
const path = require('node:path');

const LOG_PATH = path.join(__dirname, '..', 'data', 'emails.log');

function enviarEmail({ to, subject, body }) {
  const entrada = {
    fecha: new Date().toISOString(),
    to,
    subject,
    body,
  };

  const linea = `\n[${entrada.fecha}] Para: ${to}\nAsunto: ${subject}\n${body}\n${'-'.repeat(60)}\n`;

  try {
    fs.appendFileSync(LOG_PATH, linea, 'utf8');
  } catch (err) {
    console.error('No se pudo escribir en emails.log:', err.message);
  }

  // eslint-disable-next-line no-console
  console.log(`\n📧  [EMAIL SIMULADO] → ${to}\n    Asunto: ${subject}\n`);

  // TODO: sustituir por el envio real, por ejemplo con SendGrid:
  //
  // const sgMail = require('@sendgrid/mail');
  // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  // return sgMail.send({ to, from: process.env.EMAIL_FROM, subject, text: body });

  return Promise.resolve({ simulado: true });
}

module.exports = { enviarEmail };
