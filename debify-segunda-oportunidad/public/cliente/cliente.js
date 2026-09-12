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
    cuerpo = `
      <div class="item-cuerpo">
        <div class="fila-input">
          <input type="text" data-item-id="${item.id}" class="input-campo" value="${estado === 'aportado' ? escapeHtml(r.valor_texto) : ''}" placeholder="Escribe aquí..." />
          <button class="btn-guardar-campo" data-item-id="${item.id}">Guardar</button>
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
  document.querySelectorAll('.btn-guardar-campo').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.itemId;
      const input = document.querySelector(`.input-campo[data-item-id="${itemId}"]`);
      const valor = input.value.trim();
      if (!valor) return;
      btn.disabled = true;
      btn.textContent = 'Guardando...';
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
        alert('No se pudo guardar: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Guardar';
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
