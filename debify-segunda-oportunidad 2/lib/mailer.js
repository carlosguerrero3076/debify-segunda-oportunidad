// lib/mailer.js
//
// Envio de notificaciones por email a traves de Resend (resend.com).
// Usa solo "fetch" nativo de Node (>=18), sin instalar el SDK de Resend,
// para no depender de npm en el servidor.
//
// Variables de entorno:
//   RESEND_API_KEY  - clave de API de Resend (obligatoria para envio real)
//   EMAIL_FROM      - remitente, ej. "Debify <notificaciones@debify.es>"
//                     Mientras el dominio de Debify no este verificado en
//                     Resend, hay que usar el remitente de pruebas
//                     "onboarding@resend.dev" (Resend solo entrega, en ese
//                     caso, al email con el que os registrasteis en Resend).
//
// Si RESEND_API_KEY no esta configurada, cae al modo simulado anterior
// (log en consola + data/emails.log) para poder seguir probando sin clave.

const fs = require('node:fs');
const path = require('node:path');

const LOG_PATH = path.join(__dirname, '..', 'data', 'emails.log');
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Debify <onboarding@resend.dev>';

function registrarLog(to, subject, body, extra) {
  const fecha = new Date().toISOString();
  const linea = `\n[${fecha}] Para: ${to}\nAsunto: ${subject}\n${body}\n${extra ? extra + '\n' : ''}${'-'.repeat(60)}\n`;
  try {
    fs.appendFileSync(LOG_PATH, linea, 'utf8');
  } catch (err) {
    console.error('No se pudo escribir en emails.log:', err.message);
  }
}

async function enviarEmail({ to, subject, body }) {
  if (!RESEND_API_KEY) {
    registrarLog(to, subject, body, '(SIMULADO: falta RESEND_API_KEY)');
    console.log(`\n📧  [EMAIL SIMULADO, sin RESEND_API_KEY] → ${to}\n    Asunto: ${subject}\n`);
    return { simulado: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        text: body,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detalle = `(ERROR Resend ${res.status}: ${JSON.stringify(data)})`;
      registrarLog(to, subject, body, detalle);
      console.error(`\n📧  [EMAIL FALLIDO] → ${to}\n    ${detalle}\n`);
      return { simulado: false, error: data };
    }

    registrarLog(to, subject, body, `(ENVIADO, id Resend: ${data.id})`);
    console.log(`\n📧  [EMAIL ENVIADO] → ${to}  (id: ${data.id})\n`);
    return { simulado: false, id: data.id };
  } catch (err) {
    registrarLog(to, subject, body, `(ERROR de red: ${err.message})`);
    console.error(`\n📧  [EMAIL FALLIDO] → ${to}\n    Error de red: ${err.message}\n`);
    return { simulado: false, error: err.message };
  }
}

module.exports = { enviarEmail };
