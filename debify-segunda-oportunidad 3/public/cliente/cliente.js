// cliente.js — formulario público del cliente. Vanilla JS, sin frameworks.

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

async function cargar() {
  try {
    const res = await fetch(`/api/cliente/${token}`);
    if (!res.ok) return mostrarError();
    const data = await res.json();
    render(data);
  } catch (err) {
    mostrarError();
  }
}

function render({ expediente, progreso }) {
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('error-token').classList.add('hidden');

  document.getElementById('titulo-cliente').textContent = `Hola, ${expediente.nombre}`;
  document.getElementById('progreso-relleno').style.width = progreso.porcentajeTotal + '%';
  document.getElementById('progreso-num').textContent = progreso.porcentajeTotal;
  document.getElementById('mensaje-completo').classList.toggle('hidden', progreso.porcentajeTotal < 100);

  const cont = document.getElementById('bloques');
  cont.innerHTML = progreso.bloques.map(renderBloque).join('');
  bindEventos();
}

function renderBloque(bloque) {
  return `
    <div class="bloque-card">
      <h2>${escapeHtml(bloque.nombre)}</h2>
      <div class="bloque-progreso">${bloque.completados}/${bloque.total} completado · ${bloque.porcentaje}%</div>
      ${bloque.items.map(renderItem).join('')}
    </div>
  `;
}

function renderItem(item) {
  const r = item.respuesta;
  const estado = r ? r.estado : 'pendiente';
  const etiquetaEstado = { pendiente: 'Pendiente', aportado: 'Aportado ✓', rechazado: 'Revisar' }[estado];

  let cuerpo = '';
  if (item.tipo === 'campo') {
    const valorGuardado = estado === 'aportado' ? r.valor_texto : '';
    cuerpo = `
      <div class="item-cuerpo">
        <div class="fila-input">
          <input type="text" data-item-id="${item.id}" data-valor-guardado="${escapeHtml(valorGuardado)}" class="input-campo" value="${escapeHtml(valorGuardado)}" placeholder="Escribe aquí y sigue con lo siguiente: se guarda solo" />
          <span class="guardado-indicador" data-item-id="${item.id}"></span>
        </div>
      </div>
    `;
  } else {
    cuerpo = `
      <div class="item-cuerpo">
        <label class="file-drop">
          📎 ${estado === 'aportado' ? 'Sustituir archivo' : 'Toca para subir un archivo (PDF, JPG, PNG)'}
          <input type="file" data-item-id="${item.id}" class="input-archivo" accept=".pdf,.jpg,.jpeg,.png" style="display:none" />
        </label>
        ${estado === 'aportado' ? `<div class="archivo-actual">✓ ${escapeHtml(r.archivo_nombre)}</div>` : ''}
      </div>
    `;
  }

  return `
    <div class="item">
      <div class="item-cabecera">
        <div>
          <div class="item-titulo">${escapeHtml(item.etiqueta)} ${!item.obligatorio ? '<span class="item-opcional">(opcional)</span>' : ''}</div>
          ${item.ayuda ? `<div class="item-ayuda">${escapeHtml(item.ayuda)}</div>` : ''}
        </div>
        <span class="estado-pill ${estado}">${etiquetaEstado}</span>
      </div>
      ${estado === 'rechazado' ? `<div class="motivo-rechazo">${escapeHtml(r.motivo_rechazo)}</div>` : ''}
      ${cuerpo}
    </div>
  `;
}

function bindEventos() {
  document.querySelectorAll('.input-campo').forEach((input) => {
    // Se guarda solo, sin botón: al salir del campo o al pulsar Intro,
    // y solo si el valor ha cambiado de verdad respecto a lo ya guardado.
    const guardarSiCambio = () => guardarCampo(input);
    input.addEventListener('blur', guardarSiCambio);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        input.blur(); // dispara guardarSiCambio y quita el foco, como confirmación visual
      }
    });
  });

  document.querySelectorAll('.input-archivo').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const itemId = input.dataset.itemId;
      const label = input.closest('.file-drop');
      const textoOriginal = label.firstChild.textContent;
      label.firstChild.textContent = ' Subiendo...';

      try {
        const base64 = await fileToBase64(file);
        const res = await fetch(`/api/cliente/${token}/item/${itemId}/archivo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: file.name, contenido_base64: base64 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        render(data);
      } catch (err) {
        alert('No se pudo subir el archivo: ' + err.message);
        label.firstChild.textContent = textoOriginal;
      }
    });
  });
}

async function guardarCampo(input) {
  const itemId = input.dataset.itemId;
  const valor = input.value.trim();
  const valorGuardado = input.dataset.valorGuardado || '';
  if (!valor || valor === valorGuardado) return; // nada que guardar

  const indicador = document.querySelector(`.guardado-indicador[data-item-id="${itemId}"]`);
  if (indicador) indicador.textContent = 'Guardando...';

  try {
    const res = await fetch(`/api/cliente/${token}/item/${itemId}/texto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    render(data);
  } catch (err) {
    if (indicador) indicador.textContent = '';
    alert('No se pudo guardar: ' + err.message);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
