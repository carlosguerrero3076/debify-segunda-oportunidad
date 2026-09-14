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
  if (nombre === 'impagados') cargarImpagados();
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
      <label>DNI/NIE (opcional)</label>
      <input type="text" name="dni" />
      <label>Domicilio (opcional)</label>
      <input type="text" name="domicilio" />
      <label>Deuda total aproximada (€, opcional)</label>
      <input type="number" step="0.01" min="0" name="deuda_total" />
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
// IMPAGADOS (recobro de honorarios)
// ---------------------------------------------------------------------

function etiquetaNivelAviso(impago) {
  if (impago.estado === 'pagado') return '<span class="badge badge-completo">Pagado</span>';
  const mapa = {
    0: ['Pendiente de primer aviso', 'badge-progreso'],
    1: ['Recordatorio enviado', 'badge-progreso'],
    2: ['Suspensión notificada', 'badge-redaccion'],
  };
  if (impago.nivel_aviso >= 3) return '<span class="badge badge-danger">Aviso de juzgado (semanal)</span>';
  const [texto, clase] = mapa[impago.nivel_aviso] || [`Nivel ${impago.nivel_aviso}`, 'badge-progreso'];
  return `<span class="badge ${clase}">${texto}</span>`;
}

async function marcarImpagoPagado(id, onDone) {
  if (!confirm('¿Marcar este impago como pagado? Se detendrán los avisos automáticos.')) return;
  await api(`/impagos/${id}/pagado`, { method: 'POST', body: '{}' });
  if (onDone) onDone();
}

