// propuesta.js — página pública donde el cliente lee y acepta la propuesta
// de honorarios. Aceptación sencilla (checkbox + nombre + botón), NO es una
// firma electrónica formal, pero deja constancia de fecha, hora, nombre e IP.

const token = new URLSearchParams(location.search).get('token');

if (!token) {
  mostrarError();
} else {
  cargar();
}

function mostrarError() {
  document.getElementById('error-token').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtFechaHora(iso) {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function cargar() {
  try {
    const res = await fetch(`/api/propuesta/${token}`);
    if (!res.ok) return mostrarError();
    const data = await res.json();
    render(data);
  } catch (err) {
    mostrarError();
  }
}

function render({ propuesta, cliente }) {
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('error-token').classList.add('hidden');

  document.getElementById('subtitulo').textContent = cliente.nombre ? `Para ${cliente.nombre}` : '';
  document.getElementById('texto-propuesta').textContent = propuesta.texto;

  if (propuesta.estado === 'aceptada') {
    document.getElementById('zona-aceptacion').classList.add('hidden');
    document.getElementById('zona-aceptada').classList.remove('hidden');
    document.getElementById('detalle-aceptacion').textContent =
      `Aceptada por ${propuesta.aceptada_nombre} el ${fmtFechaHora(propuesta.aceptada_at)}.`;
    return;
  }

  document.getElementById('zona-aceptacion').classList.remove('hidden');
  document.getElementById('zona-aceptada').classList.add('hidden');

  const checkLeido = document.getElementById('check-leido');
  const inputNombre = document.getElementById('input-nombre');
  const btnAceptar = document.getElementById('btn-aceptar');

  function actualizarBoton() {
    btnAceptar.disabled = !(checkLeido.checked && inputNombre.value.trim().length > 2);
  }
  checkLeido.addEventListener('change', actualizarBoton);
  inputNombre.addEventListener('input', actualizarBoton);

  btnAceptar.addEventListener('click', async () => {
    const nombre = inputNombre.value.trim();
    if (!nombre) return;
    btnAceptar.disabled = true;
    btnAceptar.textContent = 'Enviando...';
    try {
      const res = await fetch(`/api/propuesta/${token}/aceptar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      render({ propuesta: data.propuesta, cliente });
    } catch (err) {
      alert('No se pudo registrar la aceptación: ' + err.message);
      btnAceptar.disabled = false;
      btnAceptar.textContent = 'Aceptar propuesta';
    }
  });
}
