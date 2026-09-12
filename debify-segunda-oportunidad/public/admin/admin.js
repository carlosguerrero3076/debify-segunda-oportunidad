// admin.js — lógica del panel interno. Vanilla JS, sin frameworks.

const STORAGE_KEY = 'debify_admin_key';
let adminKey = localStorage.getItem(STORAGE_KEY) || '';

// Si la URL trae ?key=..., úsala y guárdala (comodidad para el primer acceso).
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('key')) {
  adminKey = urlParams.get('key');
  localStorage.setItem(STORAGE_KEY, adminKey);
  history.replaceState({}, '', location.pathname);
}

async function api(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': adminKey,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    mostrarGate('Clave incorrecta. Inténtalo de nuevo.');
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error desconocido');
  return data;
}

function mostrarGate(error) {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('gate').classList.remove('hidden');
  const err = document.getElementById('gate-error');
  if (error) {
    err.textContent = error;
    err.classList.remove('hidden');
  }
}

async function intentarEntrar() {
  if (!adminKey) return mostrarGate();
  try {
    await api('/expedientes');
    document.getElementById('gate').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    cargarVista('expedientes');
  } catch (err) {
    mostrarGate();
  }
}

document.getElementById('gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  adminKey = document.getElementById('gate-key').value.trim();
  localStorage.setItem(STORAGE_KEY, adminKey);
  intentarEntrar();
});

// --- Navegación entre vistas ---
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => cargarVista(btn.dataset.view));
});

function cargarVista(nombre) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(`view-${nombre}`)?.classList.remove('hidden');
  document.querySelector(`.nav-btn[data-view="${nombre}"]`)?.classList.add('active');

  if (nombre === 'expedientes') cargarExpedientes();
  if (nombre === 'documental') cargarDocumental();
  if (nombre === 'config') cargarConfig();
}

// ---------------------------------------------------------------------
// EXPEDIENTES
// ---------------------------------------------------------------------

function fmtFecha(iso) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function badgeEstado(estado) {
  const mapa = {
    en_progreso: ['En progreso', 'badge-progreso'],
    completo: ['Completo', 'badge-completo'],
    en_redaccion: ['En redacción', 'badge-redaccion'],
  };
  const [texto, clase] = mapa[estado] || [estado, 'badge-progreso'];
  return `<span class="badge ${clase}">${texto}</span>`;
}

// Cache local de las fases posibles (se piden una vez al servidor).
let FASES_CACHE = null;
async function obtenerFases() {
  if (!FASES_CACHE) {
    const { fases } = await api('/fases');
    FASES_CACHE = fases;
  }
  return FASES_CACHE;
}

function etiquetaFase(valor, fases) {
  return fases.find((f) => f.value === valor)?.label || valor;
}