async function cargarImpagados() {
  const { impagos } = await api('/impagos');
  const tbody = document.getElementById('tabla-impagados');
  const vacio = document.getElementById('impagados-vacio');

  if (impagos.length === 0) {
    tbody.innerHTML = '';
    vacio.classList.remove('hidden');
    return;
  }
  vacio.classList.add('hidden');

  tbody.innerHTML = impagos
    .map(
      (imp) => `
    <tr data-id="${imp.id}">
      <td>${escapeHtml(imp.cliente_nombre)}</td>
      <td>${Number(imp.importe).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
      <td>${escapeHtml(imp.concepto || '—')}</td>
      <td>${fmtFecha(imp.fecha_impago)}</td>
      <td>${etiquetaNivelAviso(imp)}</td>
      <td>
        <button class="btn-secondary" data-id="${imp.expediente_id}" data-accion="ver">Ver expediente</button>
        ${imp.estado === 'pendiente' ? `<button class="btn-secondary" data-id="${imp.id}" data-accion="pagado">Marcar pagado</button>` : ''}
      </td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('button[data-accion="ver"]').forEach((btn) => {
    btn.addEventListener('click', () => abrirDetalle(Number(btn.dataset.id), 'impagados'));
  });
  tbody.querySelectorAll('button[data-accion="pagado"]').forEach((btn) => {
    btn.addEventListener('click', () => marcarImpagoPagado(Number(btn.dataset.id), cargarImpagados));
  });
}

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

function renderFichaCliente(id, expediente) {
  return `
    <div class="bloque-card">
      <div class="bloque-card-header">
        <h3>Datos del cliente</h3>
        <span class="muted">Se guardan automáticamente al salir del campo</span>
      </div>
      <div class="campos-fila">
        <label>DNI/NIE<input type="text" id="ficha-dni" value="${escapeHtml(expediente.dni || '')}" /></label>
        <label>Deuda total aproximada (€)<input type="number" step="0.01" min="0" id="ficha-deuda" value="${expediente.deuda_total ?? ''}" /></label>
      </div>
      <label>Domicilio<input type="text" id="ficha-domicilio" value="${escapeHtml(expediente.domicilio || '')}" /></label>
    </div>
  `;
}

async function renderDetalle(id) {
  const esDocumental = vistaOrigenDetalle === 'documental';
  const peticiones = [api(`/expedientes/${id}`), obtenerFases()];
  if (!esDocumental) {
    peticiones.push(api(`/expedientes/${id}/comentarios`), api(`/expedientes/${id}/propuestas`), api(`/expedientes/${id}/impagos`));
  }
  const [{ expediente, progreso, link }, fases, comentariosRes, propuestasRes, impagosRes] = await Promise.all(peticiones);
  const cont = document.getElementById('detalle-contenido');

  const cabecera = `
    <div class="detalle-header">
      <h2>${escapeHtml(expediente.nombre)}</h2>
      <div class="muted">${escapeHtml(expediente.email)} ${expediente.telefono ? '· ' + escapeHtml(expediente.telefono) : ''}</div>
      <div class="detalle-meta">
        ${esDocumental ? `<div><strong>Progreso:</strong> <span class="detalle-progreso-grande">${progreso.porcentajeTotal}%</span></div>
        <div><strong>Estado:</strong> ${badgeEstado(expediente.estado)}</div>` : ''}
        <div>
          <strong>Fase:</strong>
          <select id="select-fase">
            ${fases.map((f) => `<option value="${f.value}" ${f.value === expediente.fase ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
          </select>
        </div>
        <div><strong>Abogado:</strong> ${escapeHtml(expediente.abogado || '—')}</div>
        <div><strong>Alta:</strong> ${fmtFecha(expediente.created_at)}</div>
      </div>
      ${
        esDocumental
          ? `<div class="detalle-acciones">
        <button class="btn-secondary" id="btn-copiar-enlace">Copiar enlace del cliente</button>
        <button class="btn-secondary" id="btn-descargar-zip">Descargar documentación (.zip)</button>
        ${
          progreso.porcentajeTotal >= 100 && expediente.estado !== 'en_redaccion'
            ? '<button class="btn-primary" id="btn-marcar-redaccion">Marcar como "en redacción"</button>'
            : ''
        }
      </div>`
          : ''
      }
    </div>
  `;

  cont.innerHTML = esDocumental
    ? `${cabecera}${progreso.bloques.map((b) => renderBloqueDetalle(id, b)).join('')}`
    : `${cabecera}
       ${renderFichaCliente(id, expediente)}
       ${renderComentarios(comentariosRes.comentarios)}
       ${renderPropuestas(propuestasRes.propuestas, expediente)}
       ${renderImpagos(impagosRes.impagos)}`;

  document.getElementById('select-fase').addEventListener('change', async (e) => {
    await api(`/expedientes/${id}/fase`, { method: 'PUT', body: JSON.stringify({ fase: e.target.value }) });
    cargarExpedientes(); // por si vuelven al listado, que ya se vea actualizado
  });

  if (esDocumental) {
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

    return;
  }

  // --- A partir de aquí, solo para la vista "Expedientes" (ficha de cliente) ---

  async function guardarFichaCliente() {
    const dni = document.getElementById('ficha-dni').value.trim();
    const domicilio = document.getElementById('ficha-domicilio').value.trim();
    const deuda_total = document.getElementById('ficha-deuda').value;
    await api(`/expedientes/${id}/datos-cliente`, {
      method: 'PUT',
      body: JSON.stringify({ dni, domicilio, deuda_total }),
    });
  }
  ['ficha-dni', 'ficha-domicilio', 'ficha-deuda'].forEach((elId) => {
    document.getElementById(elId).addEventListener('change', guardarFichaCliente);
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

  const selectTipoPropuesta = document.getElementById('select-tipo-propuesta');
  if (selectTipoPropuesta) {
    const contDetalle = cont;
    actualizarCamposPlantilla(contDetalle);
    selectTipoPropuesta.addEventListener('change', () => actualizarCamposPlantilla(contDetalle));
    contDetalle.querySelectorAll('input[name="p_forma_pago"]').forEach((r) => {
      r.addEventListener('change', () => actualizarCamposPlantilla(contDetalle));
    });
    document.getElementById('btn-generar-propuesta')?.addEventListener('click', () => {
      const form = document.getElementById('form-propuesta');
      const datos = leerDatosFormularioPropuesta(form, expediente);
      const tipo = selectTipoPropuesta.value;
      let texto = '';
      if (tipo === 'segunda_oportunidad') texto = generarTextoSegundaOportunidad(datos);
      else if (tipo === 'concurso_empresa') texto = generarTextoConcursoEmpresa(datos);
      document.getElementById('textarea-propuesta').value = texto;
    });
  }

  document.getElementById('form-propuesta')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const texto = (fd.get('texto') || '').toString().trim();
    const tipo = (fd.get('tipo') || '').toString();
    if (!texto) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      const { link } = await api(`/expedientes/${id}/propuestas`, { method: 'POST', body: JSON.stringify({ texto, tipo }) });
      await renderDetalle(id);
      abrirModal(`
        <h3>Propuesta enviada</h3>
        <p>Se ha enviado un email al cliente con este enlace para que la lea y la acepte:</p>
        <input type="text" readonly value="${link}" onclick="this.select()" />
        <div class="modal-acciones"><button class="btn-primary" id="modal-ok">Entendido</button></div>
      `);
      document.getElementById('modal-ok').addEventListener('click', cerrarModal);
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Enviar propuesta al cliente';
    }
  });

  document.getElementById('form-impago')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const importe = Number(fd.get('importe'));
    if (!importe || importe <= 0) return alert('El importe debe ser mayor que 0');
    const concepto = (fd.get('concepto') || '').toString().trim();
    const fecha_impago = fd.get('fecha_impago') || '';
    await api(`/expedientes/${id}/impagos`, {
      method: 'POST',
      body: JSON.stringify({ importe, concepto, fecha_impago }),
    });
    renderDetalle(id);
  });

  cont.querySelectorAll('.btn-pagado-impago').forEach((btn) => {
    btn.addEventListener('click', () => marcarImpagoPagado(Number(btn.dataset.id), () => renderDetalle(id)));
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

function badgePropuesta(estado) {
  return estado === 'aceptada'
    ? '<span class="badge badge-completo">Aceptada</span>'
    : '<span class="badge badge-progreso">Enviada, pendiente de aceptar</span>';
}

function etiquetaTipoPropuesta(tipo) {
  const mapa = {
    segunda_oportunidad: 'Ley de Segunda Oportunidad',
    concurso_empresa: 'Concurso de Acreedores Express',
  };
  return mapa[tipo] || 'Texto libre';
}

// ---------------------------------------------------------------------
// Plantillas de propuesta de honorarios (LSO / Concurso de Empresa Express)
// Generan el texto completo a partir de los datos del formulario. El
// abogado puede editar el resultado en la propia caja de texto antes de
// enviarlo.
// ---------------------------------------------------------------------

function fmtEuros(n) {
  const num = Number(n);
  if (!num && num !== 0) return '';
  return num.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtFechaLarga(valor) {
  const d = valor ? new Date(valor) : new Date();
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function bloqueFormaPago(datos) {
  if (datos.formaPago === 'pronto') {
    return (
      `OPCIÓN PRONTO PAGO: pago único de todo el procedimiento, con un importe de ${fmtEuros(datos.importePronto)} € (IVA incluido).`
    );
  }
  return (
    `CUOTA MENSUAL: ${datos.numCuotas || '__'} cuotas de ${fmtEuros(datos.cuotaImporte)} € al mes (IVA incluido).`
  );
}

function generarTextoSegundaOportunidad(datos) {
  const gastosProcurador = datos.gastosProcurador ? `${fmtEuros(datos.gastosProcurador)} € +IVA, pago único` : '200,00 € +IVA, pago único';
  return `PROPUESTA DE SERVICIOS PROFESIONALES
Ley de la Segunda Oportunidad

En Barcelona, a ${fmtFechaLarga(datos.fecha)}

A la atención de D./Dña. ${datos.nombre}, con DNI/NIE ${datos.dni || '__'}, con domicilio en ${datos.direccion || '__'}.

Como continuación a las conversaciones mantenidas en fechas recientes, le remitimos nuestra propuesta de servicios profesionales para el asesoramiento en el Concurso Consecutivo conforme a la Ley de la Segunda Oportunidad, de acuerdo con la Ley 16/2022, de 5 de septiembre, de reforma del texto refundido de la Ley Concursal.

1. ALCANCE DE NUESTROS SERVICIOS
La presente propuesta comprende los trabajos a realizar para el/la Sr./Sra. ${datos.nombre} conforme a la Ley 16/2022, de 5 de septiembre.

El servicio contratado, además del asesoramiento en su materia durante todo el proceso, incluye:
FASE I: Estudio y recopilación de la documentación.
FASE II: Asesoramiento y formulario.
FASE III: Concurso consecutivo y sentencia.

I.- Estudio y análisis de la situación financiera del cliente.
II.- Recopilación de la documentación e información necesaria para llevar a cabo el procedimiento concursal.
III.- Interposición de la demanda judicial para el concurso consecutivo y su tramitación con la finalidad de alcanzar un plan de pagos o la exoneración de las deudas.

La suma global que se presupuesta es retribución básica del servicio encomendado y no incluye otros servicios profesionales que puedan derivar del inicialmente encargado ni las incidencias o recursos que pudieran plantearse, incluso dentro de la primera instancia.

2. EQUIPO DE TRABAJO
Debify ALSP, S.L., con CIF B42718080, es un despacho profesional especializado en la Ley de la Segunda Oportunidad y concurso de empresa.

3. HONORARIOS
3.1 General
Precio total ${datos.formaPago === 'pronto' ? '(con pronto pago)' : 'fraccionado'}: ${fmtEuros(datos.importeTotal)} € +IVA.

Forma de pago:
${bloqueFormaPago(datos)}

Gastos y suplidos: no incluidos en los honorarios. Procurador de los Tribunales: ${gastosProcurador}.

El sistema de pago de DEBIFY se realiza mediante la plataforma de pago colaboradora WANNME, que enviará un enlace por email y sms para elegir el método de pago.

3.2 Facturación y pago
Las facturas se emiten todos los días 1 de cada mes y se cobran ese mismo día. Los trabajos se iniciarán con el cobro de la primera cuota de honorarios.

La prestación de los servicios profesionales por parte de DEBIFY estará condicionada al cumplimiento por el Cliente de las obligaciones económicas asumidas: DEBIFY no procederá a la presentación de la demanda mientras el Cliente no haya satisfecho, al menos, el cincuenta por ciento (50%) del importe total de los honorarios pactados, ni presentará el escrito de solicitud de exoneración del pasivo insatisfecho (EPI) mientras el Cliente no haya satisfecho, al menos, el noventa por ciento (90%) de dichos honorarios. La falta de pago facultará a DEBIFY para suspender las actuaciones profesionales hasta la regularización de las cantidades pendientes.

3.3 Plan de pagos
En caso de tener que elaborar un plan de pagos, los informes semestrales tienen un coste extra de 60 € +IVA por cada informe.

4. DURACIÓN
El presente contrato tendrá la duración necesaria para la realización de los servicios contratados hasta la finalización del proceso o hasta que el Cliente solicite el cese de la prestación de los servicios.

5. CONDICIONES GENERALES
5.1 El incumplimiento del pago de más de 2 mensualidades tendrá como consecuencia la posibilidad de que Debify paralice la prestación del servicio.
5.2 En caso de impago, Debify podrá reclamar judicialmente la totalidad de las mensualidades correspondientes a los trabajos realizados, así como los gastos de devolución, intereses y demás conceptos contenidos en la Ley 3/2004, de 29 de diciembre, de lucha contra la morosidad.
5.3 No se tendrá derecho a la devolución de ninguna cantidad abonada en caso de mala fe, falta de diligencia del cliente, inadmisión de la demanda por errores profesionales ajenos a Debify, desacuerdo del cliente con terceros que impida finalizar el procedimiento, o falta/retraso en el pago de los honorarios.
5.4 El presente contrato quedará extinguido por: a) vencimiento del plazo estipulado, b) cumplimiento de la prestación de los servicios, c) mutuo acuerdo de las partes y d) incumplimiento contractual de las partes.
5.5 Costes de estudio y preparación del expediente: transcurrido el plazo legal de desistimiento, DEBIFY no devolverá las cantidades abonadas por el CLIENTE hasta un importe máximo de MIL EUROS (1.000 €), correspondientes a los servicios ya efectivamente realizados.
5.6 En los supuestos en que se realice un plan de pagos, el cliente asume el posible riesgo de liquidación de la vivienda habitual, la cual se intentará proteger y salvar en todo momento.

6. TRANSPARENCIA
EL CLIENTE se obliga a remitir y facilitar al despacho toda la documentación e información necesaria para el estudio y tramitación del asunto, y a informar de todos los bienes y derechos de su titularidad (vivienda habitual, vehículos, contrato de alquiler, etc.).

El CLIENTE reconoce haber sido informado y acepta la posibilidad de subasta de los bienes que sean de su propiedad en el mismo proceso.

El despacho no asume ninguna función relativa a la verificación de autenticidad, completitud y exactitud de la información que EL CLIENTE proporcione, y no asume responsabilidad en caso de información incompleta, falsa o inexacta, incumplimiento de obligaciones por parte del CLIENTE, no aportación de documentación necesaria, o cualquier acción sobre bienes y derechos llevada a cabo sin conocimiento del despacho.

7. EL CLIENTE HACE CONSTAR
Que ha sido informado por el despacho de las obligaciones que se derivan de la normativa que regula la Ley de Segunda Oportunidad, y manifiesta lo siguiente:
a) Que se encuentra en situación de insolvencia.
b) Que no ha sido condenado en sentencia firme por delitos contra el patrimonio, el orden socioeconómico, falsedad documental, la Hacienda Pública, la Seguridad Social o los derechos de los trabajadores en los 10 años anteriores.
c) Que no ha alcanzado un acuerdo extrajudicial de pagos con los acreedores u obtenida homologación judicial de un acuerdo de refinanciación ni ha sido declarado en concurso de acreedores en los últimos 5 años.
d) Que no se encuentra negociando con sus acreedores un acuerdo de refinanciación ni tiene una solicitud de concurso de acreedores admitida a trámite.
e) Que es conocedor de que cualquier acuerdo extrajudicial de pagos o extinción de deudas no afectará a las deudas con las administraciones públicas.
f) Que mientras dure el procedimiento se compromete a no utilizar tarjetas de crédito, endeudarse ni pedir créditos, ni realizar compras o ventas de bienes muebles o inmuebles relevantes.
g) El cliente otorga su consentimiento expreso para la cesión del presente contrato de prestación de servicios.
h) El CLIENTE queda informado de que la exoneración del pasivo insatisfecho podrá ser denegada si el órgano judicial aprecia sobreendeudamiento negligente o temerario.
i) El CLIENTE se obliga a cumplimentar de forma completa, veraz y en plazo los formularios habilitados en la plataforma de Debify, imprescindibles para la correcta preparación y presentación de la demanda.

8. DATOS DE CARÁCTER PERSONAL
En cumplimiento de la normativa sobre protección de datos de carácter personal, el Cliente queda informado de que sus datos personales quedan incorporados en ficheros cuya responsabilidad corresponde a DEBIFY ALSP, S.L. Para el ejercicio de sus derechos, el Cliente podrá dirigirse a info@debify.es.

Ambas partes firman el presente Encargo de Servicios Profesionales en señal de conformidad con los términos que en esta propuesta se describen.`;
}

function generarTextoConcursoEmpresa(datos) {
  return `PROPUESTA DE SERVICIOS PROFESIONALES
Concurso de Acreedores Express

En Barcelona, a ${fmtFechaLarga(datos.fecha)}

A la atención de D./Dña. ${datos.nombre}, con DNI/NIE ${datos.dni || '__'}, en representación de ${datos.razonSocial || '__'}, con CIF ${datos.cifEmpresa || '__'} y domicilio en ${datos.direccion || '__'}.

Como continuación a las conversaciones mantenidas en fechas recientes, le remitimos nuestra propuesta de servicios profesionales para el acompañamiento en el concurso de acreedores exprés de ${datos.razonSocial || '__'}, con CIF ${datos.cifEmpresa || '__'} y domicilio en ${datos.direccion || '__'}.

1. ALCANCE DE NUESTROS SERVICIOS
La presente propuesta comprende los trabajos a realizar conforme al Real Decreto Legislativo 1/2020, por el que se aprueba el texto refundido de la Ley Concursal.

El procedimiento que incluye el servicio es el siguiente:
FASE I: Estudio documentación.
FASE II: Redacción demanda de concurso.
FASE III: Seguimiento proceso.
FASE IV: Auto de declaración de concurso y conclusión del mismo.

I.- Revisión de documentación para confección de demanda de concurso, con recomendación de ajustes al balance de situación.
II.- Redacción de demanda de concurso y anexo de documentación conforme a la Ley. Contratación de procurador y presentación de la demanda al juzgado.
III.- Seguimiento judicial de la demanda de concurso de acreedores.
IV.- Cierre del concurso de acreedores y seguimiento de extinción de la sociedad en el Registro Mercantil.

La suma global que se presupuesta es retribución básica del servicio encomendado y no incluye otros servicios profesionales que puedan derivar del inicialmente encargado ni las incidencias o recursos que pudieran plantearse. En caso de acuerdo o desistimiento unilateral por parte del cliente, no se devolverá ninguna cantidad.

2. EQUIPO DE TRABAJO
Debify ALSP, S.L., con CIF B42718080, es un despacho profesional especializado en la Ley de la Segunda Oportunidad y concurso de empresa.

3. HONORARIOS
3.1 General
Precio total: ${fmtEuros(datos.importeTotal)} € +IVA.
No están incluidos los gastos de Procurador y posibles gastos de registro mercantil${datos.gastosProcurador ? `, que ascienden a ${fmtEuros(datos.gastosProcurador)} € (IVA incluido)` : ''}.

Forma de pago:
${bloqueFormaPago(datos)}

El sistema de pago de DEBIFY se realiza mediante la plataforma de pago colaboradora WANNME, que enviará un enlace por email y sms para elegir el método de pago.

3.2 Facturación y pago
Las facturas son pagaderas de acuerdo con los datos incluidos en las mismas, en el plazo de un mes a contar desde la fecha de su emisión. Los trabajos se iniciarán con el cobro de la primera partida de honorarios. En caso de acuerdo o desistimiento unilateral por parte del cliente, no se devolverá ninguna cantidad.

3.3 Plan de pagos
En caso de tener que elaborar un plan de pagos, los informes semestrales tienen un coste extra de 60 € +IVA por cada informe.

4. DURACIÓN
El presente contrato tendrá la duración necesaria para la realización de los servicios contratados hasta la finalización del proceso o hasta que el Cliente solicite el cese de la prestación de los servicios.

5. CONDICIONES GENERALES
5.1 La presente propuesta constituye el acuerdo completo entre el Cliente y Debify Alsp, SL, en adelante "DEBIFY", en relación con los servicios descritos.
5.2 No se incluyen honorarios de procurador, suplidos, desplazamientos y tasas.
5.3 El incumplimiento del pago de una mensualidad tendrá como consecuencia la posibilidad de que Debify paralice la prestación del servicio.
5.4 En caso de impago, Debify podrá reclamar judicialmente la totalidad de las mensualidades correspondientes a los trabajos realizados, así como los gastos de devolución, intereses y demás conceptos contenidos en la Ley 3/2004, de 29 de diciembre, de lucha contra la morosidad.
5.5 El cliente autoriza la cesión del presente contrato.
5.6 Costes de estudio y preparación del expediente: transcurrido el plazo legal de desistimiento, DEBIFY no devolverá las cantidades abonadas por el CLIENTE hasta un importe máximo de MIL EUROS (1.000 €), correspondientes a los servicios ya efectivamente realizados.

6. TRANSPARENCIA
EL CLIENTE se obliga a remitir y facilitar al despacho toda la documentación e información necesaria para el estudio y tramitación del asunto, y a informar de todos los bienes y derechos de su titularidad. El despacho no asume ninguna función relativa a la verificación de autenticidad, completitud y exactitud de la información que EL CLIENTE proporcione.

7. EL CLIENTE HACE CONSTAR
a) Que se encuentra en situación de insolvencia.
b) Que no ha sido condenado en sentencia firme por delitos contra el patrimonio, el orden socioeconómico, falsedad documental, la Hacienda Pública, la Seguridad Social o los derechos de los trabajadores en los 10 años anteriores.
c) Que no ha alcanzado un acuerdo extrajudicial de pagos con los acreedores u obtenida homologación judicial de un acuerdo de refinanciación ni ha sido declarado en concurso de acreedores en los últimos 5 años.
d) Que no se encuentra negociando con sus acreedores un acuerdo de refinanciación ni tiene una solicitud de concurso de acreedores admitida a trámite.
e) Que es conocedor de que cualquier acuerdo extrajudicial de pagos o extinción de deudas no afectará a las deudas con las administraciones públicas.
f) Que mientras dure el procedimiento se compromete a no utilizar tarjetas de crédito, endeudarse ni pedir créditos, ni realizar compras o ventas de bienes muebles o inmuebles relevantes.
g) El cliente otorga su consentimiento expreso para la cesión del presente contrato de prestación de servicios.

8. DATOS DE CARÁCTER PERSONAL
En cumplimiento de la normativa sobre protección de datos de carácter personal, el Cliente queda informado de que sus datos personales quedan incorporados en ficheros cuya responsabilidad corresponde a DEBIFY ALSP, S.L. Para el ejercicio de sus derechos, el Cliente podrá dirigirse a info@debify.es.

Ambas partes firman el presente Encargo de Servicios Profesionales en señal de conformidad con los términos que en esta propuesta se describen.`;
}

function leerDatosFormularioPropuesta(form, expediente) {
  const fd = new FormData(form);
  return {
    nombre: (fd.get('p_nombre') || expediente.nombre || '').toString().trim(),
    dni: (fd.get('p_dni') || '').toString().trim(),
    direccion: (fd.get('p_direccion') || '').toString().trim(),
    razonSocial: (fd.get('p_razon_social') || '').toString().trim(),
    cifEmpresa: (fd.get('p_cif_empresa') || '').toString().trim(),
    fecha: (fd.get('p_fecha') || '').toString().trim(),
    importeTotal: fd.get('p_importe_total'),
    formaPago: (fd.get('p_forma_pago') || 'cuota').toString(),
    cuotaImporte: fd.get('p_cuota_importe'),
    numCuotas: fd.get('p_num_cuotas'),
    importePronto: fd.get('p_importe_pronto'),
    gastosProcurador: fd.get('p_gastos_procurador'),
  };
}

function actualizarCamposPlantilla(cont) {
  const tipo = cont.querySelector('#select-tipo-propuesta').value;
  cont.querySelector('#campos-plantilla-propuesta').classList.toggle('hidden', tipo === 'libre');
  cont.querySelector('#campos-empresa-propuesta').classList.toggle('hidden', tipo !== 'concurso_empresa');
  const formaPago = cont.querySelector('input[name="p_forma_pago"]:checked')?.value || 'cuota';
  cont.querySelector('#campos-forma-cuota').classList.toggle('hidden', formaPago !== 'cuota');
  cont.querySelector('#campos-forma-pronto').classList.toggle('hidden', formaPago !== 'pronto');
}

function renderPropuestas(propuestas, expediente) {
  return `
    <div class="bloque-card">
      <div class="bloque-card-header">
        <h3>Propuesta de honorarios</h3>
        <span class="muted">Aceptación sencilla (check + nombre), no es firma electrónica formal</span>
      </div>
      <form id="form-propuesta" class="form-comentario">
        <label class="muted">Plantilla</label>
        <select id="select-tipo-propuesta" name="tipo">
          <option value="segunda_oportunidad">Ley de Segunda Oportunidad</option>
          <option value="concurso_empresa">Concurso de Acreedores Express</option>
          <option value="libre">Texto libre (sin plantilla)</option>
        </select>

        <div id="campos-plantilla-propuesta" class="campos-plantilla-propuesta">
          <div class="campos-fila">
            <label>Nombre completo<input type="text" name="p_nombre" value="${escapeHtml(expediente?.nombre || '')}" /></label>
            <label>DNI/NIE<input type="text" name="p_dni" /></label>
          </div>
          <label>Domicilio<input type="text" name="p_direccion" /></label>

          <div id="campos-empresa-propuesta" class="campos-fila hidden">
            <label>Razón social de la empresa<input type="text" name="p_razon_social" /></label>
            <label>CIF de la empresa<input type="text" name="p_cif_empresa" /></label>
          </div>

          <div class="campos-fila">
            <label>Fecha de la propuesta<input type="date" name="p_fecha" /></label>
            <label>Importe total honorarios (€, +IVA)<input type="number" step="0.01" min="0" name="p_importe_total" /></label>
          </div>

          <label class="muted">Forma de pago</label>
          <div class="campos-fila">
            <label class="fila-check"><input type="radio" name="p_forma_pago" value="cuota" checked /> Cuota mensual</label>
            <label class="fila-check"><input type="radio" name="p_forma_pago" value="pronto" /> Pronto pago (importe único)</label>
          </div>
          <div id="campos-forma-cuota" class="campos-fila">
            <label>Importe de la cuota (€/mes)<input type="number" step="0.01" min="0" name="p_cuota_importe" /></label>
            <label>Número de cuotas<input type="number" step="1" min="1" name="p_num_cuotas" /></label>
          </div>
          <div id="campos-forma-pronto" class="campos-fila hidden">
            <label>Importe único con descuento (€, IVA incluido)<input type="number" step="0.01" min="0" name="p_importe_pronto" /></label>
          </div>

          <label>Gastos de procurador (€, opcional)<input type="number" step="0.01" min="0" name="p_gastos_procurador" /></label>

          <button type="button" id="btn-generar-propuesta" class="btn-secondary">Generar texto de la propuesta</button>
        </div>

        <textarea name="texto" id="textarea-propuesta" rows="8" placeholder="Escribe aquí el texto de la propuesta de honorarios que recibirá el cliente, o genera uno a partir de una plantilla de arriba..." required></textarea>
        <button type="submit" class="btn-primary">Enviar propuesta al cliente</button>
      </form>
      ${
        propuestas.length === 0
          ? '<p class="muted" style="margin-top:.75rem">Todavía no se ha enviado ninguna propuesta.</p>'
          : `<div class="lista-comentarios">
              ${propuestas
                .map(
                  (p) => `
                <div class="comentario">
                  <div class="comentario-cabecera">
                    ${badgePropuesta(p.estado)}
                    <span class="badge badge-fase">${escapeHtml(etiquetaTipoPropuesta(p.tipo))}</span>
                    <span class="muted">Enviada el ${fmtFechaHora(p.enviada_at)}</span>
                  </div>
                  ${
                    p.estado === 'aceptada'
                      ? `<div class="item-valor" style="color:var(--verde)">Aceptada por ${escapeHtml(p.aceptada_nombre)} el ${fmtFechaHora(p.aceptada_at)} — <a href="/propuesta/?token=${p.token}" target="_blank" rel="noopener">ver / descargar</a></div>`
                      : `<div class="item-valor"><a href="/propuesta/?token=${p.token}" target="_blank" rel="noopener">ver enlace del cliente</a></div>`
                  }
                  <div class="comentario-texto muted" style="margin-top:.4rem">${escapeHtml(p.texto)}</div>
                </div>`
                )
                .join('')}
            </div>`
      }
    </div>
  `;
}

function renderImpagos(impagos) {
  return `
    <div class="bloque-card">
      <div class="bloque-card-header">
        <h3>Impagados</h3>
        <span class="muted">Registra aquí una cuota impagada; los avisos por email se envían solos</span>
      </div>
      <form id="form-impago" class="form-comentario">
        <input type="number" step="0.01" min="0.01" name="importe" placeholder="Importe (€)" required />
        <input type="text" name="concepto" placeholder="Concepto (opcional)" />
        <label class="muted" style="margin-top:.25rem">Fecha del impago</label>
        <input type="date" name="fecha_impago" />
        <button type="submit" class="btn-primary">Registrar impago</button>
      </form>
      ${
        impagos.length === 0
          ? '<p class="muted" style="margin-top:.75rem">No hay impagos registrados en este expediente.</p>'
          : `<div class="lista-comentarios">
              ${impagos
                .map(
                  (imp) => `
                <div class="comentario">
                  <div class="comentario-cabecera">
                    <strong>${Number(imp.importe).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</strong>
                    ${etiquetaNivelAviso(imp)}
                    <span class="muted">Impago desde el ${fmtFecha(imp.fecha_impago)}</span>
                  </div>
                  ${imp.concepto ? `<div class="comentario-texto muted">${escapeHtml(imp.concepto)}</div>` : ''}
                  ${
                    imp.estado === 'pendiente'
                      ? `<div class="detalle-acciones" style="margin-top:.4rem"><button class="btn-secondary btn-pagado-impago" data-id="${imp.id}">Marcar como pagado</button></div>`
                      : `<div class="item-valor" style="color:var(--verde)">Pagado el ${fmtFechaHora(imp.pagado_at)}</div>`
                  }
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