async function cargarExpedientes() {
  const [{ expedientes }, fases] = await Promise.all([api('/expedientes'), obtenerFases()]);
  const tbody = document.getElementById('tabla-expedientes');
  const vacio = document.getElementById('expedientes-vacio');

  if (expedientes.length === 0) {
    tbody.innerHTML = '';
    vacio.classList.remove('hidden');
    return;
  }
  vacio.classList.add('hidden');

  tbody.innerHTML = expedientes
    .map(
      (exp) => `
    <tr data-id="${exp.id}" class="fila-expediente" style="cursor:pointer">
      <td>${escapeHtml(exp.nombre)}</td>
      <td>${escapeHtml(exp.email)}</td>
      <td>${escapeHtml(exp.abogado || '—')}</td>
      <td><span class="badge badge-fase">${escapeHtml(etiquetaFase(exp.fase, fases))}</span></td>
      <td>${fmtFecha(exp.created_at)}</td>
      <td><button class="btn-secondary" data-id="${exp.id}" data-origen="expedientes">Ver</button></td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('tr, button').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.id || el.closest('tr')?.dataset.id;
      if (id) abrirDetalle(Number(id), 'expedientes');
    });
  });
}

// ---------------------------------------------------------------------
// DOCUMENTAL (seguimiento de la recopilación de documentos por expediente)
// ---------------------------------------------------------------------

async function cargarDocumental() {
  const [{ expedientes }, fases] = await Promise.all([api('/expedientes'), obtenerFases()]);
  const tbody = document.getElementById('tabla-documental');
  const vacio = document.getElementById('documental-vacio');

  if (expedientes.length === 0) {
    tbody.innerHTML = '';
    vacio.classList.remove('hidden');
    return;
  }
  vacio.classList.add('hidden');

  tbody.innerHTML = expedientes
    .map(
      (exp) => `
    <tr data-id="${exp.id}" class="fila-expediente" style="cursor:pointer">
      <td>${escapeHtml(exp.nombre)}</td>
      <td>
        <span class="progress-bar ${exp.porcentaje >= 100 ? 'completo' : ''}"><div style="width:${exp.porcentaje}%"></div></span>
        ${exp.porcentaje}%
      </td>
      <td>${badgeEstado(exp.estado)}</td>
      <td><span class="badge badge-fase">${escapeHtml(etiquetaFase(exp.fase, fases))}</span></td>
      <td><button class="btn-secondary" data-id="${exp.id}" data-origen="documental">Ver</button></td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('tr, button').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.id || el.closest('tr')?.dataset.id;
      if (id) abrirDetalle(Number(id), 'documental');
    });
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('btn-nuevo-expediente').addEventListener('click', () => {
  abrirModal(`
    <h3>Nuevo expediente</h3>
    <form id="form-nuevo-expediente">
      <label>Nombre del cliente</label>
      <input type="text" name="nombre" required />
      <label>Email</label>
      <input type="email" name="email" required />
      <label>Teléfono (opcional)</label>
      <input type="text" name="telefono" />
      <label>Abogado asignado (opcional)</label>
      <input type="text" name="abogado" />
      <div class="modal-acciones">
        <button type="button" class="btn-secondary" id="modal-cancelar">Cancelar</button>
        <button type="submit" class="btn-primary">Crear y enviar enlace</button>
      </div>
    </form>
  `);
  document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('form-nuevo-expediente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      const { link } = await api('/expedientes', { method: 'POST', body: JSON.stringify(body) });
      cerrarModal();
      cargarExpedientes();
      abrirModal(`
        <h3>Expediente creado</h3>
        <p>Se ha "enviado" un email al cliente (revisa <code>data/emails.log</code> mientras no haya proveedor real configurado) con este enlace:</p>
        <input type="text" readonly value="${link}" onclick="this.select()" />
        <div class="modal-acciones"><button class="btn-primary" id="modal-ok">Entendido</button></div>
      `);
      document.getElementById('modal-ok').addEventListener('click', cerrarModal);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
});

// ---------------------------------------------------------------------
// DETALLE DE EXPEDIENTE
// ---------------------------------------------------------------------

let vistaOrigenDetalle = 'expedientes';

document.getElementById('btn-volver').addEventListener('click', () => cargarVista(vistaOrigenDetalle));

async function abrirDetalle(id, origen) {
  vistaOrigenDetalle = origen || 'expedientes';
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-detalle').classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

  await renderDetalle(id);
}

async function renderDetalle(id) {
  const [{ expediente, progreso, link }, fases, { comentarios }] = await Promise.all([
    api(`/expedientes/${id}`),
    obtenerFases(),
    api(`/expedientes/${id}/comentarios`),
  ]);
  const cont = document.getElementById('detalle-contenido');

  cont.innerHTML = `
    <div class="detalle-header">
      <h2>${escapeHtml(expediente.nombre)}</h2>
      <div class="muted">${escapeHtml(expediente.email)} ${expediente.telefono ? '· ' + escapeHtml(expediente.telefono) : ''}</div>
      <div class="detalle-meta">
        <div><strong>Progreso:</strong> <span class="detalle-progreso-grande">${progreso.porcentajeTotal}%</span></div>
        <div><strong>Estado:</strong> ${badgeEstado(expediente.estado)}</div>
        <div>
          <strong>Fase:</strong>
          <select id="select-fase">
            ${fases.map((f) => `<option value="${f.value}" ${f.value === expediente.fase ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
          </select>
        </div>
        <div><strong>Abogado:</strong> ${escapeHtml(expediente.abogado || '—')}</div>
        <div><strong>Alta:</strong> ${fmtFecha(expediente.created_at)}</div>
      </div>
      <div class="detalle-acciones">
        <button class="btn-secondary" id="btn-copiar-enlace">Copiar enlace del cliente</button>
        <button class="btn-secondary" id="btn-descargar-zip">Descargar documentación (.zip)</button>
        ${
          progreso.porcentajeTotal >= 100 && expediente.estado !== 'en_redaccion'
            ? '<button class="btn-primary" id="btn-marcar-redaccion">Marcar como "en redacción"</button>'
            : ''
        }
      </div>
    </div>
    ${progreso.bloques.map((b) => renderBloqueDetalle(id, b)).join('')}
    ${renderComentarios(comentarios)}
  `;

  document.getElementById('btn-copiar-enlace').addEventListener('click', () => {
    navigator.clipboard?.writeText(link);
    alert('Enlace copiado:\n' + link);
  });
  document.getElementById('btn-descargar-zip').addEventListener('click', () => {
    window.open(`/api/admin/expedientes/${id}/descargar?key=${encodeURIComponent(adminKey)}`, '_blank');
  });
  document.getElementById('btn-marcar-redaccion')?.addEventListener('click', async () => {
    await api(`/expedientes/${id}/marcar-redaccion`, { method: 'POST', body: '{}' });
    renderDetalle(id);
  });
  document.getElementById('select-fase').addEventListener('change', async (e) => {
    await api(`/expedientes/${id}/fase`, { method: 'PUT', body: JSON.stringify({ fase: e.target.value }) });
    cargarExpedientes(); // por si vuelven al listado, que ya se vea actualizado
  });

  const AUTOR_KEY = 'debify_admin_autor';
  const inputAutor = document.getElementById('input-comentario-autor');
  if (inputAutor) inputAutor.value = localStorage.getItem(AUTOR_KEY) || '';

  document.getElementById('form-comentario')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const autor = (fd.get('autor') || '').toString().trim();
    const texto = (fd.get('texto') || '').toString().trim();
    if (!texto) return;
    localStorage.setItem(AUTOR_KEY, autor);
    await api(`/expedientes/${id}/comentarios`, { method: 'POST', body: JSON.stringify({ autor, texto }) });
    renderDetalle(id);
  });

  cont.querySelectorAll('.btn-rechazar').forEach((btn) => {
    btn.addEventListener('click', () => {
      const itemId = btn.dataset.itemId;
      abrirModal(`
        <h3>Solicitar corrección</h3>
        <p class="muted">Explica al cliente qué debe corregir o volver a aportar en este punto.</p>
        <form id="form-rechazo">
          <textarea name="motivo" rows="4" placeholder="Ej: El extracto bancario no incluye los últimos 2 meses" required></textarea>
          <div class="modal-acciones">
            <button type="button" class="btn-secondary" id="modal-cancelar">Cancelar</button>
            <button type="submit" class="btn-primary">Enviar al cliente</button>
          </div>
        </form>
      `);
      document.getElementById('modal-cancelar').addEventListener('click', cerrarModal);
      document.getElementById('form-rechazo').addEventListener('submit', async (e) => {
        e.preventDefault();
        const motivo = new FormData(e.target).get('motivo');
        await api(`/expedientes/${id}/item/${itemId}/rechazar`, {
          method: 'POST',
          body: JSON.stringify({ motivo }),
        });
        cerrarModal();
        renderDetalle(id);
      });
    });
  });
}

function renderBloqueDetalle(expedienteId, bloque) {
  return `
    <div class="bloque-card">
      <div class="bloque-card-header">
        <h3>${escapeHtml(bloque.nombre)}</h3>
        <span class="muted">${bloque.completados}/${bloque.total} · ${bloque.porcentaje}%</span>
      </div>
      ${bloque.items
        .map((item) => {
          const r = item.respuesta;
          const estado = r ? r.estado : 'pendiente';
          let valorHtml = '';
          const urlDocumento = `/api/admin/expedientes/${expedienteId}/item/${item.id}/archivo?key=${encodeURIComponent(adminKey)}`;
          if (r?.estado === 'aportado') {
            valorHtml = item.tipo === 'documento'
              ? `<div class="item-valor">📎 <a href="${urlDocumento}" target="_blank" rel="noopener">${escapeHtml(r.archivo_nombre || 'documento subido')}</a></div>`
              : `<div class="item-valor">"${escapeHtml(r.valor_texto)}"</div>`;
          } else if (r?.estado === 'rechazado') {
            valorHtml = `<div class="item-valor" style="color:#b3261e">Motivo del rechazo: ${escapeHtml(r.motivo_rechazo)}</div>`;
            if (item.tipo === 'documento' && r.archivo_nombre) {
              valorHtml += `<div class="item-valor"><a href="${urlDocumento}" target="_blank" rel="noopener">Ver el documento rechazado</a></div>`;
            }
          }
          return `
          <div class="item-row">
            <div>
              <div class="item-label">${escapeHtml(item.etiqueta)} ${item.obligatorio ? '' : '<span class="muted">(opcional)</span>'}</div>
              ${item.ayuda ? `<div class="item-ayuda">${escapeHtml(item.ayuda)}</div>` : ''}
              ${valorHtml}
            </div>
            <div class="item-estado">
              <span class="estado-dot ${estado}"></span>
              ${estado === 'aportado' && item.tipo === 'documento' ? `<a class="btn-secondary" style="text-decoration:none" href="${urlDocumento}" target="_blank" rel="noopener">Ver</a>` : ''}
              ${estado === 'aportado' ? `<button class="btn-danger btn-rechazar" data-item-id="${item.id}">Rechazar</button>` : ''}
            </div>
          </div>`;
        })
        .join('')}
    </div>
  `;
}

function fmtFechaHora(iso) {
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderComentarios(comentarios) {
  return `
    <div class="bloque-card">
      <div class="bloque-card-header">
        <h3>Comentarios internos</h3>
        <span class="muted">Solo visibles para el equipo, nunca para el cliente</span>
      </div>
      <form id="form-comentario" class="form-comentario">
        <input type="text" name="autor" id="input-comentario-autor" placeholder="Tu nombre" required />
        <textarea name="texto" rows="2" placeholder="Escribe una nota sobre este expediente..." required></textarea>
        <button type="submit" class="btn-primary">Añadir comentario</button>
      </form>
      ${
        comentarios.length === 0
          ? '<p class="muted" style="margin-top:.75rem">Todavía no hay comentarios.</p>'
          : `<div class="lista-comentarios">
              ${comentarios
                .map(
                  (c) => `
                <div class="comentario">
                  <div class="comentario-cabecera">
                    <strong>${escapeHtml(c.autor)}</strong>
                    <span class="muted">${fmtFechaHora(c.created_at)}</span>
                  </div>
                  <div class="comentario-texto">${escapeHtml(c.texto)}</div>
                </div>`
                )
                .join('')}
            </div>`
      }
    </div>
  `;
}

// ---------------------------------------------------------------------
// CONFIGURACIÓN DEL CHECKLIST
// ---------------------------------------------------------------------

async function cargarConfig() {
  const { bloques } = await api('/config');
  const cont = document.getElementById('config-bloques');
  cont.innerHTML = bloques.map(renderBloqueConfig).join('');
  bindConfigEvents();
}

function renderBloqueConfig(bloque) {
  return `
  <div class="bloque-config" data-bloque-id="${bloque.id}">
    <div class="bloque-config-header">
      <input type="text" class="input-nombre-bloque" value="${escapeHtml(bloque.nombre)}" data-bloque-id="${bloque.id}" />
      <div>
        <button class="btn-secondary btn-add-item" data-bloque-id="${bloque.id}">+ item</button>
        <button class="btn-danger btn-del-bloque" data-bloque-id="${bloque.id}">Eliminar bloque</button>
      </div>
    </div>
    ${bloque.items
      .map(
        (item) => `
      <div class="item-config-row" data-item-id="${item.id}">
        <select class="item-tipo">
          <option value="documento" ${item.tipo === 'documento' ? 'selected' : ''}>Documento</option>
          <option value="campo" ${item.tipo === 'campo' ? 'selected' : ''}>Campo de texto</option>
        </select>
        <input type="text" class="item-etiqueta" value="${escapeHtml(item.etiqueta)}" placeholder="Etiqueta" />
        <label><input type="checkbox" class="item-obligatorio" ${item.obligatorio ? 'checked' : ''}/> obligatorio</label>
        <button class="btn-danger btn-del-item" data-item-id="${item.id}" title="Eliminar">✕</button>
      </div>
    `
      )
      .join('')}
  </div>`;
}

function bindConfigEvents() {
  const cont = document.getElementById('config-bloques');

  cont.querySelectorAll('.input-nombre-bloque').forEach((input) => {
    input.addEventListener('change', async () => {
      await api(`/config/bloque/${input.dataset.bloqueId}`, {
        method: 'PUT',
        body: JSON.stringify({ nombre: input.value, orden: 0 }),
      });
    });
  });

  cont.querySelectorAll('.btn-del-bloque').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este bloque y todos sus items? Esta acción no se puede deshacer.')) return;
      await api(`/config/bloque/${btn.dataset.bloqueId}`, { method: 'DELETE' });
      cargarConfig();
    });
  });

  cont.querySelectorAll('.btn-add-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api('/config/item', {
        method: 'POST',
        body: JSON.stringify({
          bloque_id: Number(btn.dataset.bloqueId),
          tipo: 'documento',
          etiqueta: 'Nuevo documento',
          obligatorio: 1,
          orden: 99,
        }),
      });
      cargarConfig();
    });
  });

  cont.querySelectorAll('.item-config-row').forEach((row) => {
    const guardar = async () => {
      const itemId = row.dataset.itemId;
      await api(`/config/item/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({
          tipo: row.querySelector('.item-tipo').value,
          etiqueta: row.querySelector('.item-etiqueta').value,
          obligatorio: row.querySelector('.item-obligatorio').checked ? 1 : 0,
          orden: 0,
        }),
      });
    };
    row.querySelector('.item-tipo').addEventListener('change', guardar);
    row.querySelector('.item-etiqueta').addEventListener('change', guardar);
    row.querySelector('.item-obligatorio').addEventListener('change', guardar);
    row.querySelector('.btn-del-item').addEventListener('click', async () => {
      await api(`/config/item/${row.dataset.itemId}`, { method: 'DELETE' });
      cargarConfig();
    });
  });
}

document.getElementById('btn-nuevo-bloque').addEventListener('click', async () => {
  await api('/config/bloque', { method: 'POST', body: JSON.stringify({ nombre: 'Nuevo bloque', orden: 99 }) });
  cargarConfig();
});

// ---------------------------------------------------------------------
// Modal genérico
// ---------------------------------------------------------------------

function abrirModal(html) {
  document.getElementById('modal').innerHTML = html;
  document.getElementById('modal-backdrop').classList.remove('hidden');
}
function cerrarModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') cerrarModal();
});

// --- Arranque ---
intentarEntrar();
