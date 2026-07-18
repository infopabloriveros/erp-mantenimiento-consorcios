let state = { clientes: [], administraciones: [], administradores: [], contactos: [], unidades: [], servicios: [], presupuestos: [], detalle: [], trabajos: [], fotos: [], facturas: [], cobros: [], gastos: [], config: {}, dashboard: {}, lookups: {} };
let selectedCliente = null;
let reportGroup = 'month';
let compareGroup = 'month';
let compareBaseDate = new Date().toISOString().slice(0, 10);
let agendaView = 'week';
let agendaDate = new Date().toISOString().slice(0, 10);
let dashboardEndDate = new Date().toISOString().slice(0, 10);
let dashboardStartDate = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
})();
let clientSearch = '';
let clientTypeFilter = 'Todos';
let contactSearch = '';
let selectedContactClientId = '';
let contactRoleFilter = 'Todos';
let currentUser = '';
let loadingCount = 0;
let loadingTimer = null;

window.addEventListener('load', async () => {
  bindAuth();
  bindNav();
  bindGlobalSearch();
  bindCompactMenus();
  await checkSession();
});

function bindCompactMenus() {
  document.addEventListener('toggle', event => {
    const menu = event.target;
    if (!menu.matches?.('.rowMenu') || !menu.open) return;
    document.querySelectorAll('.rowMenu[open]').forEach(other => {
      if (other !== menu) other.open = false;
    });
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest?.('.rowMenu')) return;
    document.querySelectorAll('.rowMenu[open]').forEach(menu => { menu.open = false; });
  });
}

async function api(url, options = {}) {
  const { loadingMessage, silentLoading, ...fetchOptions } = options;
  const loadingLabel = loadingMessage || apiLoadingMessage(url, fetchOptions);
  if (!silentLoading) showLoading(loadingLabel);
  try {
    const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) }, ...fetchOptions });
    const result = await response.json().catch(() => ({ ok: false, message: 'Respuesta invalida del servidor' }));
    if (response.status === 401) {
      showLogin();
      throw new Error(result.message || 'Necesitas iniciar sesion.');
    }
    if (!result.ok) throw new Error(result.message || 'Error inesperado');
    return result.data;
  } finally {
    if (!silentLoading) hideLoading();
  }
}

function apiLoadingMessage(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (url.includes('/auth/login')) return 'Iniciando sesion...';
  if (url.includes('/auth/logout')) return 'Cerrando sesion...';
  if (url.includes('/initial-data')) return 'Cargando datos del ERP...';
  if (url.includes('/correos')) return 'Enviando correo...';
  if (url.includes('/facturas')) return 'Guardando factura...';
  if (url.includes('/presupuestos') && method === 'POST') return 'Generando presupuesto y PDF...';
  if (method === 'DELETE') return 'Eliminando registro...';
  if (method !== 'GET') return 'Guardando cambios...';
  return 'Cargando informacion...';
}

function showLoading(message = 'Procesando...') {
  loadingCount += 1;
  const overlay = document.getElementById('loadingOverlay');
  const text = document.getElementById('loadingText');
  if (text) text.textContent = message;
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => overlay?.classList.remove('hidden'), 250);
}

function hideLoading() {
  loadingCount = Math.max(loadingCount - 1, 0);
  if (loadingCount > 0) return;
  clearTimeout(loadingTimer);
  document.getElementById('loadingOverlay')?.classList.add('hidden');
}

function bindAuth() {
  const form = document.getElementById('loginForm');
  const logout = document.getElementById('logoutBtn');
  form?.addEventListener('submit', login);
  logout?.addEventListener('click', logoutSession);
}

async function checkSession() {
  try {
    const session = await api('/api/auth/session');
    if (session.authenticated) {
      currentUser = session.user || '';
      hideLogin();
      await loadData();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin();
  }
}

async function login(event) {
  event.preventDefault();
  const errorBox = document.getElementById('loginError');
  errorBox.textContent = '';
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Entrando...';
  try {
    const user = document.getElementById('loginUser').value;
    const password = document.getElementById('loginPassword').value;
    const session = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ user, password }) });
    currentUser = session.user || user;
    document.getElementById('loginPassword').value = '';
    hideLogin();
    await loadData();
  } catch (error) {
    errorBox.textContent = error.message || 'No se pudo iniciar sesion.';
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar';
  }
}

async function logoutSession() {
  try {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch (error) {
    // La salida local igual debe cerrar la pantalla si la sesion ya no existe.
  }
  currentUser = '';
  showLogin();
}

function showLogin() {
  document.body.classList.add('auth-locked');
  document.getElementById('loginScreen')?.classList.remove('hidden');
  setTimeout(() => document.getElementById('loginUser')?.focus(), 30);
}

function hideLogin() {
  document.body.classList.remove('auth-locked');
  document.getElementById('loginScreen')?.classList.add('hidden');
}

function bindNav() {
  document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view).classList.add('active');
    document.getElementById('pageTitle').textContent = btn.textContent;
  }));
}

async function loadData() {
  try {
    state = await api('/api/initial-data');
    renderAll();
  } catch (error) {
    showError(error);
  }
}

function renderAll() {
  renderDashboard();
  renderClientes();
  renderAdministraciones();
  renderContactos();
  renderServicios();
  renderPresupuestos();
  renderKanban();
  renderCalendar();
  renderCobros();
  renderFacturas();
  renderCorreos();
  renderGastos();
}

function renderDashboard() {
  const d = state.dashboard || {};
  const range = selectedDashboardRange();
  const previous = previousSameLengthRange(range);
  const currentMetrics = metricsForRange(range.start, range.end);
  const previousMetrics = metricsForRange(previous.start, previous.end);

  document.getElementById('dashboardCards').innerHTML = `
    <div class="dashboardToolbar">
      <div>
        <h2>Resumen operativo</h2>
        <p>${formatRange(range)} comparado con ${formatRange(previous)}</p>
      </div>
      <div class="dateFilters">
        <label>Desde<input type="date" value="${dashboardStartDate}" onchange="dashboardStartDate=this.value;renderDashboard()"></label>
        <label>Hasta<input type="date" value="${dashboardEndDate}" onchange="dashboardEndDate=this.value;renderDashboard()"></label>
      </div>
    </div>
    <div class="dashboardKpis">
      ${metricCard('Ingresos', currentMetrics.ingresos, previousMetrics.ingresos, true)}
      ${metricCard('Facturado', currentMetrics.facturado, previousMetrics.facturado, true)}
      ${metricCard('Ganancia', currentMetrics.ganancia, previousMetrics.ganancia, true)}
      ${metricCard('Presupuestos en agenda', currentMetrics.trabajos, previousMetrics.trabajos)}
      ${metricCard('Visitas / Emergencias', currentMetrics.servicios, previousMetrics.servicios)}
      ${metricCard('Presupuestos', currentMetrics.presupuestos, previousMetrics.presupuestos)}
      ${metricCard('Facturas pendientes', currentMetrics.facturasPendientesImporte, previousMetrics.facturasPendientesImporte, true, true)}
    </div>
    <div class="portfolioStrip">
      <div class="miniStat"><span>Clientes</span><b>${d.clientes || 0}</b></div>
      <div class="miniStat"><span>Consorcios</span><b>${d.consorcios || 0}</b></div>
      <div class="miniStat"><span>Servicios pendientes</span><b>${d.serviciosPendientes || 0}</b></div>
      <div class="miniStat"><span>Presupuestos pendientes</span><b>${d.pendientes || 0}</b></div>
      <div class="miniStat"><span>Facturas pendientes</span><b>${d.facturasPendientes || 0}</b></div>
      <div class="miniStat"><span>Pendiente de cobro</span><b>${money(d.facturasPendientesImporte || 0)}</b></div>
    </div>
  `;
  renderDashboardReport();
}

function renderDashboardReport() {
  const range = selectedDashboardRange();
  const rows = buildReportRows(reportGroup).filter(row => {
    const d = parsePeriodSortDate(row.sort, reportGroup);
    return d && d >= range.start && d <= range.end;
  });

  document.getElementById('dashboardReport').innerHTML = `
    <div class="sectionHead">
      <div>
        <h2>Detalle del período</h2>
        <p>Vista compacta para revisar cómo se compone el resultado.</p>
      </div>
      <div class="reportActions">
        <select onchange="reportGroup=this.value;renderDashboardReport()">
          <option value="week" ${reportGroup === 'week' ? 'selected' : ''}>Semana</option>
          <option value="month" ${reportGroup === 'month' ? 'selected' : ''}>Mes</option>
          <option value="year" ${reportGroup === 'year' ? 'selected' : ''}>Año</option>
        </select>
        <button class="secondaryBtn" onclick="exportReportCsv()">Exportar CSV</button>
      </div>
    </div>
    <div class="tableWrap">
      <table>
        <thead><tr><th>Periodo</th><th>Presupuestos en agenda</th><th>Visitas/Emergencias</th><th>Presupuestos</th><th>Ingresos</th><th>Gastos</th><th>Ganancia</th></tr></thead>
        <tbody>${rows.length ? rows.map(row => `
          <tr>
            <td><b>${esc(row.label)}</b></td>
            <td>${row.trabajos}</td>
            <td>${row.servicios}</td>
            <td>${row.presupuestos}</td>
            <td>${money(row.ingresos)}</td>
            <td>${money(row.gastos)}</td>
            <td>${money(row.ganancia)}</td>
          </tr>
        `).join('') : '<tr><td colspan="7" class="muted">Todavia no hay movimientos para reportar.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function metricCard(title, current, previous, isMoney = false, inverseGood = false) {
  const diff = current - previous;
  const pct = previous === 0 ? (current === 0 ? 0 : 100) : (diff / previous) * 100;
  const good = inverseGood ? diff <= 0 : diff >= 0;
  const cls = good ? 'positive' : 'negative';
  const symbol = diff === 0 ? '=' : diff > 0 ? '+' : '';
  return `<div class="kpiCard">
    <div class="label">${title}</div>
    <div class="value">${isMoney ? money(current) : current}</div>
    <div class="variation ${cls}">${symbol}${pct.toFixed(1)}% vs período anterior</div>
    <div class="previous">Antes: ${isMoney ? money(previous) : previous}</div>
  </div>`;
}

function selectedDashboardRange() {
  const start = parseDate(dashboardStartDate) || new Date();
  const end = parseDate(dashboardEndDate) || new Date();
  return normalizeRange(start <= end ? start : end, start <= end ? end : start);
}

function previousSameLengthRange(range) {
  const days = Math.max(1, Math.round((range.end - range.start) / 86400000) + 1);
  const end = new Date(range.start);
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return normalizeRange(start, end);
}

function buildReportRows(group) {
  const map = {};
  const touch = dateValue => {
    const d = parseDate(dateValue);
    if (!d) return null;
    const key = periodKey(d, group);
    if (!map[key]) map[key] = { key, label: periodLabel(d, group), sort: key, trabajos: 0, servicios: 0, presupuestos: 0, ingresos: 0, gastos: 0, ganancia: 0 };
    return map[key];
  };

  (state.trabajos || []).filter(t => t.Estado !== 'Cancelado').forEach(t => {
    const row = touch(t.Fecha_Programada || t.Fecha_Creacion);
    if (row) row.trabajos += 1;
  });
  (state.servicios || []).filter(s => s.Estado !== 'Cancelado').forEach(s => {
    const row = touch(s.Fecha);
    if (row) row.servicios += 1;
  });
  (state.presupuestos || []).filter(p => p.Estado !== 'Rechazado').forEach(p => {
    const row = touch(p.Fecha || p.Fecha_Creacion);
    if (row) row.presupuestos += 1;
  });
  (state.cobros || []).forEach(c => {
    const row = touch(c.Fecha);
    if (row) row.ingresos += Number(c.Importe || 0);
  });
  (state.gastos || []).forEach(g => {
    const row = touch(g.Fecha);
    if (row) row.gastos += Number(g.Importe || 0);
  });

  return Object.values(map).map(row => {
    row.ganancia = row.ingresos - row.gastos;
    return row;
  }).sort((a, b) => b.sort.localeCompare(a.sort));
}

function renderComparison() {
  const baseDate = parseDate(compareBaseDate) || new Date();
  const currentRange = periodRange(baseDate, compareGroup, 0);
  const previousRange = periodRange(baseDate, compareGroup, -1);
  const current = metricsForRange(currentRange.start, currentRange.end);
  const previous = metricsForRange(previousRange.start, previousRange.end);
  const rows = [
    ['Presupuestos en agenda', current.trabajos, previous.trabajos, false],
    ['Visitas/Emergencias', current.servicios, previous.servicios, false],
    ['Presupuestos', current.presupuestos, previous.presupuestos, false],
    ['Ingresos', current.ingresos, previous.ingresos, true],
    ['Gastos', current.gastos, previous.gastos, true],
    ['Ganancia', current.ganancia, previous.ganancia, true]
  ];
  return `
    <div class="compareGrid">
      <div class="historyPanel"><h3>Periodo actual</h3><p>${formatRange(currentRange)}</p></div>
      <div class="historyPanel"><h3>Periodo anterior</h3><p>${formatRange(previousRange)}</p></div>
    </div>
    <div class="tableWrap">
      <table>
        <thead><tr><th>Métrica</th><th>Actual</th><th>Anterior</th><th>Diferencia</th><th>Variación</th></tr></thead>
        <tbody>${rows.map(([labelText, nowValue, prevValue, isMoney]) => {
          const diff = nowValue - prevValue;
          const pct = prevValue === 0 ? (nowValue === 0 ? 0 : 100) : (diff / prevValue) * 100;
          return `<tr>
            <td><b>${labelText}</b></td>
            <td>${isMoney ? money(nowValue) : nowValue}</td>
            <td>${isMoney ? money(prevValue) : prevValue}</td>
            <td class="${diff >= 0 ? 'positive' : 'negative'}">${isMoney ? money(diff) : diff}</td>
            <td class="${diff >= 0 ? 'positive' : 'negative'}">${pct.toFixed(1)}%</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
}

function metricsForRange(start, end) {
  const inRange = value => {
    const d = parseDate(value);
    return d && d >= start && d <= end;
  };
  const trabajos = (state.trabajos || []).filter(t => t.Estado !== 'Cancelado' && inRange(t.Fecha_Programada || t.Fecha_Creacion)).length;
  const servicios = (state.servicios || []).filter(s => s.Estado !== 'Cancelado' && inRange(s.Fecha)).length;
  const presupuestos = (state.presupuestos || []).filter(p => p.Estado !== 'Rechazado' && inRange(p.Fecha || p.Fecha_Creacion)).length;
  const ingresos = (state.cobros || []).filter(c => inRange(c.Fecha)).reduce((a, c) => a + Number(c.Importe || 0), 0);
  const gastos = (state.gastos || []).filter(g => inRange(g.Fecha)).reduce((a, g) => a + Number(g.Importe || 0), 0);
  const facturas = (state.facturas || []).filter(f => f.Estado !== 'Anulada' && inRange(f.Fecha || f.Fecha_Carga));
  const facturado = facturas.reduce((a, f) => a + Number(f.Importe || 0), 0);
  const facturasPendientesImporte = facturas
    .filter(f => f.Estado !== 'Cobrada')
    .reduce((a, f) => a + Number(f.Importe || 0), 0);
  return { trabajos, servicios, presupuestos, ingresos, gastos, facturado, facturasPendientesImporte, ganancia: ingresos - gastos };
}

function periodRange(date, group, offset) {
  const d = new Date(date);
  if (group === 'day') {
    d.setDate(d.getDate() + offset);
    return dayRange(d);
  }
  if (group === 'week') {
    d.setDate(d.getDate() + offset * 7);
    const day = (d.getDay() + 6) % 7;
    const start = new Date(d);
    start.setDate(d.getDate() - day);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return normalizeRange(start, end);
  }
  if (group === 'year') {
    const year = d.getFullYear() + offset;
    return normalizeRange(new Date(year, 0, 1), new Date(year, 11, 31));
  }
  const year = d.getFullYear();
  const month = d.getMonth() + offset;
  return normalizeRange(new Date(year, month, 1), new Date(year, month + 1, 0));
}

function dayRange(date) {
  return normalizeRange(new Date(date.getFullYear(), date.getMonth(), date.getDate()), new Date(date.getFullYear(), date.getMonth(), date.getDate()));
}

function normalizeRange(start, end) {
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function formatRange(range) {
  return `${range.start.toLocaleDateString('es-AR')} al ${range.end.toLocaleDateString('es-AR')}`;
}

function renderServicios() {
  const cols = ['Fecha', 'Cliente_Nombre', 'Documento', 'Tipo', 'Titulo', 'Estado', 'Facturacion', 'Saldo'];
  const rows = (state.servicios || []).map(s => ({ ...s, Documento: clientDocumentText(s.Cliente_ID), Facturacion: serviceBillingLabel(s) }));
  renderTable('serviciosTable', rows, cols, r => actionMenu([
    `<button class="secondaryBtn" onclick="openServicioDetalleModal('${r.ID}')">Ver detalle</button>`,
    `<button class="secondaryBtn" onclick="openServicioModal('${r.ID}')">Editar</button>`,
    invoiceActionForService(r),
    `<button class="secondaryBtn" onclick="openPresupuestoDesdeServicio('${r.ID}')">Presupuestar</button>`,
    `<button class="dangerBtn" onclick="deleteRow('Servicios','${r.ID}')">Eliminar</button>`
  ]));
}

function invoiceActionForService(s) {
  const billing = serviceBilling(s);
  if (billing.pendienteFacturar > 0) return `<button class="secondaryBtn" onclick="openFacturaModal('', {servicioId:'${s.ID}'})">Factura</button>`;
  const pending = billing.facturas.find(f => f.Estado !== 'Cobrada');
  if (pending) return `<button class="secondaryBtn" onclick="openFacturaDetalleModal('${pending.ID}')">Cobrar</button>`;
  return '';
}

function serviceBillingLabel(s) {
  const billing = serviceBilling(s);
  if (!billing.facturas.length) return 'Sin factura';
  if (billing.facturas.some(f => f.Estado === 'Pendiente de cobro')) return 'Facturado - pendiente de cobro';
  if (billing.facturas.every(f => f.Estado === 'Cobrada')) return 'Facturado - cobrado';
  return 'Facturado';
}

function openServicioDetalleModal(id) {
  const s = state.servicios.find(x => x.ID === id);
  if (!s) return;
  const billing = serviceBilling(s);
  const cobros = (state.cobros || []).filter(c => c.Servicio_ID === id);
  openModal('Detalle de visita/emergencia', `
    <div class="formGrid">
      <div class="field"><label>Servicio</label><input value="${esc(s.ID)}" disabled></div>
      <div class="field"><label>Estado</label><input value="${esc(s.Estado || '')}" disabled></div>
      <div class="field full"><label>Cliente</label><input value="${esc(s.Cliente_Nombre || '')}" disabled></div>
      <div class="field"><label>CUIT / DNI</label><input value="${esc(clientDocumentText(s.Cliente_ID))}" disabled></div>
      <div class="field"><label>Tipo</label><input value="${esc(s.Tipo || '')}" disabled></div>
      <div class="field"><label>Titulo</label><input value="${esc(s.Titulo || '')}" disabled></div>
      <div class="field full"><label>Direccion</label><input value="${esc([s.Direccion, s.Unidad_Trabajo].filter(Boolean).join(' - '))}" disabled></div>
      <div class="field full"><label>Detalle</label><textarea disabled>${esc(s.Detalle || '')}</textarea></div>
      <div class="field"><label>Total</label><input value="${money(billing.total)}" disabled></div>
      <div class="field"><label>Facturado</label><input value="${money(billing.facturado)}" disabled></div>
      <div class="field"><label>Pendiente de facturar</label><input value="${money(billing.pendienteFacturar)}" disabled></div>
      <div class="field"><label>Pendiente de cobrar</label><input value="${money(billing.saldoCobro)}" disabled></div>
      <div class="field full"><label>Facturas vinculadas</label>
        <div class="paymentList">${billing.facturas.map(f => `<p><b>${esc(f.Factura_Nro || f.ID)}</b> - ${money(f.Importe)} - ${esc(f.Estado || '')} ${f.Drive_URL ? `- <a class="link" href="${esc(f.Drive_URL)}" target="_blank">Ver PDF</a>` : ''}</p>`).join('') || '<span class="muted">Sin facturas vinculadas.</span>'}</div>
      </div>
      <div class="field full"><label>Cobros vinculados</label>
        <div class="paymentList">${cobros.map(c => `<p><b>${esc(c.Fecha || '')}</b> - ${money(c.Importe)} - ${esc(c.Medio_Pago || '')}</p>`).join('') || '<span class="muted">Sin cobros cargados.</span>'}</div>
      </div>
    </div>
    <div class="modalActions">
      <button class="secondaryBtn" onclick="openServicioModal('${id}')">Editar</button>
      <button onclick="openFacturaModal('', {servicioId:'${id}'})">Nueva factura</button>
    </div>`);
}

function renderClientes() {
  const q = clientSearch.toLowerCase().trim();
  const rows = state.clientes.filter(c => {
    const matchText = `${c.ID} ${c.Tipo} ${c.Nombre} ${c.Documento_Tipo} ${c.CUIT_DNI} ${c.Direccion} ${c.Telefono} ${c.Whatsapp} ${c.Email}`.toLowerCase().includes(q);
    const matchType = clientTypeFilter === 'Todos' || c.Tipo === clientTypeFilter;
    return matchText && matchType;
  });
  const counts = {
    total: state.clientes.length,
    consorcios: state.clientes.filter(c => c.Tipo === 'Consorcio').length,
    particulares: state.clientes.filter(c => c.Tipo === 'Particular').length,
    empresas: state.clientes.filter(c => c.Tipo === 'Empresa').length
  };
  counts.conDocumento = state.clientes.filter(c => c.CUIT_DNI).length;

  document.getElementById('clientesContent').innerHTML = `
    <div class="clientToolbar">
      <input value="${esc(clientSearch)}" placeholder="Buscar por nombre, direccion, CUIT, telefono..." oninput="clientSearch=this.value;renderClientes()">
      <select onchange="clientTypeFilter=this.value;renderClientes()">
        <option ${clientTypeFilter === 'Todos' ? 'selected' : ''}>Todos</option>
        <option ${clientTypeFilter === 'Consorcio' ? 'selected' : ''}>Consorcio</option>
        <option ${clientTypeFilter === 'Particular' ? 'selected' : ''}>Particular</option>
        <option ${clientTypeFilter === 'Empresa' ? 'selected' : ''}>Empresa</option>
      </select>
    </div>
    <div class="clientSummary">
      <span><b>${counts.total}</b> clientes</span>
      <span><b>${counts.consorcios}</b> consorcios</span>
      <span><b>${counts.particulares}</b> particulares</span>
      <span><b>${counts.empresas}</b> empresas</span>
      <span><b>${counts.conDocumento}</b> con CUIT/DNI</span>
    </div>
    <div class="clientGrid">
      ${rows.length ? rows.map(clientCard).join('') : '<div class="emptyBox">No hay clientes para ese filtro.</div>'}
    </div>
  `;
}

function clientCard(c) {
  const initials = String(c.Nombre || '?').split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  const isConsorcio = c.Tipo === 'Consorcio';
  return `<article class="clientCard">
    <div class="clientTop">
      <div class="clientAvatar">${esc(initials)}</div>
      <div>
        <h3>${esc(c.Nombre || 'Sin nombre')}</h3>
        <div class="clientMeta"><span class="badge blue">${esc(c.Tipo || '-')}</span><span class="badge ${c.Estado === 'Activo' ? 'ok' : 'warn'}">${esc(c.Estado || '-')}</span></div>
      </div>
    </div>
    <div class="clientInfo">
      <p>${esc(c.Direccion || 'Sin direccion')}</p>
      <small class="${c.CUIT_DNI ? '' : 'missingData'}">${esc(c.Documento_Tipo || 'CUIT/DNI')}: ${esc(c.CUIT_DNI || 'Pendiente')}</small>
    </div>
    <div class="clientActions">${actionMenu([
      `<button class="secondaryBtn" onclick="openClienteDetalleModal('${c.ID}')">Ver detalle</button>`,
      `<button class="secondaryBtn" onclick="openClienteModal('${c.ID}')">Editar</button>`,
      isConsorcio ? `<button class="secondaryBtn" onclick="selectedContactClientId='${c.ID}';document.querySelector('[data-view=contactos]').click()">Contactos</button>` : '',
      `<button class="dangerBtn" onclick="deleteRow('Clientes','${c.ID}')">Eliminar</button>`
    ])}</div>
  </article>`;
}

function openClienteDetalleModal(id) {
  const c = state.clientes.find(x => x.ID === id);
  if (!c) return;
  const admins = state.administradores.filter(a => a.Cliente_ID === id);
  const contactos = state.contactos.filter(x => x.Cliente_ID === id);
  const unidades = state.unidades.filter(u => u.Cliente_ID === id);
  openModal('Detalle del cliente', `
    <div class="formGrid">
      <div class="field full"><label>Cliente</label><input value="${esc(c.Nombre || '')}" disabled></div>
      <div class="field"><label>Tipo</label><input value="${esc(c.Tipo || '')}" disabled></div>
      <div class="field"><label>Estado</label><input value="${esc(c.Estado || '')}" disabled></div>
      <div class="field"><label>${esc(c.Documento_Tipo || 'CUIT/DNI')}</label><input value="${esc(c.CUIT_DNI || 'Pendiente')}" disabled></div>
      <div class="field"><label>Telefono</label><input value="${esc(c.Telefono || '')}" disabled></div>
      <div class="field"><label>WhatsApp</label><input value="${esc(c.Whatsapp || '')}" disabled></div>
      <div class="field"><label>Email</label><input value="${esc(c.Email || '')}" disabled></div>
      <div class="field full"><label>Direccion</label><input value="${esc(c.Direccion || '')}" disabled></div>
      <div class="field full"><label>Accesos rapidos</label><div class="quickLinks">${quickLinks(c.Telefono, c.Whatsapp, c.Email) || '<span class="muted">Sin datos de contacto.</span>'}</div></div>
      <div class="field full"><label>Resumen de contactos</label>
        <div class="paymentList">
          <p><b>${admins.length}</b> administracion${admins.length === 1 ? '' : 'es'} vinculada${admins.length === 1 ? '' : 's'}</p>
          <p><b>${contactos.length}</b> contacto${contactos.length === 1 ? '' : 's'} cargado${contactos.length === 1 ? '' : 's'}</p>
          <p><b>${unidades.length}</b> unidad${unidades.length === 1 ? '' : 'es'} cargada${unidades.length === 1 ? '' : 's'}</p>
        </div>
      </div>
    </div>
    <div class="modalActions">
      <button class="secondaryBtn" onclick="openClienteModal('${id}')">Editar</button>
      <button onclick="selectedContactClientId='${id}';closeModal();document.querySelector('[data-view=contactos]').click()">Ver contactos</button>
    </div>`);
}

function renderContactos() {
  const wasSearching = document.activeElement && document.activeElement.id === 'contactSearchInput';
  const q = contactSearch.toLowerCase().trim();
  const clientes = (state.clientes || []).filter(c => {
    const admins = state.administradores.filter(a => a.Cliente_ID === c.ID);
    const contactos = state.contactos.filter(x => x.Cliente_ID === c.ID);
    const unidades = state.unidades.filter(u => u.Cliente_ID === c.ID);
    const locationText = unidades.flatMap(u => [
      u.Unidad,
      u.Piso,
      u.Piso && `piso ${u.Piso}`,
      u.Depto,
      u.Depto && `depto ${u.Depto}`,
      [u.Piso && `piso ${u.Piso}`, u.Depto && `depto ${u.Depto}`].filter(Boolean).join(' '),
      [u.Unidad, u.Piso, u.Depto].filter(Boolean).join(' ')
    ]);
    const contactLocationText = contactos.flatMap(x => [
      x.Unidad,
      x.Piso,
      x.Piso && `piso ${x.Piso}`,
      x.Depto,
      x.Depto && `depto ${x.Depto}`,
      [x.Piso && `piso ${x.Piso}`, x.Depto && `depto ${x.Depto}`].filter(Boolean).join(' '),
      [x.Unidad, x.Piso, x.Depto].filter(Boolean).join(' ')
    ]);
    const text = [
      c.ID, c.Tipo, c.Nombre, c.Direccion, c.Telefono, c.Whatsapp, c.Email,
      ...admins.flatMap(a => [a.Administracion, a.Contacto, a.Telefono, a.Whatsapp, a.Email]),
      ...contactos.flatMap(x => [x.Rol, x.Nombre, x.Telefono, x.Whatsapp, x.Email]),
      ...contactLocationText,
      ...unidades.flatMap(u => [u.Propietario, u.Propietario_Tel, u.Propietario_Whatsapp, u.Propietario_Email, u.Inquilino, u.Inquilino_Tel, u.Inquilino_Whatsapp, u.Inquilino_Email, u.Encargado, u.Encargado_Tel, u.Encargado_Whatsapp]),
      ...locationText
    ].join(' ').toLowerCase();
    return !q || text.includes(q);
  });
  if (!selectedContactClientId && clientes.length) selectedContactClientId = clientes[0].ID;
  if (selectedContactClientId && !state.clientes.some(c => c.ID === selectedContactClientId)) selectedContactClientId = clientes[0]?.ID || '';
  const selected = state.clientes.find(c => c.ID === selectedContactClientId) || clientes[0];

  document.getElementById('contactosContent').innerHTML = `
    <div class="contactsLayout">
      <aside class="contactSide">
        <input id="contactSearchInput" value="${esc(contactSearch)}" placeholder="Buscar cliente, ubicacion, propietario, inquilino, telefono..." oninput="contactSearch=this.value;renderContactos()">
        <select class="contactRoleSelect" onchange="contactRoleFilter=this.value;renderContactos()">
          ${['Todos', 'Propietario', 'Inquilino', 'Encargado', 'Otro'].map(role => `<option ${contactRoleFilter === role ? 'selected' : ''}>${role}</option>`).join('')}
        </select>
        <div class="contactClientList">
          ${clientes.map(c => `<button class="${selected && selected.ID === c.ID ? 'active' : ''}" onclick="selectedContactClientId='${c.ID}';renderContactos()">
            <b>${esc(c.Nombre || 'Sin nombre')}</b>
            <small>${esc(c.Tipo || '')} - ${esc(c.Direccion || '')}</small>
          </button>`).join('') || '<div class="emptyBox">No hay contactos para ese filtro.</div>'}
        </div>
      </aside>
      <div class="contactDetail">
        ${selected ? renderContactDetail(selected) : '<div class="emptyBox">Selecciona un cliente para ver contactos.</div>'}
      </div>
    </div>`;
  if (wasSearching) {
    const input = document.getElementById('contactSearchInput');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function renderAdministraciones() {
  const el = document.getElementById('administracionesContent');
  if (!el) return;
  const administraciones = state.administraciones || [];
  const consorcios = (state.clientes || []).filter(c => c.Tipo === 'Consorcio');
  const linkedClientIds = new Set((state.administradores || []).map(a => a.Cliente_ID).filter(Boolean));
  const linkedCount = consorcios.filter(c => linkedClientIds.has(c.ID)).length;
  const pendingCount = Math.max(consorcios.length - linkedCount, 0);

  el.innerHTML = `
    <div class="adminSummary">
      <span><b>${administraciones.length}</b> administraciones</span>
      <span><b>${linkedCount}</b> consorcios vinculados</span>
      <span><b>${pendingCount}</b> consorcios sin administracion</span>
    </div>
    <div class="adminGrid">
      ${administraciones.map(administracionCard).join('') || '<div class="emptyBox">Todavia no hay administraciones cargadas.</div>'}
    </div>
  `;
}

function administracionCard(ad) {
  const links = (state.administradores || []).filter(a => (
    a.Administracion_ID === ad.ID || (!a.Administracion_ID && normalizeText(a.Administracion) === normalizeText(ad.Nombre))
  ));
  const linkedIds = [...new Set(links.map(a => a.Cliente_ID).filter(Boolean))];
  const linkedConsorcios = linkedIds.map(id => (state.clientes || []).find(c => c.ID === id)).filter(Boolean);
  return `
    <article class="adminCard">
      <div class="adminCardHead">
        <div>
          <span class="badge ${ad.Estado === 'Inactivo' ? '' : 'ok'}">${esc(ad.Estado || 'Activo')}</span>
          <h3>${esc(ad.Nombre || 'Sin nombre')}</h3>
          <p>${esc(ad.Cargo || 'Administracion')}</p>
        </div>
        <div class="adminCount">
          <b>${linkedConsorcios.length}</b>
          <span>consorcios</span>
        </div>
      </div>
      <div class="adminContactGrid">
        ${adminDataItem('Contacto', ad.Contacto || 'Pendiente')}
        ${adminDataItem('Telefono', ad.Telefono ? `<a href="tel:${esc(phoneHref(ad.Telefono))}">${esc(ad.Telefono)}</a>` : 'Pendiente')}
        ${adminDataItem('WhatsApp', ad.Whatsapp ? `<a target="_blank" href="https://wa.me/${whatsappDigits(ad.Whatsapp)}">${esc(ad.Whatsapp)}</a>` : 'Pendiente')}
        ${adminDataItem('Email', ad.Email ? `<a href="mailto:${esc(ad.Email)}">${esc(ad.Email)}</a>` : 'Pendiente')}
        ${ad.Direccion ? adminDataItem('Direccion', ad.Direccion) : ''}
      </div>
      <div class="adminLinkedList">
        ${linkedConsorcios.length ? linkedConsorcios.map(c => `<button onclick="openAdminModal('${c.ID}')">${esc(c.Nombre || c.ID)}</button>`).join('') : '<span class="muted">Sin consorcios vinculados.</span>'}
      </div>
      <div class="clientActions">${actionMenu([
        `<button class="secondaryBtn" onclick="openAdministracionModal('${ad.ID}')">Editar</button>`,
        `<button class="dangerBtn" onclick="deleteRow('Administraciones','${ad.ID}')">Eliminar</button>`
      ])}</div>
    </article>
  `;
}

function adminDataItem(label, value) {
  return `<div class="adminDataItem"><span>${esc(label)}</span><b>${String(value || '')}</b></div>`;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function renderContactDetail(cliente) {
  const admins = state.administradores.filter(a => a.Cliente_ID === cliente.ID);
  const contactos = state.contactos.filter(x => x.Cliente_ID === cliente.ID);
  const unidades = state.unidades.filter(u => u.Cliente_ID === cliente.ID);
  const agendaRows = contactAgendaRows(cliente, admins, contactos, unidades);
  return `
    <div class="contactHero">
      <div>
        <h3>${esc(cliente.Nombre || 'Sin nombre')}</h3>
        <p>${esc(cliente.Tipo || '')} - ${esc(cliente.Direccion || 'Sin direccion')}</p>
        <div class="quickLinks">${quickLinks(cliente.Telefono, cliente.Whatsapp, cliente.Email)}</div>
      </div>
      <div class="agendaActions">${actionMenu([
        `<button class="secondaryBtn" onclick="openClienteModal('${cliente.ID}')">Editar cliente</button>`,
        cliente.Tipo === 'Consorcio' ? `<button class="secondaryBtn" onclick="openAdministracionModal()">Alta administracion</button>` : '',
        cliente.Tipo === 'Consorcio' ? `<button class="secondaryBtn" onclick="openAdminModal('${cliente.ID}')">Asignar administracion</button>` : '',
        `<button onclick="openContactoModal('${cliente.ID}')">Nuevo contacto</button>`
      ])}</div>
    </div>
    <div class="contactSection">
      <h3>Agenda de contactos</h3>
      <div class="contactTableWrap compact">
        <table class="contactTable compactContactTable responsiveTable">
          <thead><tr><th>Rol</th><th>Nombre</th><th>Ubicacion</th><th>Contacto</th><th></th></tr></thead>
          <tbody>${agendaRows.length ? agendaRows.map(contactAgendaRow).join('') : '<tr><td colspan="5" class="muted">Sin contactos cargados.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="contactSection">
      <h3>Administracion</h3>
      <div class="contactCards">
        ${admins.length ? admins.map(a => contactPersonCard('Administrador', a.Administracion || a.Contacto, a.Cargo || a.Contacto, a.Telefono, a.Whatsapp, a.Email, actionMenu([`<button class="secondaryBtn" onclick="openAdminModal('${cliente.ID}')">Editar</button>`]))).join('') : '<div class="emptyBox">Sin administrador cargado.</div>'}
      </div>
    </div>
    `;
}

function contactAgendaRows(cliente, admins, contactos, unidades) {
  const q = contactSearch.toLowerCase().trim();
  const matches = row => {
    if (!q) return true;
    return [row.rol, row.nombre, row.ubicacion, row.telefono, row.whatsapp, row.email].join(' ').toLowerCase().includes(q);
  };
  const rows = [];
  admins.forEach(a => rows.push({
    rol: 'Administracion',
    nombre: a.Administracion || a.Contacto || '-',
    ubicacion: cliente.Direccion || '',
    telefono: a.Telefono,
    whatsapp: a.Whatsapp,
    email: a.Email,
    action: actionMenu([
      `<button class="secondaryBtn" onclick="openAdminModal('${cliente.ID}')">Editar</button>`,
      `<button class="dangerBtn" onclick="deleteRow('Administradores','${a.ID}')">Eliminar</button>`
    ])
  }));
  contactos.forEach(c => {
    if (contactRoleFilter !== 'Todos' && c.Rol !== contactRoleFilter) return;
    rows.push({
      rol: c.Rol || 'Contacto',
      nombre: c.Nombre || '-',
      ubicacion: contactLocation(c),
      telefono: c.Telefono,
      whatsapp: c.Whatsapp,
      email: c.Email,
      action: actionMenu([
        `<button class="secondaryBtn" onclick="openContactoModal('${c.Cliente_ID}','${c.ID}')">Editar</button>`,
        `<button class="dangerBtn" onclick="deleteRow('Contactos','${c.ID}')">Eliminar</button>`
      ])
    });
  });
  if (contactRoleFilter === 'Todos' || contactRoleFilter === 'Propietario') unidades.filter(u => u.Propietario).forEach(u => rows.push(legacyContactRow('Propietario', u, u.Propietario, u.Propietario_Tel, u.Propietario_Whatsapp, u.Propietario_Email)));
  if (contactRoleFilter === 'Todos' || contactRoleFilter === 'Inquilino') unidades.filter(u => u.Inquilino).forEach(u => rows.push(legacyContactRow('Inquilino', u, u.Inquilino, u.Inquilino_Tel, u.Inquilino_Whatsapp, u.Inquilino_Email)));
  if (contactRoleFilter === 'Todos' || contactRoleFilter === 'Encargado') unidades.filter(u => u.Encargado).forEach(u => rows.push(legacyContactRow('Encargado', u, u.Encargado, u.Encargado_Tel, u.Encargado_Whatsapp, '')));
  return rows.filter(matches);
}

function legacyContactRow(rol, u, nombre, telefono, whatsapp, email) {
  return {
    rol,
    nombre,
    ubicacion: contactLocation(u),
    telefono,
    whatsapp,
    email,
    action: actionMenu([
      `<button class="secondaryBtn" onclick="openUnidadModal('${u.Cliente_ID}','${u.ID}')">Editar</button>`,
      `<button class="dangerBtn" onclick="deleteRow('Unidades','${u.ID}')">Eliminar</button>`
    ])
  };
}

function contactLocation(item) {
  return [item.Unidad, item.Piso && `Piso ${item.Piso}`, item.Depto && `Depto ${item.Depto}`].filter(Boolean).join(' - ') || '-';
}

function contactAgendaRow(row) {
  return `<tr>
    <td data-label="Rol"><span class="badge blue">${esc(row.rol)}</span></td>
    <td data-label="Nombre"><b>${esc(row.nombre || '-')}</b></td>
    <td data-label="Ubicacion">${esc(row.ubicacion || '-')}</td>
    <td data-label="Contacto"><div class="quickLinks">${quickLinks(row.telefono, row.whatsapp, row.email) || '<span class="muted">Sin datos</span>'}</div></td>
    <td class="actionsCell" data-label="Acciones">${row.action || ''}</td>
  </tr>`;
}

function contactosPorRol(contactos) {
  return contactos.filter(c => contactRoleFilter === 'Todos' || c.Rol === contactRoleFilter);
}

function contactRecordCard(c) {
  const ubicacion = [c.Unidad, c.Piso && `Piso ${c.Piso}`, c.Depto && `Depto ${c.Depto}`].filter(Boolean).join(' - ') || 'Sin ubicacion';
  return `<article class="unitContactCard">
    <div class="unitHead">
      <div><span>Ubicacion</span><b>${esc(ubicacion)}</b></div>
      ${actionMenu([`<button class="secondaryBtn" onclick="openContactoModal('${c.Cliente_ID}','${c.ID}')">Editar</button>`])}
    </div>
    <div class="contactRoles singleRole">
      ${contactPersonCard(c.Rol || 'Contacto', c.Nombre, '', c.Telefono, c.Whatsapp, c.Email)}
    </div>
    ${c.Observaciones ? `<p class="muted">${esc(c.Observaciones)}</p>` : ''}
  </article>`;
}

function unitContactCard(u) {
  const unitTitle = [u.Unidad, u.Piso && `Piso ${u.Piso}`, u.Depto && `Depto ${u.Depto}`].filter(Boolean).join(' - ') || 'Sin ubicacion';
  const roles = [
    contactRoleFilter === 'Todos' || contactRoleFilter === 'Propietario' ? contactPersonCard('Propietario', u.Propietario, '', u.Propietario_Tel, u.Propietario_Whatsapp, u.Propietario_Email) : '',
    contactRoleFilter === 'Todos' || contactRoleFilter === 'Inquilino' ? contactPersonCard('Inquilino', u.Inquilino, '', u.Inquilino_Tel, u.Inquilino_Whatsapp, u.Inquilino_Email) : '',
    contactRoleFilter === 'Todos' || contactRoleFilter === 'Encargado' ? contactPersonCard('Encargado', u.Encargado, '', u.Encargado_Tel, u.Encargado_Whatsapp, '') : ''
  ].filter(Boolean);
  if (contactRoleFilter === 'Administracion') return '';
  return `<article class="unitContactCard">
    <div class="unitHead">
      <div><span>Ubicacion</span><b>${esc(unitTitle)}</b></div>
      ${actionMenu([`<button class="secondaryBtn" onclick="openUnidadModal('${u.Cliente_ID}','${u.ID}')">Editar</button>`])}
    </div>
    <div class="contactRoles">
      ${roles.join('') || '<div class="emptyBox">Sin contactos para este filtro.</div>'}
    </div>
    ${u.Observaciones ? `<p class="muted">${esc(u.Observaciones)}</p>` : ''}
  </article>`;
}

function contactPersonCard(role, name, subtitle, phone, whatsapp, email, actions = '') {
  return `<div class="contactPerson">
    <span>${esc(role)}</span>
    <b>${esc(name || '-')}</b>
    ${subtitle ? `<small>${esc(subtitle)}</small>` : ''}
    <div class="quickLinks">${quickLinks(phone, whatsapp, email)}${actions || ''}</div>
  </div>`;
}

function renderPresupuestos() {
  const cols = ['ID', 'Cliente_Nombre', 'Documento', 'Detalle_Servicio', 'Total', 'Adelanto', 'Saldo', 'Estado', 'Agenda', 'Facturacion'];
  const rows = (state.presupuestos || []).map(p => {
    const billing = presupuestoBilling(p);
    return { ...p, Documento: clientDocumentText(p.Cliente_ID), Saldo: billing.saldoCobro, Agenda: presupuestoAgendaLabel(p), Facturacion: presupuestoBillingLabel(p) };
  });
  renderTable('presupuestosTable', rows, cols, r => actionMenu([
    presupuestoEstadoControl(r),
    presupuestoLifecycleActions(r),
    presupuestoAgendaAction(r),
    `<button class="secondaryBtn" onclick="window.open('/api/presupuestos/${r.ID}/pdf', '_blank')">Ver PDF</button>`,
    `<button class="secondaryBtn" onclick="openPresupuestoModal('${r.ID}')">Editar</button>`,
    correoButtonForPresupuesto(r),
    whatsappButtonForPresupuesto(r),
    invoiceActionForPresupuesto(r),
    `<button class="dangerBtn" onclick="deleteRow('Presupuestos','${r.ID}')">Eliminar</button>`
  ]));
}

function presupuestoEstadoControl(row) {
  const estados = ['Borrador', 'Enviado', 'Aceptado', 'En curso', 'Finalizado', 'Facturado', 'Rechazado', 'Vencido'];
  const actual = estados.includes(row.Estado) ? row.Estado : (row.Estado || 'Borrador');
  return `<select class="inlineSelect" onchange="changePresupuestoEstado('${row.ID}', this.value)">
    ${!estados.includes(actual) ? `<option value="${esc(actual)}" selected>${esc(actual)}</option>` : ''}
    ${estados.map(e => `<option value="${e}" ${actual === e ? 'selected' : ''}>${e}</option>`).join('')}
  </select>`;
}

function presupuestoLifecycleActions(row) {
  if (row.Estado === 'Aceptado') return `<button class="secondaryBtn" onclick="changePresupuestoEstado('${row.ID}', 'En curso')">Iniciar</button>`;
  if (row.Estado === 'En curso') return `<button class="secondaryBtn" onclick="changePresupuestoEstado('${row.ID}', 'Finalizado')">Finalizar</button>`;
  if (row.Estado === 'Finalizado' && presupuestoBilling(row).pendienteFacturar > 0) return `<button class="secondaryBtn" onclick="openFacturaModal('', {presupuestoId:'${row.ID}'})">Facturar</button>`;
  return '';
}

function presupuestoAgendaAction(row) {
  if (['Rechazado', 'Vencido', 'Facturado'].includes(row.Estado)) return '';
  return `<button class="secondaryBtn" onclick="openAgendaPresupuestoModal('${row.ID}')">Agenda</button>`;
}

function presupuestoAgendaLabel(p) {
  const trabajo = (state.trabajos || []).find(t => t.Presupuesto_ID === p.ID && t.Estado !== 'Cancelado');
  if (!trabajo || !trabajo.Fecha_Programada) return 'Sin programar';
  return `${trabajo.Estado || 'Programado'} - ${trabajo.Fecha_Programada}${trabajo.Hora_Inicio ? ' ' + trabajo.Hora_Inicio : ''}${trabajo.Tecnico ? ' - ' + trabajo.Tecnico : ''}`;
}

function presupuestoCorreoEnviado(id) {
  return (state.correos || []).some(c => c.Presupuesto_ID === id && c.Tipo === 'Presupuesto' && c.Estado !== 'Error');
}

function facturaCorreoEnviado(id) {
  return (state.correos || []).some(c => c.Factura_ID === id && c.Estado !== 'Error');
}

function correoButtonForPresupuesto(p) {
  const sent = presupuestoCorreoEnviado(p.ID);
  return `<button class="${sent ? 'sentBtn' : 'secondaryBtn'}" onclick="openCorreoModal({tipo:'Presupuesto', presupuestoId:'${p.ID}'})">${sent ? 'Correo enviado' : 'Correo'}</button>`;
}

function correoButtonForFactura(f) {
  const sent = facturaCorreoEnviado(f.ID);
  return `<button class="${sent ? 'sentBtn' : 'secondaryBtn'}" onclick="openCorreoModal({tipo:'Factura', facturaId:'${f.ID}'})">${sent ? 'Correo enviado' : 'Correo'}</button>`;
}

function whatsappButtonForPresupuesto(p) {
  return `<button class="secondaryBtn" onclick="openWhatsAppPresupuesto('${p.ID}')">WhatsApp</button>`;
}

function whatsappButtonForFactura(f) {
  return `<button class="secondaryBtn" onclick="openWhatsAppFactura('${f.ID}')">WhatsApp</button>`;
}

function invoiceActionForPresupuesto(p) {
  const billing = presupuestoBilling(p);
  if (billing.pendienteFacturar > 0) return `<button class="secondaryBtn" onclick="openFacturaModal('', {presupuestoId:'${p.ID}'})">Factura</button>`;
  const pending = billing.facturas.find(f => f.Estado !== 'Cobrada');
  if (pending) return `<button class="secondaryBtn" onclick="openFacturaDetalleModal('${pending.ID}')">Cobrar</button>`;
  return '';
}

function presupuestoBillingLabel(p) {
  const billing = presupuestoBilling(p);
  if (!billing.facturas.length) return 'Sin factura';
  if (billing.pendienteFacturar > 0) return `Facturado parcial - falta ${money(billing.pendienteFacturar)}`;
  if (billing.facturas.some(f => f.Estado === 'Pendiente de cobro')) return 'Facturado - pendiente de cobro';
  if (billing.facturas.every(f => f.Estado === 'Cobrada')) return 'Facturado - cobrado';
  return 'Facturado';
}

function renderCobros() {
  const cols = ['ID', 'Fecha', 'Cliente_ID', 'Servicio_ID', 'Trabajo_ID', 'Presupuesto_ID', 'Tipo_Cobro', 'Concepto', 'Medio_Pago', 'Importe', 'Facturado', 'Factura_Nro', 'Factura_URL'];
  renderTable('cobrosTable', state.cobros, cols, r => actionMenu([`<button class="dangerBtn" onclick="deleteRow('Cobros','${r.ID}')">Eliminar</button>`]));
}

function renderFacturas() {
  const el = document.getElementById('facturasContent');
  if (!el) return;
  const rows = state.facturas || [];
  const pendientes = rows.filter(f => f.Estado !== 'Cobrada' && f.Estado !== 'Anulada');
  const cobradas = rows.filter(f => f.Estado === 'Cobrada');
  const targets = pendingInvoiceTargets();
  el.innerHTML = `
    <div class="adminSummary">
      <span><b>${rows.length}</b> facturas</span>
      <span><b>${pendientes.length}</b> pendientes</span>
      <span><b>${cobradas.length}</b> cobradas</span>
      <span><b>${money(cobradas.reduce((a, f) => a + Number(f.Importe || 0), 0))}</b> cobrado</span>
    </div>
    <div class="billingPanel invoiceHub">
      <div>
        <h3>Pendiente de facturar</h3>
        <p>${targets.length} presupuesto${targets.length === 1 ? '' : 's'} listo${targets.length === 1 ? '' : 's'} para asociar factura.</p>
      </div>
      <div class="billingList">${targets.map(t => `
        <button class="secondaryBtn" onclick="${t.action}">
          ${esc(t.label)} - ${money(t.pendiente)}
        </button>
      `).join('') || '<span class="muted">No hay pendientes de facturar.</span>'}</div>
    </div>
    <div class="tableWrap">
      <table class="invoiceTable responsiveTable">
        <thead><tr><th>Factura</th><th>Cliente</th><th>Asociado</th><th>Importe</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>${rows.length ? rows.map(facturaRow).join('') : '<tr><td colspan="6" class="muted">Sin facturas cargadas.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function pendingInvoiceTargets() {
  const servicios = (state.servicios || [])
    .filter(s => s.Estado !== 'Cancelado' && !s.Presupuesto_ID)
    .map(s => ({ item: s, billing: serviceBilling(s) }))
    .filter(x => x.billing.pendienteFacturar > 0)
    .map(x => ({
      tipo: x.item.Tipo || 'Servicio',
      label: `${x.item.ID} - ${x.item.Cliente_Nombre || x.item.Titulo || ''} - ${clientDocumentText(x.item.Cliente_ID)}`,
      pendiente: x.billing.pendienteFacturar,
      action: `openFacturaModal('', {servicioId:'${x.item.ID}'})`
    }));
  const presupuestos = (state.presupuestos || [])
    .filter(p => ['Aceptado', 'En curso', 'Finalizado', 'Facturado'].includes(p.Estado))
    .map(p => {
      const trabajo = (state.trabajos || []).find(t => t.Presupuesto_ID === p.ID && t.Estado !== 'Cancelado');
      return { item: p, trabajo, billing: presupuestoBilling(p) };
    })
    .filter(x => x.billing.pendienteFacturar > 0)
    .map(x => ({
      tipo: 'Obra',
      label: `${x.item.ID} - ${x.item.Cliente_Nombre || ''} - ${clientDocumentText(x.item.Cliente_ID)}`,
      pendiente: x.billing.pendienteFacturar,
      action: `openFacturaModal('', {presupuestoId:'${x.item.ID}'})`
    }));
  return servicios.concat(presupuestos).sort((a, b) => b.pendiente - a.pendiente);
}

function facturaRow(f) {
  const linked = facturaLinkedText(f);
  const clienteId = f.Cliente_ID || linkedSourceByFactura(f)?.Cliente_ID || '';
  return `<tr>
    <td data-label="Factura"><b>${esc(f.Factura_Nro || f.ID)}</b><small>${esc(f.Fecha || '')}</small></td>
    <td data-label="Cliente">${esc(f.Cliente_Nombre || '-')}<small>${esc(clientDocumentText(clienteId))}</small></td>
    <td data-label="Asociado">${linked}</td>
    <td data-label="Importe">${money(f.Importe || 0)}</td>
    <td data-label="Estado"><span class="badge ${f.Estado === 'Cobrada' ? 'ok' : 'warn'}">${esc(f.Estado || 'Pendiente de cobro')}</span></td>
    <td class="actionsCell" data-label="Acciones">${actionMenu([
      `<button class="secondaryBtn" onclick="openFacturaDetalleModal('${f.ID}')">Ver detalle</button>`,
      correoButtonForFactura(f),
      whatsappButtonForFactura(f),
      f.Estado !== 'Cobrada' ? `<button class="secondaryBtn" onclick="marcarFacturaCobrada('${f.ID}')">Marcar cobrada</button>` : ''
    ])}</td>
  </tr>`;
}

function facturaLinkedText(f) {
  if (f.Presupuesto_ID) return `Presupuesto ${esc(f.Presupuesto_ID)}`;
  return [f.Servicio_ID && `Visita/Emergencia ${f.Servicio_ID}`, f.Cobro_ID && `Cobro ${f.Cobro_ID}`].filter(Boolean).join('<br>') || '-';
}

function linkedSourceByFactura(f) {
  return (state.presupuestos || []).find(p => p.ID === f.Presupuesto_ID)
    || (state.servicios || []).find(s => s.ID === f.Servicio_ID)
    || (state.trabajos || []).find(t => t.ID === f.Trabajo_ID)
    || null;
}

function openFacturaDetalleModal(id) {
  const f = (state.facturas || []).find(x => x.ID === id);
  if (!f) return;
  const source = linkedSourceByFactura(f);
  const clienteId = f.Cliente_ID || source?.Cliente_ID || '';
  openModal('Detalle de factura', `
    <div class="formGrid">
      <div class="field"><label>Factura</label><input value="${esc(f.Factura_Nro || f.ID)}" disabled></div>
      <div class="field"><label>Fecha</label><input value="${esc(f.Fecha || '')}" disabled></div>
      <div class="field full"><label>Cliente</label><input value="${esc(f.Cliente_Nombre || '')}" disabled></div>
      <div class="field"><label>CUIT / DNI</label><input value="${esc(clientDocumentText(clienteId))}" disabled></div>
      <div class="field full"><label>Asociado a</label><div class="formDivider">${facturaLinkedText(f)}</div></div>
      <div class="field"><label>Concepto</label><input value="${esc(f.Concepto || '')}" disabled></div>
      <div class="field"><label>Importe</label><input value="${money(f.Importe || 0)}" disabled></div>
      <div class="field"><label>Estado</label><input value="${esc(f.Estado || 'Pendiente de cobro')}" disabled></div>
      <div class="field"><label>Fecha de cobro</label><input value="${esc(f.Fecha_Cobro || '')}" disabled></div>
      <div class="field"><label>Medio de pago</label><input value="${esc(f.Medio_Pago || '')}" disabled></div>
      <div class="field"><label>Archivo</label><input value="${esc(f.Archivo_Nombre || '')}" disabled></div>
      <div class="field full"><label>Observaciones</label><textarea disabled>${esc(f.Observaciones || '')}</textarea></div>
      <div class="field full"><label>PDF / Drive</label>${f.Drive_URL ? `<a class="link" href="${esc(f.Drive_URL)}" target="_blank">Ver PDF</a>` : '<span class="muted">Sin archivo asociado.</span>'}</div>
    </div>
    <div class="modalActions">
      <button class="secondaryBtn" onclick="openFacturaModal('${id}')">Editar</button>
      ${f.Estado !== 'Cobrada' ? `<button onclick="marcarFacturaCobrada('${id}')">Marcar cobrada</button>` : ''}
      <button class="dangerBtn" onclick="deleteRow('Facturas','${id}')">Eliminar</button>
    </div>`);
}

function renderCorreos() {
  const el = document.getElementById('correosContent');
  if (!el) return;
  const rows = state.correos || [];
  el.innerHTML = `
    <div class="adminSummary">
      <span><b>${rows.length}</b> correos enviados</span>
      <span><b>${rows.filter(c => c.Tipo === 'Presupuesto').length}</b> presupuestos</span>
      <span><b>${rows.filter(c => String(c.Tipo || '').startsWith('Factura')).length}</b> facturas</span>
    </div>
    <div class="tableWrap">
      <table class="responsiveTable">
        <thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Tipo</th><th>Asociado</th></tr></thead>
        <tbody>${rows.length ? rows.slice().reverse().map(c => `
          <tr>
            <td data-label="Fecha">${esc(c.Fecha || '')}</td>
            <td data-label="Para">${esc(c.Para || '')}</td>
            <td data-label="Asunto">${esc(c.Asunto || '')}</td>
            <td data-label="Tipo">${esc(c.Tipo || '')}</td>
            <td data-label="Asociado">${[c.Presupuesto_ID && `Presupuesto ${esc(c.Presupuesto_ID)}`, c.Factura_ID && `Factura ${esc(c.Factura_ID)}`].filter(Boolean).join('<br>') || '-'}</td>
          </tr>`).join('') : '<tr><td colspan="5" class="muted">Todavia no hay correos enviados.</td></tr>'}</tbody>
      </table>
    </div>`;
}

function openCorreoModal(preset = {}) {
  const tipo = preset.tipo || 'Presupuesto';
  const presupuestoId = preset.presupuestoId || '';
  const facturaId = preset.facturaId || '';
  const draft = correoDraft(tipo, presupuestoId, facturaId);
  openModal('Enviar correo', `
    <div class="formGrid">
      ${field('Tipo', 'select', ['Presupuesto', 'Factura', 'Factura adelanto', 'Factura cuota', 'Factura saldo final', 'Factura final de presupuesto'], '', tipo)}
      ${selectField('Presupuesto_ID', [['', 'Sin presupuesto']].concat((state.presupuestos || []).map(p => [p.ID, `${p.ID} - ${p.Cliente_Nombre}`])), presupuestoId, 'onchange="updateCorreoDraft()"')}
      ${selectField('Factura_ID', [['', 'Sin factura']].concat((state.facturas || []).map(f => [f.ID, `${f.Factura_Nro || f.ID} - ${f.Cliente_Nombre} - ${money(f.Importe || 0)}`])), facturaId, 'onchange="updateCorreoDraft()"')}
      ${field('Para', 'email', null, '', draft.to)}
      ${field('Asunto', 'text', null, 'full', draft.subject)}
      <div class="field full"><label>Detalle</label><textarea id="Detalle" data-name="Detalle">${esc(draft.body)}</textarea></div>
      <label class="checkLine full"><input id="Incluir_Presupuesto" data-name="Incluir_Presupuesto" type="checkbox" ${draft.includeBudget ? 'checked' : ''}> Adjuntar tambien el presupuesto vinculado</label>
    </div><div class="modalActions"><button onclick="enviarCorreo()">Enviar correo</button></div>`);
  document.getElementById('Tipo')?.addEventListener('change', updateCorreoDraft);
}

function correoDraft(tipo, presupuestoId, facturaId) {
  const factura = (state.facturas || []).find(f => f.ID === facturaId);
  const presupuesto = (state.presupuestos || []).find(p => p.ID === (presupuestoId || factura?.Presupuesto_ID));
  const item = tipo === 'Presupuesto' ? presupuesto : factura;
  const cliente = (state.clientes || []).find(c => c.ID === (item?.Cliente_ID || presupuesto?.Cliente_ID));
  const recipient = correoRecipient(cliente, presupuesto);
  const to = recipient.email;
  const name = cliente?.Nombre || item?.Cliente_Nombre || presupuesto?.Cliente_Nombre || '';
  if (tipo === 'Presupuesto') {
    return {
      to,
      subject: `Presupuesto ${presupuesto?.ID || ''} - ${name}`.trim(),
      body: `Estimado/a:\n\nAdjuntamos el presupuesto ${presupuesto?.ID || ''} correspondiente al trabajo solicitado.\n\nDetalle: ${presupuesto?.Detalle_Servicio || ''}\nTotal: ${money(presupuesto?.Total || 0)}\n\nQuedamos atentos a su confirmacion.\n\nSaludos.\nPablo Gonzalez Construcciones`,
      includeBudget: true,
      includeBalance: false
    };
  }
  const label = tipo === 'Factura adelanto' ? 'factura de adelanto para inicio de trabajo'
    : tipo === 'Factura cuota' ? 'factura correspondiente a cuota/pago parcial'
    : tipo === 'Factura saldo final' ? 'factura de saldo final'
    : tipo === 'Factura final de presupuesto' ? 'factura final por presupuesto realizado'
    : 'factura';
  const detalleFactura = facturaDetalleCorreo(factura, presupuesto);
  return {
    to,
    subject: `${tipo} ${factura?.Factura_Nro || factura?.ID || ''} - ${name}`.trim(),
    body: `Estimado/a:\n\nAdjuntamos ${label} ${factura?.Factura_Nro || factura?.ID || ''} correspondiente al trabajo realizado.\n\nDetalle de trabajo/factura: ${detalleFactura}\nTotal de la factura: ${money(factura?.Importe || 0)}\n\nSaludos.\nPablo Gonzalez Construcciones`,
    includeBudget: ['Factura adelanto', 'Factura cuota'].includes(tipo) && !!presupuesto,
    includeBalance: false
  };
}

function facturaDetalleCorreo(factura, presupuesto) {
  if (!factura) return presupuesto?.Detalle_Servicio || '';
  const servicio = (state.servicios || []).find(s => s.ID === factura.Servicio_ID);
  const trabajo = (state.trabajos || []).find(t => t.ID === factura.Trabajo_ID);
  const linkedPresupuesto = presupuesto || (state.presupuestos || []).find(p => p.ID === factura.Presupuesto_ID);
  if (servicio) return [servicio.Tipo, servicio.Titulo, servicio.Detalle].filter(Boolean).join(' - ');
  if (linkedPresupuesto?.Detalle_Servicio) return linkedPresupuesto.Detalle_Servicio;
  if (trabajo) return [trabajo.Titulo, trabajo.Observaciones].filter(Boolean).join(' - ');
  return isGenericInvoiceConcept(factura.Concepto) ? '' : factura.Concepto || '';
}

function isGenericInvoiceConcept(value) {
  return ['pago parcial', 'factura', ''].includes(String(value || '').trim().toLowerCase());
}

function openWhatsAppPresupuesto(id) {
  const presupuesto = (state.presupuestos || []).find(p => p.ID === id);
  if (!presupuesto) return showToast('No se encontro el presupuesto.');
  const cliente = (state.clientes || []).find(c => c.ID === presupuesto.Cliente_ID);
  openWhatsAppModal('presupuesto', presupuesto, cliente);
}

function openWhatsAppFactura(id) {
  const factura = (state.facturas || []).find(f => f.ID === id);
  if (!factura) return showToast('No se encontro la factura.');
  const presupuesto = (state.presupuestos || []).find(p => p.ID === factura.Presupuesto_ID);
  const cliente = (state.clientes || []).find(c => c.ID === (factura.Cliente_ID || presupuesto?.Cliente_ID));
  openWhatsAppModal('factura', { ...factura, presupuesto }, cliente);
}

function openWhatsAppModal(tipo, item, cliente) {
  const presupuesto = tipo === 'presupuesto' ? item : item.presupuesto;
  const recipients = whatsappRecipients(cliente, presupuesto);
  if (!recipients.length) return showToast('No hay WhatsApp cargado para este cliente, administracion o contacto.');
  const title = tipo === 'presupuesto' ? 'Enviar presupuesto por WhatsApp' : 'Enviar factura por WhatsApp';
  const draft = whatsappDraft(tipo, item, '');
  openModal(title, `
    <div class="formGrid">
      <label>Destinatario
        <select id="Whatsapp_To">${recipients.map((r, i) => `<option value="${i}">${esc(r.label)} - ${esc(r.phone)}</option>`).join('')}</select>
      </label>
      <label>Mensaje
        <textarea id="Whatsapp_Message" rows="9">${esc(draft)}</textarea>
      </label>
    </div>
    <p class="hint">Al enviar se prepara el link publico de Drive y se abre WhatsApp con el mensaje listo.</p>
    <div class="modalActions">
      <button class="primaryBtn" onclick="sendPreparedWhatsApp('${tipo}', '${item.ID}')">Abrir WhatsApp</button>
      <button class="secondaryBtn" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

async function sendPreparedWhatsApp(tipo, id) {
  const item = tipo === 'presupuesto'
    ? (state.presupuestos || []).find(p => p.ID === id)
    : (state.facturas || []).find(f => f.ID === id);
  if (!item) return showToast('No se encontro el registro.');
  const presupuesto = tipo === 'presupuesto' ? item : (state.presupuestos || []).find(p => p.ID === item.Presupuesto_ID);
  const cliente = (state.clientes || []).find(c => c.ID === (item.Cliente_ID || presupuesto?.Cliente_ID));
  const recipients = whatsappRecipients(cliente, presupuesto);
  const selectedIndex = Number(document.getElementById('Whatsapp_To')?.value || 0);
  const recipient = recipients[selectedIndex] || recipients[0];
  const customMessage = document.getElementById('Whatsapp_Message')?.value || whatsappDraft(tipo, tipo === 'presupuesto' ? item : { ...item, presupuesto }, '');
  if (!recipient?.phone) return showToast('Selecciona un destinatario con WhatsApp.');
  const whatsappWindow = window.open('about:blank', '_blank');
  if (whatsappWindow) {
    whatsappWindow.document.write('<p style="font-family:Arial,sans-serif;padding:24px">Preparando WhatsApp...</p>');
  }
  let publicUrl = '';
  try {
    const result = await api(
      tipo === 'presupuesto' ? `/api/presupuestos/${id}/public-link` : `/api/facturas/${id}/public-link`,
      { method: 'POST', body: JSON.stringify({}), loadingMessage: 'Preparando link publico de Drive...' }
    );
    publicUrl = result?.url || '';
    if (tipo === 'presupuesto' && publicUrl) item.PDF_URL = publicUrl;
    if (tipo === 'factura' && publicUrl) item.Drive_URL = publicUrl;
  } catch (error) {
    if (tipo === 'presupuesto') return showError(error);
    showToast('La factura no tiene link publico; se envia el mensaje sin adjunto.');
  }
  const message = [customMessage.trim(), publicUrl ? `PDF: ${publicUrl}` : ''].filter(Boolean).join('\n\n');
  openWhatsApp(recipient.phone, message, whatsappWindow);
  closeModal();
}

function whatsappRecipients(cliente, presupuesto) {
  const clienteId = presupuesto?.Cliente_ID || cliente?.ID || '';
  const consorcioId = presupuesto?.Consorcio_ID || '';
  const list = [];
  addWhatsappRecipient(list, 'Contacto del presupuesto', presupuesto?.Contacto_Nombre, presupuesto?.Contacto_Whatsapp);
  (state.administradores || [])
    .filter(a => a.Cliente_ID === clienteId || (consorcioId && a.Consorcio_ID === consorcioId))
    .forEach(a => addWhatsappRecipient(list, 'Administracion', a.Contacto || a.Administracion, a.Whatsapp || a.Telefono));
  (state.contactos || [])
    .filter(c => c.Cliente_ID === clienteId || (consorcioId && c.Consorcio_ID === consorcioId))
    .forEach(c => addWhatsappRecipient(list, c.Rol || 'Contacto', contactNameWithUnit(c.Nombre, c), c.Whatsapp || c.Telefono));
  (state.unidades || [])
    .filter(u => u.Cliente_ID === clienteId || (consorcioId && u.Consorcio_ID === consorcioId))
    .forEach(u => {
      addWhatsappRecipient(list, 'Propietario', contactNameWithUnit(u.Propietario, u), u.Propietario_Whatsapp || u.Propietario_Tel);
      addWhatsappRecipient(list, 'Inquilino', contactNameWithUnit(u.Inquilino, u), u.Inquilino_Whatsapp || u.Inquilino_Tel);
      addWhatsappRecipient(list, 'Encargado', contactNameWithUnit(u.Encargado, u), u.Encargado_Whatsapp || u.Encargado_Tel);
    });
  addWhatsappRecipient(list, 'Cliente', cliente?.Nombre, cliente?.Whatsapp || cliente?.Telefono);
  return list;
}

function addWhatsappRecipient(list, role, name, phone) {
  const digits = whatsappDigits(phone);
  if (!digits || list.some(item => whatsappDigits(item.phone) === digits)) return;
  list.push({
    role: role || 'Contacto',
    name: name || '',
    phone,
    label: [role || 'Contacto', name || 'Sin nombre'].filter(Boolean).join(' - ')
  });
}

function contactNameWithUnit(name, row) {
  const location = [row?.Piso ? `Piso ${row.Piso}` : '', row?.Depto ? `Depto ${row.Depto}` : '', row?.Unidad ? `Unidad ${row.Unidad}` : ''].filter(Boolean).join(' ');
  return [name, location].filter(Boolean).join(' - ');
}

function whatsappDraft(tipo, item, pdfUrl = '') {
  if (tipo === 'presupuesto') {
    return [
      'Hola, te enviamos el presupuesto correspondiente al trabajo solicitado.',
      '',
      `Presupuesto: ${item.ID}`,
      `Detalle: ${shortText(item.Detalle_Servicio || '', 420)}`,
      `Total: ${money(item.Total || 0)}`,
      pdfUrl ? `PDF: ${pdfUrl}` : '',
      '',
      'Saludos.',
      'Pablo Gonzalez Construcciones'
    ].filter(line => line !== '').join('\n');
  }
  const presupuesto = item.presupuesto || (state.presupuestos || []).find(p => p.ID === item.Presupuesto_ID);
  const detalle = facturaDetalleCorreo(item, presupuesto);
  return [
    'Hola, te enviamos la factura correspondiente al trabajo realizado.',
    '',
    `Factura: ${item.Factura_Nro || item.ID}`,
    `Detalle: ${shortText(detalle || item.Concepto || '', 420)}`,
    `Total de la factura: ${money(item.Importe || 0)}`,
    pdfUrl ? `PDF: ${pdfUrl}` : '',
    '',
    'Saludos.',
    'Pablo Gonzalez Construcciones'
  ].filter(line => line !== '').join('\n');
}

function openWhatsApp(phone, message, targetWindow = null) {
  const digits = whatsappDigits(phone);
  if (!digits) {
    if (targetWindow) targetWindow.close();
    return showToast('El numero de WhatsApp no es valido.');
  }
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  if (targetWindow) targetWindow.location.href = url;
  else window.open(url, '_blank');
  showToast('WhatsApp abierto con el mensaje preparado.');
}

function absoluteUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${window.location.origin}${path.startsWith('/') ? path : '/' + path}`;
}

function correoRecipient(cliente, presupuesto) {
  const admin = (state.administradores || []).find(a => a.Cliente_ID === presupuesto?.Cliente_ID && a.Email);
  if (admin) return { email: admin.Email, name: admin.Contacto || admin.Administracion || 'Administracion' };
  if (presupuesto?.Contacto_Email) return { email: presupuesto.Contacto_Email, name: presupuesto.Contacto_Nombre || cliente?.Nombre || '' };
  return { email: cliente?.Email || '', name: cliente?.Nombre || '' };
}

function updateCorreoDraft() {
  const tipo = document.getElementById('Tipo')?.value || 'Presupuesto';
  const presupuestoId = document.getElementById('Presupuesto_ID')?.value || '';
  const facturaId = document.getElementById('Factura_ID')?.value || '';
  const draft = correoDraft(tipo, presupuestoId, facturaId);
  setVal('Para', draft.to);
  setVal('Asunto', draft.subject);
  setVal('Detalle', draft.body);
  const incluir = document.getElementById('Incluir_Presupuesto');
  if (incluir) incluir.checked = draft.includeBudget;
}

async function enviarCorreo() {
  const data = {};
  document.querySelectorAll('#modalBody [data-name]').forEach(el => data[el.dataset.name] = el.type === 'checkbox' ? el.checked : el.value);
  try {
    await api('/api/correos/enviar', { method: 'POST', body: JSON.stringify(data) });
    showToast('Correo enviado correctamente.');
    closeModal();
    await loadData();
    document.querySelector('.nav[data-view="correos"]').click();
  } catch (error) {
    showError(error);
  }
}

function renderGastos() {
  const cols = ['ID', 'Fecha', 'Categoria', 'Proveedor', 'Concepto', 'Medio_Pago', 'Importe'];
  renderTable('gastosTable', state.gastos, cols, r => actionMenu([`<button class="dangerBtn" onclick="deleteRow('Gastos','${r.ID}')">Eliminar</button>`]));
}

function actionMenu(items, labelText = 'Acciones') {
  const actions = (items || []).filter(Boolean).join('');
  if (!actions.trim()) return '';
  return `<details class="rowMenu">
    <summary>${esc(labelText)}</summary>
    <div class="rowMenuPanel">${actions}</div>
  </details>`;
}

function renderTable(id, rows, cols, actionFn) {
  const table = document.getElementById(id);
  if (!table) return;
  if (!rows || !rows.length) {
    table.innerHTML = '<tr><td>No hay datos cargados todavia.</td></tr>';
    return;
  }
  table.classList.add('responsiveTable');
  table.innerHTML = `<thead><tr>${cols.map(c => `<th>${label(c)}</th>`).join('')}<th>Acciones</th></tr></thead><tbody>` +
    rows.map(r => `<tr>${cols.map(c => `<td data-label="${esc(label(c))}">${formatCell(c, r[c])}</td>`).join('')}<td class="actionsCell" data-label="Acciones"><div class="tableActions">${actionFn ? actionFn(r) : ''}</div></td></tr>`).join('') + '</tbody>';
}

function renderKanban() {
  const kanban = document.getElementById('kanban');
  if (!kanban) return;
  const estados = ['Pendiente', 'Programado', 'En curso', 'Finalizado', 'Facturado', 'Cerrado', 'Cancelado'];
  kanban.innerHTML = estados.map(e => `
    <div class="kanbanCol"><h3>${e}</h3>
      ${(state.trabajos || []).filter(t => t.Estado === e).map(t => {
        const billing = workBilling(t);
        return `
        <div class="taskCard">
          <b>${esc(t.Titulo || 'Trabajo')}</b>
          <small>${esc(t.Cliente_Nombre || '')}<br>${esc(clientDocumentText(t.Cliente_ID))}<br>${esc(t.Direccion || '')} ${t.Unidad_Trabajo ? '- Unidad ' + esc(t.Unidad_Trabajo) : ''}</small>
          ${trabajoMoneySummary(t)}
          <div class="taskActions">${billing.cerrado ? '<span class="badge ok">Trabajo cerrado</span>' : ''}
            ${actionMenu([
              `<button class="secondaryBtn" onclick="openTrabajoDetalleModal('${t.ID}')">Ver detalle</button>`,
              `<button class="secondaryBtn" onclick="openTrabajoModal('${t.ID}')">Editar</button>`,
              !billing.cerrado ? `<button class="secondaryBtn" onclick="openAgendaTrabajoModal('${t.ID}')">Agenda</button>` : '',
              !billing.cerrado ? `<button class="secondaryBtn" onclick="openFacturaModal('', {trabajoId:'${t.ID}'})">Factura</button>` : '',
              !billing.cerrado && billing.pendienteFacturar === 0 && billing.saldoCobro === 0 ? `<button class="secondaryBtn" onclick="cerrarTrabajo('${t.ID}')">Cerrar</button>` : '',
              `<button class="dangerBtn" onclick="deleteRow('Trabajos','${t.ID}')">Eliminar</button>`
            ])}
          </div>
        </div>`;
      }).join('') || '<small>Sin trabajos.</small>'}
    </div>`).join('');
}

function workBilling(t) {
  const total = Number(t.Importe || 0);
  const presupuesto = t.Presupuesto_ID ? (state.presupuestos || []).find(p => p.ID === t.Presupuesto_ID) : null;
  const adelanto = Number(presupuesto?.Adelanto || 0);
  const cobrado = Math.max(Number(t.Cobrado || 0), adelanto);
  const facturas = (state.facturas || []).filter(f => (f.Trabajo_ID === t.ID || (t.Presupuesto_ID && f.Presupuesto_ID === t.Presupuesto_ID)) && f.Estado !== 'Anulada');
  const facturado = facturas.reduce((acc, f) => acc + Number(f.Importe || 0), 0);
  const facturasPendientes = facturas.filter(f => f.Estado !== 'Cobrada');
  const pendienteFacturasCobro = facturasPendientes.reduce((acc, f) => acc + Number(f.Importe || 0), 0);
  return {
    total,
    cobrado,
    facturas,
    facturado,
    pendienteFacturar: Math.max(total - adelanto - facturado, 0),
    saldoCobro: Math.max(total - cobrado, 0),
    facturasPendientes,
    pendienteFacturasCobro,
    cerrado: t.Estado === 'Cerrado'
  };
}

function serviceBilling(s) {
  const total = Number(s.Importe || 0);
  const cobrado = Number(s.Cobrado || 0);
  const facturas = (state.facturas || []).filter(f => (
    f.Servicio_ID === s.ID ||
    (s.Presupuesto_ID && f.Presupuesto_ID === s.Presupuesto_ID)
  ) && f.Estado !== 'Anulada');
  const facturado = facturas.reduce((acc, f) => acc + Number(f.Importe || 0), 0);
  const facturasPendientes = facturas.filter(f => f.Estado !== 'Cobrada');
  const pendienteFacturasCobro = facturasPendientes.reduce((acc, f) => acc + Number(f.Importe || 0), 0);
  return {
    total,
    cobrado,
    facturas,
    facturado,
    pendienteFacturar: Math.max(total - facturado, 0),
    saldoCobro: Math.max(total - cobrado, 0),
    facturasPendientes,
    pendienteFacturasCobro
  };
}

function presupuestoBilling(p) {
  const total = Number(p.Total || 0);
  const adelanto = Number(p.Adelanto || 0);
  const facturas = (state.facturas || []).filter(f => f.Presupuesto_ID === p.ID && f.Estado !== 'Anulada');
  const facturado = facturas.reduce((acc, f) => acc + Number(f.Importe || 0), 0);
  const facturasPendientes = facturas.filter(f => f.Estado !== 'Cobrada');
  const pendienteFacturasCobro = facturasPendientes.reduce((acc, f) => acc + Number(f.Importe || 0), 0);
  const cobrado = (state.cobros || [])
    .filter(c => c.Presupuesto_ID === p.ID)
    .reduce((acc, c) => acc + Number(c.Importe || 0), adelanto);
  const saldoBase = Math.max(total - adelanto, 0);
  return {
    total,
    adelanto,
    cobrado,
    facturas,
    facturado,
    pendienteFacturar: Math.max(saldoBase - facturado, 0),
    saldoCobro: Math.max(total - cobrado, 0),
    facturasPendientes,
    pendienteFacturasCobro
  };
}

function trabajoMoneySummary(t) {
  const billing = workBilling(t);
  return `<div class="workMoney">
    <span>Total <b>${money(billing.total)}</b></span>
    <span>Saldo <b>${money(billing.saldoCobro)}</b></span>
    <small>${billing.pendienteFacturar > 0 ? `Falta facturar ${money(billing.pendienteFacturar)}` : 'Facturacion al dia'} - ${esc(t.Facturacion_Estado || 'No facturado')}</small>
  </div>`;
}

function openTrabajoDetalleModal(id) {
  const t = state.trabajos.find(x => x.ID === id);
  if (!t) return;
  const billing = workBilling(t);
  const facturas = billing.facturas;
  const cobros = (state.cobros || []).filter(c => c.Trabajo_ID === id);
  openModal('Detalle del trabajo', `
    <div class="formGrid">
      <div class="field full"><label>Trabajo</label><input value="${esc(t.Titulo || t.ID)}" disabled></div>
      <div class="field"><label>Cliente</label><input value="${esc(t.Cliente_Nombre || '')}" disabled></div>
      <div class="field"><label>CUIT / DNI</label><input value="${esc(clientDocumentText(t.Cliente_ID))}" disabled></div>
      <div class="field"><label>Estado</label><input value="${esc(t.Estado || '')}" disabled></div>
      <div class="field full"><label>Direccion</label><input value="${esc([t.Direccion, t.Unidad_Trabajo && 'Unidad ' + t.Unidad_Trabajo].filter(Boolean).join(' - '))}" disabled></div>
      <div class="field"><label>Total</label><input value="${money(billing.total)}" disabled></div>
      <div class="field"><label>Facturado</label><input value="${money(billing.facturado)}" disabled></div>
      <div class="field"><label>Pendiente de facturar</label><input value="${money(billing.pendienteFacturar)}" disabled></div>
      <div class="field"><label>Cobrado</label><input value="${money(billing.cobrado)}" disabled></div>
      <div class="field"><label>Pendiente de cobrar</label><input value="${money(billing.saldoCobro)}" disabled></div>
      <div class="field"><label>Facturas por cobrar</label><input value="${money(billing.pendienteFacturasCobro)}" disabled></div>
      <div class="field full"><label>Facturas asociadas</label>
        <div class="paymentList">${facturas.map(f => `<p><b>${esc(f.Factura_Nro || f.ID)}</b> - ${money(f.Importe)} - ${esc(f.Estado || '')} ${f.Drive_URL ? `- <a class="link" href="${esc(f.Drive_URL)}" target="_blank">Ver PDF</a>` : ''}</p>`).join('') || '<span class="muted">Sin facturas cargadas.</span>'}</div>
      </div>
      <div class="field full"><label>Cobros asociados</label>
        <div class="paymentList">${cobros.map(c => `<p><b>${esc(c.Fecha || '')}</b> - ${money(c.Importe)} - ${esc(c.Medio_Pago || '')}</p>`).join('') || '<span class="muted">Sin cobros cargados.</span>'}</div>
      </div>
    </div>
    <div class="modalActions">
      <button class="secondaryBtn" onclick="openFotoModal('${id}')">Adjuntos</button>
      <button class="secondaryBtn" onclick="openFacturaModal('', {trabajoId:'${id}'})">Nueva factura</button>
      <button onclick="openTrabajoModal('${id}')">Editar</button>
    </div>`);
}

function renderCalendar() {
  const base = parseDate(agendaDate) || new Date();
  const range = periodRange(base, agendaView, 0);
  const scheduled = (state.trabajos || []).filter(t => t.Estado !== 'Cancelado' && t.Fecha_Programada);
  const inRange = scheduled.filter(t => {
    const d = parseDate(t.Fecha_Programada);
    return d && d >= range.start && d <= range.end;
  });
  const totalImporte = inRange.reduce((a, t) => a + Number(t.Importe || 0), 0);

  document.getElementById('calendarWeek').innerHTML = `
    <div class="agendaToolbar">
      <div>
        <h3>${agendaTitle(range)}</h3>
        <p>${inRange.length} presupuesto${inRange.length === 1 ? '' : 's'} programado${inRange.length === 1 ? '' : 's'} - ${money(totalImporte)}</p>
      </div>
      <div class="agendaControls">
        <button class="secondaryBtn" onclick="shiftAgenda(-1)">Anterior</button>
        <button class="secondaryBtn" onclick="agendaDate=new Date().toISOString().slice(0,10);renderCalendar()">Hoy</button>
        <button class="secondaryBtn" onclick="shiftAgenda(1)">Siguiente</button>
        <select onchange="agendaView=this.value;renderCalendar()">
          <option value="week" ${agendaView === 'week' ? 'selected' : ''}>Semana</option>
          <option value="month" ${agendaView === 'month' ? 'selected' : ''}>Mes</option>
          <option value="year" ${agendaView === 'year' ? 'selected' : ''}>Año</option>
        </select>
      </div>
    </div>
    ${agendaView === 'year' ? renderYearAgenda(range, scheduled) : renderDayAgenda(range, scheduled)}
  `;
}

function renderDayAgenda(range, scheduled) {
  const days = [];
  const d = new Date(range.start);
  while (d <= range.end) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return `<div class="calendar ${agendaView === 'month' ? 'monthView' : ''}">${days.map(day => {
    const list = scheduled.filter(t => sameDay(t.Fecha_Programada, day));
    return `<div class="dayCol ${sameDay(day.toISOString().slice(0, 10), new Date()) ? 'today' : ''}">
      <h3>${day.toLocaleDateString('es-AR', { weekday: 'long' })}<br><small>${day.toLocaleDateString('es-AR')}</small></h3>
      ${list.map(agendaEventCard).join('') || '<small>Libre.</small>'}
    </div>`;
  }).join('')}</div>`;
}

function renderYearAgenda(range, scheduled) {
  const year = range.start.getFullYear();
  return `<div class="yearAgenda">${Array.from({ length: 12 }, (_, month) => {
    const list = scheduled.filter(t => {
      const d = parseDate(t.Fecha_Programada);
      return d && d.getFullYear() === year && d.getMonth() === month;
    }).sort((a, b) => String(a.Fecha_Programada).localeCompare(String(b.Fecha_Programada)));
    return `<div class="monthCol">
      <h3>${new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long' })}<br><small>${list.length} presupuesto${list.length === 1 ? '' : 's'}</small></h3>
      ${list.map(agendaEventCard).join('') || '<small>Sin presupuestos.</small>'}
    </div>`;
  }).join('')}</div>`;
}

function agendaEventCard(t) {
  const presupuesto = t.Presupuesto_ID ? (state.presupuestos || []).find(p => p.ID === t.Presupuesto_ID) : null;
  const title = presupuesto ? `Presupuesto ${presupuesto.ID}` : (t.Titulo || 'Presupuesto');
  const presupuestoText = presupuesto ? `<br><small>${esc(shortText(presupuesto.Detalle_Servicio || '', 70))}</small>` : '';
  return `<div class="event">
    <b>${esc(t.Hora_Inicio || '')} ${esc(title)}</b>
    <br>${esc(t.Cliente_Nombre || '')}
    <br><small>${esc(clientDocumentText(t.Cliente_ID))}</small>
    <br><small>${esc(t.Fecha_Programada || '')} - ${esc(t.Direccion || '')} ${t.Unidad_Trabajo ? '- ' + esc(t.Unidad_Trabajo) : ''}</small>
    ${presupuestoText}
    <button class="secondaryBtn" onclick="openAgendaTrabajoModal('${t.ID}')">Reprogramar</button>
    <button class="dangerBtn" onclick="deleteRow('Trabajos','${t.ID}')">Quitar de agenda</button>
  </div>`;
}

function shiftAgenda(offset) {
  const base = parseDate(agendaDate) || new Date();
  if (agendaView === 'week') base.setDate(base.getDate() + offset * 7);
  else if (agendaView === 'year') base.setFullYear(base.getFullYear() + offset);
  else base.setMonth(base.getMonth() + offset);
  agendaDate = base.toISOString().slice(0, 10);
  renderCalendar();
}

function agendaTitle(range) {
  if (agendaView === 'week') return `Semana del ${range.start.toLocaleDateString('es-AR')} al ${range.end.toLocaleDateString('es-AR')}`;
  if (agendaView === 'year') return String(range.start.getFullYear());
  return range.start.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

function openClienteModal(id = '') {
  const c = id ? state.clientes.find(x => x.ID === id) : {};
  openModal(id ? 'Editar cliente' : 'Nuevo cliente', `
    <div class="formGrid">
      ${field('ID', 'hidden', null, '', c.ID || '')}
      ${field('Tipo', 'select', ['Particular', 'Consorcio', 'Empresa'], '', c.Tipo || 'Particular')}
      ${field('Nombre', 'text', null, '', c.Nombre || '')}
      ${field('Documento_Tipo', 'select', ['CUIT', 'DNI', 'CUIL', 'Otro'], '', c.Documento_Tipo || 'CUIT')}
      <div class="field importantField"><label>Numero de documento <span>opcional</span></label><input type="text" id="CUIT_DNI" data-name="CUIT_DNI" value="${esc(c.CUIT_DNI || '')}" placeholder="Ej: 20-12345678-9 o DNI"></div>
      ${field('Direccion', 'text', null, '', c.Direccion || '')}
      ${field('Localidad', 'text', null, '', c.Localidad || '')}
      ${field('Provincia', 'text', null, '', c.Provincia || '')}
      ${field('CP', 'text', null, '', c.CP || '')}
      ${field('Telefono', 'text', null, '', c.Telefono || '')}
      ${field('Whatsapp', 'text', null, '', c.Whatsapp || '')}
      ${field('Email', 'email', null, '', c.Email || '')}
      ${field('Estado', 'select', ['Activo', 'Inactivo'], '', c.Estado || 'Activo')}
      ${field('Observaciones', 'textarea', null, 'full', c.Observaciones || '')}
    </div><div class="modalActions"><button onclick="saveForm('cliente')">Guardar</button></div>`);
}

function openAdminModal(clienteId) {
  const a = state.administradores.find(x => x.Cliente_ID === clienteId) || { Cliente_ID: clienteId };
  openModal('Asignar administracion al consorcio', `
    <div class="formGrid">
      ${field('ID', 'hidden', null, '', a.ID || '')}${field('Cliente_ID', 'hidden', null, '', clienteId)}
      <div class="formDivider full">Elegir administracion existente</div>
      ${selectField('Administracion_ID', [['', 'Cargar manualmente']].concat((state.administraciones || []).map(ad => [ad.ID, `${ad.Nombre} - ${ad.Contacto || ''}`])), a.Administracion_ID || '', 'onchange="fillAdministracionFields(this.value)"')}
      <div class="formDivider full">Datos vinculados al consorcio</div>
      ${field('Administracion', 'text', null, '', a.Administracion || '')}${field('Contacto', 'text', null, '', a.Contacto || '')}
      ${field('Cargo', 'text', null, '', a.Cargo || '')}${field('Telefono', 'text', null, '', a.Telefono || '')}
      ${field('Whatsapp', 'text', null, '', a.Whatsapp || '')}${field('Email', 'email', null, '', a.Email || '')}
      ${field('Direccion', 'text', null, '', a.Direccion || '')}${field('Estado', 'select', ['Activo', 'Inactivo'], '', a.Estado || 'Activo')}
      ${field('Observaciones', 'textarea', null, 'full', a.Observaciones || '')}
    </div><div class="modalActions"><button onclick="saveForm('admin')">Guardar vinculacion</button></div>`);
}

function fillAdministracionFields(id) {
  const a = (state.administraciones || []).find(x => x.ID === id);
  if (!a) return;
  setVal('Administracion', a.Nombre || '');
  setVal('Contacto', a.Contacto || '');
  setVal('Cargo', a.Cargo || '');
  setVal('Telefono', a.Telefono || '');
  setVal('Whatsapp', a.Whatsapp || a.Telefono || '');
  setVal('Email', a.Email || '');
  setVal('Direccion', a.Direccion || '');
}

function openAdministracionModal(id = '') {
  const a = id ? (state.administraciones || []).find(x => x.ID === id) : {};
  openModal(id ? 'Editar administracion' : 'Alta de administracion', `
    <div class="formGrid">
      ${field('ID', 'hidden', null, '', a.ID || '')}
      ${field('Nombre', 'text', null, '', a.Nombre || '')}${field('Contacto', 'text', null, '', a.Contacto || '')}
      ${field('Cargo', 'text', null, '', a.Cargo || '')}${field('Telefono', 'text', null, '', a.Telefono || '')}
      ${field('Whatsapp', 'text', null, '', a.Whatsapp || '')}${field('Email', 'email', null, '', a.Email || '')}
      ${field('Direccion', 'text', null, '', a.Direccion || '')}${field('Estado', 'select', ['Activo', 'Inactivo'], '', a.Estado || 'Activo')}
      ${field('Observaciones', 'textarea', null, 'full', a.Observaciones || '')}
    </div><div class="modalActions"><button onclick="saveForm('administracion')">Guardar administracion</button></div>`);
}

function openContactoModal(clienteId, contactoId = '') {
  const c = contactoId ? (state.contactos || []).find(x => x.ID === contactoId) : {};
  const cliente = state.clientes.find(x => x.ID === clienteId);
  openModal(contactoId ? 'Editar contacto' : 'Nuevo contacto', `
    <div class="formGrid">
      ${field('ID', 'hidden', null, '', c.ID || '')}${field('Cliente_ID', 'hidden', null, '', clienteId)}
      <div class="field full"><label>Cliente / consorcio</label><input value="${esc(cliente ? cliente.Nombre : '')}" disabled></div>
      ${field('Rol', 'select', ['Propietario', 'Inquilino', 'Encargado', 'Otro'], '', c.Rol || 'Propietario')}
      ${field('Nombre', 'text', null, '', c.Nombre || '')}
      ${field('Telefono', 'text', null, '', c.Telefono || '')}${field('Whatsapp', 'text', null, '', c.Whatsapp || '')}
      ${field('Email', 'email', null, '', c.Email || '')}
      <div class="formDivider full">Ubicacion dentro del consorcio</div>
      ${field('Unidad', 'text', null, '', c.Unidad || '')}${field('Piso', 'text', null, '', c.Piso || '')}
      ${field('Depto', 'text', null, '', c.Depto || '')}${field('Estado', 'select', ['Activo', 'Inactivo'], '', c.Estado || 'Activo')}
      ${field('Observaciones', 'textarea', null, 'full', c.Observaciones || '')}
    </div><div class="modalActions"><button onclick="saveForm('contacto')">Guardar contacto</button></div>`);
}

function openAgendaConsorcio(clienteId) {
  const c = state.clientes.find(x => x.ID === clienteId);
  const admins = state.administradores.filter(a => a.Cliente_ID === clienteId);
  const unidades = state.unidades.filter(u => u.Cliente_ID === clienteId);
  openModal(`Agenda del consorcio: ${c ? c.Nombre : ''}`, `
    <div class="agendaHeader">
      <div>
        <p class="muted">Contactos internos del consorcio para eventualidades, avisos y coordinación de trabajos.</p>
      </div>
      <div class="agendaActions">${actionMenu([
        `<button onclick="openAdminModal('${clienteId}')">Administracion</button>`,
        `<button onclick="openUnidadModal('${clienteId}')">Nuevo contacto</button>`
      ])}</div>
    </div>
    <div class="agendaSearch">
      <input id="contactSearch" placeholder="Buscar unidad, propietario, inquilino, encargado, telefono..." oninput="filterAgendaContacts('${clienteId}')">
    </div>
    <div class="adminStrip">
      ${admins.length ? admins.map(a => `
        <div class="adminItem">
          <span>Administracion</span>
          <b>${esc(a.Administracion || 'Sin nombre')}</b>
          <small>${esc(a.Contacto || '')}</small>
          <div class="quickLinks">${quickLinks(a.Telefono, a.Whatsapp, a.Email)}${actionMenu([`<button class="secondaryBtn" onclick="openAdminModal('${clienteId}')">Editar</button>`])}</div>
        </div>
      `).join('') : '<div class="emptyBox">Sin administrador cargado.</div>'}
    </div>
    <div class="contactTableWrap">
      <table class="contactTable responsiveTable">
        <thead><tr><th>Unidad</th><th>Propietario</th><th>Inquilino</th><th>Encargado</th><th></th></tr></thead>
        <tbody id="agendaContacts">${renderAgendaUnitRows(unidades)}</tbody>
      </table>
    </div>
  `);
}

function renderAgendaUnitRows(unidades) {
  if (!unidades.length) return '<tr><td colspan="5" class="muted">Sin unidades cargadas.</td></tr>';
  return unidades.map(u => `
    <tr class="unitContact" data-search="${esc(`${u.Unidad} ${u.Piso} ${u.Depto} ${u.Propietario} ${u.Propietario_Tel} ${u.Propietario_Whatsapp} ${u.Propietario_Email} ${u.Inquilino} ${u.Inquilino_Tel} ${u.Inquilino_Whatsapp} ${u.Inquilino_Email} ${u.Encargado} ${u.Encargado_Tel} ${u.Encargado_Whatsapp}`.toLowerCase())}">
      <td data-label="Unidad"><b>${esc(u.Unidad || '-')}</b><small>${esc([u.Piso && `Piso ${u.Piso}`, u.Depto && `Depto ${u.Depto}`].filter(Boolean).join(' - '))}</small></td>
      <td data-label="Propietario">${personLine(u.Propietario, u.Propietario_Tel, u.Propietario_Whatsapp, u.Propietario_Email)}</td>
      <td data-label="Inquilino">${personLine(u.Inquilino, u.Inquilino_Tel, u.Inquilino_Whatsapp, u.Inquilino_Email)}</td>
      <td data-label="Encargado">${personLine(u.Encargado, u.Encargado_Tel, u.Encargado_Whatsapp, '')}</td>
      <td class="actionsCell" data-label="Acciones">${actionMenu([
        `<button class="secondaryBtn" onclick="openUnidadModal('${u.Cliente_ID}','${u.ID}')">Editar</button>`,
        `<button class="dangerBtn" onclick="deleteRow('Unidades','${u.ID}')">Eliminar</button>`
      ])}</td>
    </tr>
  `).join('');
}

function personLine(name, phone, whatsapp, email) {
  return `<div class="personLine">
    <b>${esc(name || '-')}</b>
    <div class="quickLinks">${quickLinks(phone, whatsapp, email)}</div>
  </div>`;
}

function quickLinks(phone, whatsapp, email) {
  return `${phone ? `<a class="miniLink" href="tel:${esc(phone)}">Tel</a>` : ''}${whatsapp ? wa(whatsapp) : ''}${email ? mail(email) : ''}`;
}

function filterAgendaContacts(clienteId) {
  const q = document.getElementById('contactSearch').value.toLowerCase().trim();
  document.querySelectorAll('#agendaContacts .unitContact').forEach(card => {
    card.style.display = !q || card.dataset.search.includes(q) ? 'table-row' : 'none';
  });
}

function openUnidadModal(clienteId, unidadId = '') {
  const u = unidadId ? state.unidades.find(x => x.ID === unidadId) : {};
  openModal(unidadId ? 'Editar contacto / ubicacion' : 'Nuevo contacto', `
    <div class="formGrid">
      ${field('ID', 'hidden', null, '', u.ID || '')}
      ${field('Cliente_ID', 'hidden', null, '', clienteId)}
      ${field('Unidad', 'text', null, '', u.Unidad || '')}${field('Piso', 'text', null, '', u.Piso || '')}
      ${field('Depto', 'text', null, '', u.Depto || '')}${field('Propietario', 'text', null, '', u.Propietario || '')}
      ${field('Propietario_Tel', 'text', null, '', u.Propietario_Tel || '')}${field('Propietario_Whatsapp', 'text', null, '', u.Propietario_Whatsapp || '')}
      ${field('Propietario_Email', 'email', null, '', u.Propietario_Email || '')}${field('Inquilino', 'text', null, '', u.Inquilino || '')}
      ${field('Inquilino_Tel', 'text', null, '', u.Inquilino_Tel || '')}${field('Inquilino_Whatsapp', 'text', null, '', u.Inquilino_Whatsapp || '')}
      ${field('Inquilino_Email', 'email', null, '', u.Inquilino_Email || '')}${field('Encargado', 'text', null, '', u.Encargado || '')}
      ${field('Encargado_Tel', 'text', null, '', u.Encargado_Tel || '')}${field('Encargado_Whatsapp', 'text', null, '', u.Encargado_Whatsapp || '')}
      ${field('Estado', 'select', ['Activo', 'Inactivo'], '', u.Estado || 'Activo')}
      ${field('Observaciones', 'textarea', null, 'full', u.Observaciones || '')}
    </div><div class="modalActions"><button onclick="saveForm('unidad')">Guardar unidad</button></div>`);
}

function openServicioModal(id = '') {
  const s = id ? state.servicios.find(x => x.ID === id) : {};
  selectedCliente = s?.Cliente_ID ? state.clientes.find(c => c.ID === s.Cliente_ID) : null;
  openModal(id ? 'Editar visita/emergencia' : 'Nueva visita/emergencia', `
    <div class="formGrid">
      ${field('ID', 'hidden', null, '', s.ID || '')}
      <div class="field full autocomplete">
        <label>Cliente o consorcio</label>
        <input id="servClienteSearch" placeholder="Buscar cliente..." value="${selectedCliente ? esc(selectedCliente.Nombre) : ''}" oninput="autocompleteCliente(this.value, false)">
        <div id="clienteSuggestions" class="suggestions hidden"></div>
        <input type="hidden" id="Cliente_ID" data-name="Cliente_ID" value="${s.Cliente_ID || ''}">
      </div>
      <div class="field"><label>CUIT / DNI</label><input id="Cliente_Documento" value="${esc(clientDocumentText(s.Cliente_ID))}" disabled></div>
      ${field('Fecha', 'date', null, '', toInputDate(s.Fecha) || new Date().toISOString().slice(0, 10))}
      ${field('Tipo', 'select', ['Visita', 'Emergencia'], '', s.Tipo || 'Visita')}
      ${field('Direccion', 'text', null, '', s.Direccion || '')}
      ${field('Unidad_Trabajo', 'text', null, '', s.Unidad_Trabajo || '')}
      ${field('Titulo', 'text', null, '', s.Titulo || '')}
      ${field('Prioridad', 'select', ['Baja', 'Media', 'Alta', 'Urgente'], '', s.Prioridad || 'Media')}
      ${field('Estado', 'select', ['Pendiente', 'Programado', 'En curso', 'Realizado', 'Cobrado', 'Cancelado'], '', s.Estado || 'Pendiente')}
      ${field('Tecnico', 'text', null, '', s.Tecnico || '')}
      ${field('Importe', 'number', null, '', s.Importe || '0')}
      ${field('Cobrado', 'number', null, '', s.Cobrado || '0')}
      ${field('Detalle', 'textarea', null, 'full', s.Detalle || '')}
      ${field('Observaciones', 'textarea', null, 'full', s.Observaciones || '')}
    </div><div class="modalActions"><button onclick="saveForm('servicio')">Guardar servicio</button></div>`);
}

function openPresupuestoDesdeServicio(id) {
  const s = state.servicios.find(x => x.ID === id);
  if (!s) return;
  openPresupuestoModal('', {
    Servicio_ID: s.ID,
    Cliente_ID: s.Cliente_ID,
    Cliente_Tipo: s.Cliente_Tipo,
    Direccion: s.Direccion,
    Unidad_Trabajo: s.Unidad_Trabajo,
    Detalle_Servicio: `${s.Tipo}: ${s.Titulo || 'Servicio'}\n\n${s.Detalle || ''}`.trim(),
    Total: s.Importe || '0',
    Observaciones: s.Observaciones || ''
  });
}

function openPresupuestoModal(id = '', preset = {}) {
  const p = id ? state.presupuestos.find(x => x.ID === id) : {};
  const data = { ...preset, ...p };
  const cfg = state.config || {};
  selectedCliente = data?.Cliente_ID ? state.clientes.find(c => c.ID === data.Cliente_ID) : null;
  openModal(id ? 'Editar presupuesto' : 'Nuevo presupuesto', `
    <div class="formGrid">
      ${field('ID', 'hidden', null, '', data.ID || '')}
      ${field('Servicio_ID', 'hidden', null, '', preset.Servicio_ID || '')}
      <div class="field full autocomplete">
        <label>Cliente o consorcio</label>
        <input id="clienteSearch" placeholder="Ej: Consorcio La Pampa 2345" value="${selectedCliente ? esc(selectedCliente.Nombre) : ''}" oninput="autocompleteCliente(this.value)">
        <div id="clienteSuggestions" class="suggestions hidden"></div>
        <input type="hidden" id="Cliente_ID" data-name="Cliente_ID" value="${data.Cliente_ID || ''}">
      </div>
      <div class="field"><label>CUIT / DNI</label><input id="Cliente_Documento" value="${esc(clientDocumentText(data.Cliente_ID))}" disabled></div>
      ${field('Cliente_Tipo', 'text', null, '', data.Cliente_Tipo || '')}${field('Direccion', 'text', null, '', data.Direccion || '')}
      <div id="unidadBox" class="field ${selectedCliente && selectedCliente.Tipo === 'Consorcio' ? '' : 'hidden'}">
        <label>Unidad de trabajo opcional</label>
        <input id="Unidad_Trabajo" data-name="Unidad_Trabajo" list="unidadesList" placeholder="Ej: 2 B o PB local" value="${esc(data.Unidad_Trabajo || '')}">
        <datalist id="unidadesList">${state.unidades.filter(u => u.Cliente_ID === data.Cliente_ID).map(u => `<option value="${esc(u.Unidad)}">${esc(u.Propietario || u.Inquilino || '')}</option>`).join('')}</datalist>
      </div>
      ${field('Forma_Pago', 'select', ['Efectivo', 'Debito', 'Credito', 'Transferencia bancaria'], '', data.Forma_Pago || 'Transferencia bancaria')}
      ${field('Condicion_Pago', 'select', ['A convenir', 'Contado', '15 dias', '30 dias', '60 dias', '90 dias'], '', data.Condicion_Pago || 'A convenir')}
      <div class="formDivider full">Datos que salen en el presupuesto</div>
      ${field('Empresa_Nombre', 'text', null, '', cfg.Empresa_Nombre || 'Pablo Gonzalez Construcciones')}
      ${field('Presupuesto_Validez_Dias', 'number', null, '', cfg.Presupuesto_Validez_Dias || '15')}
      ${field('Empresa_Logo', 'text', null, 'full', cfg.Empresa_Logo || '/assets/pablo-gonzalez-logo.png')}
      ${field('Empresa_Descripcion', 'textarea', null, 'full', cfg.Empresa_Descripcion || '')}
      ${field('Empresa_Telefono', 'text', null, '', cfg.Empresa_Telefono || '')}
      ${field('Empresa_Whatsapp', 'text', null, '', cfg.Empresa_Whatsapp || '')}
      ${field('Empresa_Email', 'email', null, '', cfg.Empresa_Email || '')}
      ${field('Empresa_Direccion', 'text', null, '', cfg.Empresa_Direccion || '')}
      <div class="formDivider full">Detalle de trabajo</div>
      ${field('Detalle_Servicio', 'textarea', null, 'full', data.Detalle_Servicio || '')}
      ${field('Total', 'number', null, '', data.Total || '0')}${field('Adelanto', 'number', null, '', data.Adelanto || '0')}
      ${field('Estado', 'select', ['Borrador', 'Enviado', 'Aceptado', 'En curso', 'Finalizado', 'Facturado', 'Rechazado', 'Vencido'], '', data.Estado || 'Borrador')}
      ${field('Observaciones', 'textarea', null, 'full', data.Observaciones || '')}
    </div><div class="modalActions"><button onclick="saveForm('presupuesto')">Generar y guardar</button></div>`);
}

function openTrabajoModal(id = '') {
  const t = id ? state.trabajos.find(x => x.ID === id) : {};
  selectedCliente = t?.Cliente_ID ? state.clientes.find(c => c.ID === t.Cliente_ID) : null;
  openModal(id ? 'Editar trabajo' : 'Nuevo trabajo', `
    <div class="formGrid">
      ${field('ID', 'hidden', null, '', t.ID || '')}
      <div class="field full autocomplete">
        <label>Cliente o consorcio</label>
        <input id="trabClienteSearch" placeholder="Buscar cliente..." value="${selectedCliente ? esc(selectedCliente.Nombre) : ''}" oninput="autocompleteCliente(this.value, true)">
        <div id="clienteSuggestions" class="suggestions hidden"></div>
        <input type="hidden" id="Cliente_ID" data-name="Cliente_ID" value="${t.Cliente_ID || ''}">
      </div>
      <div class="field"><label>CUIT / DNI</label><input id="Cliente_Documento" value="${esc(clientDocumentText(t.Cliente_ID))}" disabled></div>
      ${field('Direccion', 'text', null, '', t.Direccion || '')}${field('Unidad_Trabajo', 'text', null, '', t.Unidad_Trabajo || '')}
      ${field('Titulo', 'text', null, '', t.Titulo || 'Trabajo de mantenimiento')}${field('Prioridad', 'select', ['Baja', 'Media', 'Alta', 'Urgente'], '', t.Prioridad || 'Media')}
      ${field('Estado', 'select', ['Pendiente', 'Programado', 'En curso', 'Finalizado', 'Facturado', 'Cancelado'], '', t.Estado || 'Pendiente')}
      ${field('Tecnico', 'text', null, '', t.Tecnico || '')}${field('Fecha_Programada', 'date', null, '', toInputDate(t.Fecha_Programada))}
      ${field('Hora_Inicio', 'time', null, '', t.Hora_Inicio || '')}${field('Hora_Fin', 'time', null, '', t.Hora_Fin || '')}
      ${field('Importe', 'number', null, '', t.Importe || '')}${field('Cobrado', 'number', null, '', t.Cobrado || '')}
      ${field('Facturacion_Estado', 'select', ['No facturado', 'Pendiente de facturar', 'Facturado'], '', t.Facturacion_Estado || (t.Estado === 'Finalizado' ? 'Pendiente de facturar' : 'No facturado'))}
      ${field('Factura_Nro', 'text', null, '', t.Factura_Nro || '')}${field('Factura_URL', 'text', null, '', t.Factura_URL || '')}
      ${field('Observaciones', 'textarea', null, 'full', t.Observaciones || '')}
    </div><div class="modalActions"><button onclick="saveForm('trabajo')">Guardar trabajo</button></div>`);
}

function openAgendaTrabajoModal(id) {
  const t = state.trabajos.find(x => x.ID === id);
  if (!t) return;
  const presupuesto = t.Presupuesto_ID ? (state.presupuestos || []).find(p => p.ID === t.Presupuesto_ID) : null;
  openModal('Reprogramar presupuesto', `
    <div class="formGrid">
      ${field('Fecha_Programada', 'date', null, '', toInputDate(t.Fecha_Programada) || new Date().toISOString().slice(0, 10))}
      ${field('Hora_Inicio', 'time', null, '', t.Hora_Inicio || '')}
      ${field('Hora_Fin', 'time', null, '', t.Hora_Fin || '')}
      ${field('Tecnico', 'text', null, '', t.Tecnico || '')}
      <div class="field full"><label>Presupuesto</label><input value="${esc(presupuesto?.ID || t.ID)} - ${esc(t.Cliente_Nombre || '')}" disabled></div>
    </div><div class="modalActions"><button onclick="programarTrabajo('${id}')">Guardar en agenda</button></div>`);
}

function openAgendaPresupuestoModal(id = '') {
  const presupuestos = (state.presupuestos || []).filter(p => {
    const tieneTrabajo = (state.trabajos || []).some(t => t.Presupuesto_ID === p.ID && t.Estado !== 'Cancelado');
    return tieneTrabajo || !['Rechazado', 'Vencido', 'Facturado'].includes(p.Estado);
  });
  const selected = id ? presupuestos.find(p => p.ID === id) : presupuestos[0];
  const trabajo = selected ? (state.trabajos || []).find(t => t.Presupuesto_ID === selected.ID && t.Estado !== 'Cancelado') : null;
  openModal('Coordinar presupuesto en agenda', `
    <div class="formGrid">
      ${selectField('Presupuesto_ID', presupuestos.map(p => [p.ID, `${p.ID} - ${p.Cliente_Nombre} - ${shortText(p.Detalle_Servicio || '', 50)}`]), id || selected?.ID || '', 'onchange="previewAgendaPresupuesto()"')}
      ${field('Estado_Trabajo', 'select', ['Programado', 'En curso', 'Finalizado'], '', trabajo?.Estado && ['Programado', 'En curso', 'Finalizado'].includes(trabajo.Estado) ? trabajo.Estado : 'Programado')}
      ${field('Fecha_Programada', 'date', null, '', toInputDate(trabajo?.Fecha_Programada) || new Date().toISOString().slice(0, 10))}
      ${field('Hora_Inicio', 'time', null, '', trabajo?.Hora_Inicio || '')}
      ${field('Hora_Fin', 'time', null, '', trabajo?.Hora_Fin || '')}
      ${field('Tecnico', 'text', null, '', trabajo?.Tecnico || '')}
      <div id="agendaPresupuestoInfo" class="formDivider full">${selected ? agendaPresupuestoInfo(selected) : 'No hay presupuestos activos para coordinar.'}</div>
    </div><div class="modalActions"><button onclick="programarPresupuesto()">Guardar en agenda</button></div>`);
}

function previewAgendaPresupuesto() {
  const id = document.getElementById('Presupuesto_ID')?.value;
  const presupuesto = state.presupuestos.find(p => p.ID === id);
  const trabajo = presupuesto ? (state.trabajos || []).find(t => t.Presupuesto_ID === presupuesto.ID && t.Estado !== 'Cancelado') : null;
  const info = document.getElementById('agendaPresupuestoInfo');
  if (info) info.textContent = presupuesto ? agendaPresupuestoInfo(presupuesto) : 'Selecciona un presupuesto.';
  if (trabajo) {
    setVal('Estado_Trabajo', ['Programado', 'En curso', 'Finalizado'].includes(trabajo.Estado) ? trabajo.Estado : 'Programado');
    setVal('Fecha_Programada', toInputDate(trabajo.Fecha_Programada));
    setVal('Hora_Inicio', trabajo.Hora_Inicio || '');
    setVal('Hora_Fin', trabajo.Hora_Fin || '');
    setVal('Tecnico', trabajo.Tecnico || '');
  }
}

function agendaPresupuestoInfo(p) {
  const trabajo = (state.trabajos || []).find(t => t.Presupuesto_ID === p.ID && t.Estado !== 'Cancelado');
  const agenda = trabajo?.Fecha_Programada ? ` - ${trabajo.Estado || 'Programado'} ${trabajo.Fecha_Programada}${trabajo.Hora_Inicio ? ' ' + trabajo.Hora_Inicio : ''}` : ' - Sin programar';
  return `${p.Cliente_Nombre || ''} - ${p.Direccion || ''}${p.Unidad_Trabajo ? ' - Unidad ' + p.Unidad_Trabajo : ''} - ${money(p.Total || 0)} - ${p.Estado || ''}${agenda}`;
}

function openCobroModal(preset = {}) {
  openModal('Nuevo cobro', `
    <div class="formGrid">
      ${field('Fecha', 'date', null, '', new Date().toISOString().slice(0, 10))}
      ${selectField('Cliente_ID', state.clientes.map(c => [c.ID, `${c.Nombre} - ${c.Tipo}`]), preset.clienteId)}
      ${selectField('Servicio_ID', [['', 'Sin visita/emergencia']].concat(state.servicios.map(s => [s.ID, `${s.ID} - ${s.Tipo} - ${s.Cliente_Nombre}`])), preset.servicioId)}
      ${selectField('Trabajo_ID', [['', 'Sin trabajo']].concat(state.trabajos.map(t => [t.ID, `${t.ID} - ${t.Titulo}`])), preset.trabajoId)}
      ${selectField('Presupuesto_ID', [['', 'Sin presupuesto']].concat(state.presupuestos.map(p => [p.ID, `${p.ID} - ${p.Cliente_Nombre}`])), preset.presupuestoId)}
      ${field('Tipo_Cobro', 'select', ['Adelanto', 'Pago parcial', 'Saldo final', 'Visita', 'Emergencia'], '', preset.tipo || 'Pago parcial')}
      ${field('Concepto', 'text', null, '', preset.concepto || 'Cobro de servicio')}
      ${field('Medio_Pago', 'select', ['Efectivo', 'Debito', 'Credito', 'Transferencia bancaria'], '', 'Transferencia bancaria')}
      ${field('Importe', 'number', null, '', preset.importe || '')}
      ${field('Facturado', 'select', ['No', 'Si'], '', preset.facturado || 'No')}
      ${field('Factura_Nro', 'text', null, '', preset.facturaNro || '')}${field('Factura_URL', 'text', null, '', preset.facturaUrl || '')}
      <div class="field full"><label>Factura o comprobante en Drive <span>PDF o imagen</span></label><input id="Factura_File" type="file" accept="application/pdf,image/*"></div>
      ${field('Observaciones', 'textarea', null, 'full')}
    </div><div class="modalActions"><button onclick="saveForm('cobro')">Guardar cobro</button></div>`);
  if (preset.servicioId) {
    const s = state.servicios.find(x => x.ID === preset.servicioId);
    if (s) {
      setVal('Cliente_ID', s.Cliente_ID);
      setVal('Importe', s.Saldo || s.Importe || '');
      setVal('Concepto', `${s.Tipo} ${s.Titulo || ''}`.trim());
    }
  }
}

function openCobroTrabajoModal(id) {
  const t = state.trabajos.find(x => x.ID === id);
  if (!t) return;
  if (t.Estado === 'Cerrado') return showToast('El trabajo esta cerrado. No se pueden cargar mas pagos.');
  const presupuesto = state.presupuestos.find(p => p.ID === t.Presupuesto_ID);
  const defaultTipo = Number(t.Cobrado || 0) === 0 && presupuesto && Number(presupuesto.Adelanto || 0) > 0 ? 'Adelanto' : 'Pago parcial';
  const importe = defaultTipo === 'Adelanto' ? presupuesto.Adelanto : (t.Saldo || t.Importe || '');
  openCobroModal({
    clienteId: t.Cliente_ID,
    trabajoId: t.ID,
    presupuestoId: t.Presupuesto_ID || '',
    tipo: defaultTipo,
    concepto: `${defaultTipo} - ${t.Titulo || t.ID}`,
    importe
  });
}

function openFacturaModal(id = '', preset = {}) {
  const f = id ? (state.facturas || []).find(x => x.ID === id) : {};
  const presetTrabajo = preset.trabajoId ? state.trabajos.find(t => t.ID === preset.trabajoId) : null;
  const presetServicio = preset.servicioId ? state.servicios.find(s => s.ID === preset.servicioId) : null;
  const presetPresupuesto = preset.presupuestoId ? state.presupuestos.find(p => p.ID === preset.presupuestoId) : (presetTrabajo?.Presupuesto_ID ? state.presupuestos.find(p => p.ID === presetTrabajo.Presupuesto_ID) : null);
  if (!id && presetTrabajo?.Estado === 'Cerrado') return showToast('El trabajo esta cerrado. No se pueden cargar mas facturas.');
  if (!id && presetServicio && serviceBilling(presetServicio).pendienteFacturar <= 0) return showToast('Este servicio ya esta facturado. Si falta cobrar, abrilo desde Facturas.');
  if (!id && presetPresupuesto && presupuestoBilling(presetPresupuesto).pendienteFacturar <= 0) return showToast('Este presupuesto ya esta facturado. Si falta cobrar, abrilo desde Facturas.');
  const presetPresupuestoId = preset.presupuestoId || presetTrabajo?.Presupuesto_ID || '';
  const presetClienteId = preset.clienteId || presetTrabajo?.Cliente_ID || presetServicio?.Cliente_ID || presetPresupuesto?.Cliente_ID || '';
  const pendingSource = presetServicio || presetPresupuesto || presetTrabajo;
  const selectedServicioId = f.Servicio_ID || preset.servicioId || '';
  const selectedTrabajoId = f.Trabajo_ID || preset.trabajoId || '';
  const selectedPresupuestoId = f.Presupuesto_ID || presetPresupuestoId;
  const initialConcept = f.Concepto || preset.concepto || suggestedFacturaConcept(pendingSource, presetServicio);
  const initialImporte = f.Importe || facturaPendiente(pendingSource, initialConcept) || pendingSource?.Importe || '';
  openModal(id ? 'Editar factura' : 'Nueva factura', `
    <div class="formGrid">
      ${field('ID', 'hidden', null, '', f.ID || '')}
      ${field('Fecha', 'date', null, '', toInputDate(f.Fecha) || new Date().toISOString().slice(0, 10))}
      ${selectField('Cliente_ID', [['', 'Seleccionar cliente']].concat(state.clientes.map(c => [c.ID, `${c.Nombre} - ${clientDocumentText(c.ID)} - ${c.Tipo}`])), f.Cliente_ID || presetClienteId, 'onchange="fillFacturaFromSelection()"')}
      <div class="field"><label>CUIT / DNI</label><input id="Factura_Documento" value="${esc(clientDocumentText(f.Cliente_ID || presetClienteId))}" disabled></div>
      ${selectField('Servicio_ID', [['', 'Sin visita/emergencia']].concat(invoiceableOptions(state.servicios, serviceBilling, selectedServicioId, s => `${s.ID} - ${s.Tipo} - ${s.Cliente_Nombre} - ${clientDocumentText(s.Cliente_ID)}`)), selectedServicioId, 'onchange="fillFacturaFromSelection()"')}
      ${field('Trabajo_ID', 'hidden', null, '', selectedTrabajoId)}
      ${selectField('Presupuesto_ID', [['', 'Sin presupuesto']].concat(invoiceableOptions(state.presupuestos, presupuestoBilling, selectedPresupuestoId, p => `${p.ID} - ${p.Cliente_Nombre} - ${clientDocumentText(p.Cliente_ID)}`)), selectedPresupuestoId, 'onchange="fillFacturaFromSelection()"')}
      ${selectField('Concepto', ['Visita', 'Emergencia', 'Pago parcial', 'Saldo final', 'Factura total'].map(x => [x, x]), initialConcept === 'Adelanto' ? 'Saldo final' : initialConcept, 'onchange="actualizarImporteFacturaPorConcepto()"')}
      ${field('Tipo', 'select', ['A', 'B', 'C', 'Otro'], '', f.Tipo || 'C')}
      ${field('Punto_Venta', 'text', null, '', f.Punto_Venta || '')}${field('Numero', 'text', null, '', f.Numero || '')}
      ${field('Factura_Nro', 'text', null, '', f.Factura_Nro || '')}
      <div class="field">
        <label>Importe</label>
        <input type="number" id="Importe" data-name="Importe" value="${esc(initialImporte)}">
        <button type="button" class="miniFieldBtn" onclick="usarPendienteFactura()">Tomar pendiente</button>
      </div>
      <div id="facturaPendingInfo" class="formDivider full">${pendingSource ? facturaPendingInfo(pendingSource) : 'Selecciona una visita, emergencia o presupuesto para ver el pendiente.'}</div>
      ${field('Estado', 'select', ['Pendiente de cobro', 'Cobrada', 'Anulada'], '', f.Estado || 'Pendiente de cobro')}
      ${field('Fecha_Cobro', 'date', null, '', toInputDate(f.Fecha_Cobro))}${field('Medio_Pago', 'select', ['Efectivo', 'Debito', 'Credito', 'Transferencia bancaria'], '', f.Medio_Pago || 'Transferencia bancaria')}
      ${field('Archivo_Nombre', 'text', null, '', f.Archivo_Nombre || '')}${field('Drive_URL', 'text', null, '', f.Drive_URL || '')}
      <div class="field full"><label>PDF de factura <span>lee numero e importe total</span></label><input id="Factura_File" type="file" accept="application/pdf,image/*" onchange="previewFacturaFile(this.files[0])"></div>
      ${field('Observaciones', 'textarea', null, 'full', f.Observaciones || '')}
    </div><div class="modalActions"><button onclick="guardarFactura()">Guardar factura</button></div>`);
  if (pendingSource) fillFacturaFromSelection();
}

function invoiceableOptions(rows, billingFn, selectedId, labelFn) {
  return (rows || [])
    .filter(row => row.ID === selectedId || billingFn(row).pendienteFacturar > 0)
    .map(row => [row.ID, labelFn(row)]);
}

function facturaPendiente(item, conceptoOverride = '') {
  if (!item) return '';
  const billing = itemBilling(item);
  return billing.pendienteFacturar || item.Saldo || '';
}

function facturaPendingInfo(item) {
  const billing = itemBilling(item);
  const presupuesto = presupuestoFromInvoiceSource(item);
  const adelantoInfo = presupuesto && Number(presupuesto.Adelanto || 0) > 0
    ? ` - Adelanto cobrado ${money(presupuesto.Adelanto)} - Saldo del presupuesto ${money(billing.saldoCobro)}`
    : '';
  return `Total ${money(billing.total)} - Facturado ${money(billing.facturado)} - Pendiente de facturar ${money(billing.pendienteFacturar)} - Falta cobrar ${money(billing.saldoCobro)}${adelantoInfo}`;
}

function itemBilling(item) {
  if (!item) return { total: 0, facturado: 0, pendienteFacturar: 0, saldoCobro: 0 };
  return item.ID?.startsWith('TRA') ? workBilling(item) : item.ID?.startsWith('PRE') ? presupuestoBilling(item) : serviceBilling(item);
}

function presupuestoFromInvoiceSource(item) {
  if (!item) return null;
  if (item.ID?.startsWith('PRE')) return item;
  const presupuestoId = item.Presupuesto_ID || '';
  return presupuestoId ? (state.presupuestos || []).find(p => p.ID === presupuestoId) || null : null;
}

function suggestedFacturaConcept(item, servicio = null) {
  if (servicio) return servicio.Tipo || 'Visita';
  const billing = itemBilling(item);
  if (billing.pendienteFacturar > 0 && billing.pendienteFacturar < billing.total) return 'Saldo final';
  if (billing.total > 0 && billing.pendienteFacturar === billing.total) return 'Factura total';
  return 'Pago parcial';
}

function clientById(id) {
  return (state.clientes || []).find(c => c.ID === id) || null;
}

function clientDocumentText(clienteId) {
  const cliente = clientById(clienteId);
  if (!cliente) return 'CUIT/DNI pendiente';
  const tipo = cliente.Documento_Tipo || 'CUIT/DNI';
  return cliente.CUIT_DNI ? `${tipo}: ${cliente.CUIT_DNI}` : `${tipo}: pendiente`;
}

function usarPendienteFactura() {
  const trabajo = state.trabajos.find(t => t.ID === document.getElementById('Trabajo_ID')?.value);
  const servicio = state.servicios.find(s => s.ID === document.getElementById('Servicio_ID')?.value);
  const presupuesto = state.presupuestos.find(p => p.ID === document.getElementById('Presupuesto_ID')?.value);
  const item = servicio || presupuesto || trabajo;
  if (!item) return showToast('Selecciona una visita, emergencia o presupuesto.');
  setVal('Importe', facturaPendiente(item));
}

function actualizarImporteFacturaPorConcepto() {
  const trabajo = state.trabajos.find(t => t.ID === document.getElementById('Trabajo_ID')?.value);
  const servicio = state.servicios.find(s => s.ID === document.getElementById('Servicio_ID')?.value);
  const presupuesto = state.presupuestos.find(p => p.ID === document.getElementById('Presupuesto_ID')?.value);
  const item = servicio || presupuesto || trabajo;
  if (!item) return;
  setVal('Importe', facturaPendiente(item));
  const info = document.getElementById('facturaPendingInfo');
  if (info) info.textContent = facturaPendingInfo(item);
}

function fillFacturaFromSelection() {
  const servicio = state.servicios.find(s => s.ID === document.getElementById('Servicio_ID')?.value);
  const trabajo = state.trabajos.find(t => t.ID === document.getElementById('Trabajo_ID')?.value);
  const presupuesto = state.presupuestos.find(p => p.ID === document.getElementById('Presupuesto_ID')?.value);
  const cliente = state.clientes.find(c => c.ID === document.getElementById('Cliente_ID')?.value);
  if (servicio) {
    setVal('Cliente_ID', servicio.Cliente_ID);
    setVal('Factura_Documento', clientDocumentText(servicio.Cliente_ID));
    setVal('Concepto', servicio.Tipo || 'Visita');
    if (!document.getElementById('Importe')?.value) setVal('Importe', facturaPendiente(servicio));
    const info = document.getElementById('facturaPendingInfo');
    if (info) info.textContent = facturaPendingInfo(servicio);
  } else if (presupuesto) {
    setVal('Cliente_ID', presupuesto.Cliente_ID);
    setVal('Factura_Documento', clientDocumentText(presupuesto.Cliente_ID));
    if (!document.getElementById('Concepto')?.value || document.getElementById('Concepto')?.value === 'Pago parcial') setVal('Concepto', suggestedFacturaConcept(presupuesto));
    if (!document.getElementById('Importe')?.value) setVal('Importe', facturaPendiente(presupuesto));
    const info = document.getElementById('facturaPendingInfo');
    if (info) info.textContent = facturaPendingInfo(presupuesto);
  } else if (trabajo) {
    setVal('Cliente_ID', trabajo.Cliente_ID);
    setVal('Factura_Documento', clientDocumentText(trabajo.Cliente_ID));
    if (trabajo.Presupuesto_ID) setVal('Presupuesto_ID', trabajo.Presupuesto_ID);
    if (!document.getElementById('Concepto')?.value || document.getElementById('Concepto')?.value === 'Pago parcial') setVal('Concepto', suggestedFacturaConcept(trabajo));
    if (!document.getElementById('Importe')?.value) setVal('Importe', facturaPendiente(trabajo));
    const info = document.getElementById('facturaPendingInfo');
    if (info) info.textContent = facturaPendingInfo(trabajo);
  } else if (cliente) {
    setVal('Factura_Documento', clientDocumentText(cliente.ID));
    if (!document.getElementById('Importe')?.value) setVal('Importe', '');
  }
}

async function previewFacturaFile(file) {
  if (!file) return;
  setVal('Archivo_Nombre', file.name);
  const info = parseFacturaFilename(file.name);
  if (info.puntoVenta) setVal('Punto_Venta', info.puntoVenta);
  if (info.numero) setVal('Numero', info.numero);
  if (info.facturaNro) setVal('Factura_Nro', info.facturaNro);
  if (info.tipo) setVal('Tipo', info.tipo);
  if (file.type === 'application/pdf') {
    try {
      showToast('Leyendo factura...');
      const dataUrl = await readFileAsDataUrl(file);
      const extracted = await api('/api/facturas/extract', { method: 'POST', loadingMessage: 'Leyendo factura y detectando importe...', body: JSON.stringify({ dataUrl, filename: file.name }) });
      if (extracted.Punto_Venta) setVal('Punto_Venta', extracted.Punto_Venta);
      if (extracted.Numero) setVal('Numero', extracted.Numero);
      if (extracted.Factura_Nro) setVal('Factura_Nro', extracted.Factura_Nro);
      if (extracted.Tipo) setVal('Tipo', extracted.Tipo);
      if (extracted.Importe) setVal('Importe', extracted.Importe);
      showToast(extracted.Importe ? 'Importe detectado en la factura.' : 'Factura leida. Revisa el importe.');
    } catch (error) {
      showError(error);
    }
  }
}

function parseFacturaFilename(filename) {
  const match = String(filename || '').match(/(\d{11})[_-](\d{3})[_-](\d{4,5})[_-](\d{8})/);
  if (!match) return {};
  const puntoVenta = match[3].padStart(5, '0');
  const numero = match[4].padStart(8, '0');
  return {
    tipo: match[2] === '011' ? 'C' : match[2],
    puntoVenta,
    numero,
    facturaNro: `${puntoVenta}-${numero}`
  };
}

async function guardarFactura() {
  const data = {};
  document.querySelectorAll('#modalBody [data-name]').forEach(el => data[el.dataset.name] = el.value);
  try {
    const file = document.getElementById('Factura_File')?.files?.[0];
    if (file) {
      const fileData = await readFileAsDataUrl(file);
      data.dataUrl = fileData;
      data.filename = file.name;
      data.Archivo_Nombre = data.Archivo_Nombre || file.name;
    }
    await api('/api/facturas', { method: 'POST', body: JSON.stringify(data) });
    showToast('Factura guardada.');
    closeModal();
    await loadData();
  } catch (error) {
    showError(error);
  }
}

async function marcarFacturaCobrada(id) {
  const f = (state.facturas || []).find(x => x.ID === id);
  if (!f) return;
  await api('/api/facturas', { method: 'POST', body: JSON.stringify({ ...f, Estado: 'Cobrada', Fecha_Cobro: new Date().toISOString().slice(0, 10) }) });
  showToast('Factura marcada como cobrada.');
  await loadData();
}

function openFacturacionTrabajoModal(id) {
  const t = state.trabajos.find(x => x.ID === id);
  if (!t) return;
  const cobros = (state.cobros || []).filter(c => c.Trabajo_ID === id);
  const facturas = (state.facturas || []).filter(f => f.Trabajo_ID === id);
  openModal('Facturacion del trabajo', `
    <div class="formGrid">
      <div class="field full"><label>Trabajo</label><input value="${esc(t.Titulo || t.ID)} - ${esc(t.Cliente_Nombre || '')}" disabled></div>
      <div class="field"><label>Total</label><input value="${money(t.Importe || 0)}" disabled></div>
      <div class="field"><label>Saldo</label><input value="${money(t.Saldo || 0)}" disabled></div>
      ${field('Facturacion_Estado', 'select', ['Pendiente de facturar', 'Facturado', 'No facturado'], '', t.Facturacion_Estado || 'Pendiente de facturar')}
      ${field('Factura_Nro', 'text', null, '', t.Factura_Nro || '')}${field('Factura_URL', 'text', null, '', t.Factura_URL || '')}
      <div class="field full"><label>Factura final en Drive <span>PDF o imagen</span></label><input id="Factura_File" type="file" accept="application/pdf,image/*"></div>
      <div class="field full"><label>Pagos asociados</label>
        <div class="paymentList">${cobros.map(c => `<p><b>${esc(c.Tipo_Cobro || 'Pago')}</b> - ${money(c.Importe)} - ${esc(c.Fecha)} - ${esc(c.Facturado || 'No')} ${c.Factura_Nro ? '- Factura ' + esc(c.Factura_Nro) : ''}</p>`).join('') || '<span class="muted">Sin pagos cargados.</span>'}</div>
      </div>
      <div class="field full"><label>Facturas asociadas</label>
        <div class="paymentList">${facturas.map(f => `<p><b>${esc(f.Factura_Nro || f.ID)}</b> - ${money(f.Importe)} - ${esc(f.Estado || '')} ${f.Drive_URL ? `- <a class="link" href="${esc(f.Drive_URL)}" target="_blank">Ver PDF</a>` : ''}</p>`).join('') || '<span class="muted">Sin facturas cargadas.</span>'}</div>
      </div>
    </div><div class="modalActions"><button class="secondaryBtn" onclick="openFacturaModal('', {trabajoId:'${id}'})">Nueva factura</button><button onclick="guardarFacturacionTrabajo('${id}')">Guardar facturacion</button></div>`);
}

function openGastoModal() {
  openModal('Nuevo gasto', `
    <div class="formGrid">
      ${field('Fecha', 'date', null, '', new Date().toISOString().slice(0, 10))}
      ${field('Categoria', 'select', ['Materiales', 'Combustible', 'Herramientas', 'Proveedor', 'Administrativo', 'Otro'], '', 'Materiales')}
      ${field('Proveedor', 'text')}${field('Concepto', 'text')}
      ${field('Medio_Pago', 'select', ['Efectivo', 'Debito', 'Credito', 'Transferencia bancaria'], '', 'Transferencia bancaria')}
      ${field('Importe', 'number')}
      ${field('Comprobante_URL', 'text')}${field('Observaciones', 'textarea', null, 'full')}
    </div><div class="modalActions"><button onclick="saveForm('gasto')">Guardar gasto</button></div>`);
}

function openFotoModal(trabajoId) {
  const trabajo = state.trabajos.find(t => t.ID === trabajoId);
  if (trabajo?.Estado === 'Cerrado') return showToast('El trabajo esta cerrado. No se pueden cargar mas adjuntos.');
  const fotos = state.fotos.filter(f => f.Trabajo_ID === trabajoId);
  openModal('Adjuntos del trabajo', `
    <div class="formGrid">
      ${field('Trabajo_ID', 'hidden', null, '', trabajoId)}
      ${field('Tipo_Foto', 'select', ['Antes', 'Durante', 'Despues', 'Adjunto'], '', 'Antes')}
      ${field('Descripcion', 'textarea', null, 'full')}
      <div class="field full"><label>Imagen o archivo</label><input id="fileInput" type="file" accept="image/*,.pdf"></div>
      <div class="field full"><label>Archivos cargados</label>${fotos.map(f => `<a class="link" href="${f.URL}" target="_blank">${esc(f.Tipo_Foto)} - ${esc(f.Descripcion || f.ID)}</a>`).join('<br>') || '<span class="muted">Sin adjuntos</span>'}</div>
    </div><div class="modalActions"><button onclick="uploadFile('${trabajoId}')">Subir archivo</button></div>`);
}

async function saveForm(type) {
  const data = {};
  document.querySelectorAll('#modalBody [data-name]').forEach(el => data[el.dataset.name] = el.value);
  let url = { cliente: '/api/clientes', admin: '/api/administradores', administracion: '/api/administraciones', contacto: '/api/contactos', unidad: '/api/unidades', servicio: '/api/servicios', presupuesto: '/api/presupuestos', trabajo: '/api/trabajos', cobro: '/api/cobros', gasto: '/api/gastos' }[type];
  try {
    if (type === 'cobro') await attachFacturaIfSelected(data);
    const res = await api(url, { method: 'POST', body: JSON.stringify(data) });
    showToast(type === 'presupuesto' ? 'Presupuesto generado.' : 'Guardado correctamente.');
    closeModal();
    await loadData();
    if (res && res.pdfUrl) window.open(res.pdfUrl, '_blank');
  } catch (error) {
    showError(error);
  }
}

async function convertirTrabajo(id) {
  try {
    const presupuesto = state.presupuestos.find(p => p.ID === id);
    if (presupuesto && presupuesto.Estado !== 'Aceptado') {
      showToast('Primero cambia el presupuesto a Aceptado.');
      return;
    }
    await api(`/api/convertir-presupuesto/${id}`, { method: 'POST' });
    showToast('Presupuesto convertido en trabajo.');
    loadData();
  } catch (error) {
    showError(error);
  }
}

async function changePresupuestoEstado(id, estado) {
  try {
    await api(`/api/presupuestos/${id}/estado`, { method: 'POST', body: JSON.stringify({ Estado: estado }) });
    showToast('Estado del presupuesto actualizado.');
    await loadData();
  } catch (error) {
    showError(error);
    await loadData();
  }
}

async function programarTrabajo(id) {
  const data = {};
  document.querySelectorAll('#modalBody [data-name]').forEach(el => data[el.dataset.name] = el.value);
  try {
    await api(`/api/trabajos/${id}/agenda`, { method: 'POST', body: JSON.stringify(data) });
    showToast('Trabajo enviado a agenda.');
    closeModal();
    await loadData();
    document.querySelector('.nav[data-view="agenda"]').click();
  } catch (error) {
    showError(error);
  }
}

async function programarPresupuesto() {
  const id = document.getElementById('Presupuesto_ID')?.value;
  if (!id) return showToast('Selecciona un presupuesto.');
  const data = {};
  document.querySelectorAll('#modalBody [data-name]').forEach(el => data[el.dataset.name] = el.value);
  try {
    await api(`/api/presupuestos/${id}/agenda`, { method: 'POST', body: JSON.stringify(data) });
    showToast('Presupuesto coordinado en agenda.');
    closeModal();
    await loadData();
    document.querySelector('.nav[data-view="agenda"]').click();
  } catch (error) {
    showError(error);
  }
}

async function guardarFacturacionTrabajo(id) {
  const data = {};
  document.querySelectorAll('#modalBody [data-name]').forEach(el => data[el.dataset.name] = el.value);
  try {
    const trabajo = state.trabajos.find(t => t.ID === id);
    await attachFacturaIfSelected(data, { trabajoId: id, presupuestoId: trabajo?.Presupuesto_ID || '', clienteNombre: trabajo?.Cliente_Nombre || '' });
    await api(`/api/trabajos/${id}/facturacion`, { method: 'POST', body: JSON.stringify(data) });
    showToast('Facturacion del trabajo actualizada.');
    closeModal();
    await loadData();
  } catch (error) {
    showError(error);
  }
}

async function attachFacturaIfSelected(data, extra = {}) {
  const input = document.getElementById('Factura_File');
  const file = input && input.files ? input.files[0] : null;
  if (!file) return;
  const selectedTrabajo = state.trabajos.find(t => t.ID === (data.Trabajo_ID || extra.trabajoId));
  const selectedPresupuesto = state.presupuestos.find(p => p.ID === (data.Presupuesto_ID || extra.presupuestoId));
  const selectedCliente = state.clientes.find(c => c.ID === data.Cliente_ID);
  showToast('Subiendo factura a Drive...');
  const uploaded = await uploadFacturaToDrive(file, {
    clienteNombre: extra.clienteNombre || selectedTrabajo?.Cliente_Nombre || selectedPresupuesto?.Cliente_Nombre || selectedCliente?.Nombre || '',
    trabajoId: data.Trabajo_ID || extra.trabajoId || '',
    presupuestoId: data.Presupuesto_ID || extra.presupuestoId || '',
    facturaNro: data.Factura_Nro || ''
  });
  data.Factura_URL = uploaded.url;
  data.Facturado = 'Si';
  if (document.getElementById('Factura_URL')) setVal('Factura_URL', uploaded.url);
  if (document.getElementById('Facturado')) setVal('Facturado', 'Si');
}

function uploadFacturaToDrive(file, context) {
  return readFileAsDataUrl(file).then(dataUrl => api('/api/upload-drive', { method: 'POST', body: JSON.stringify({
    ...context,
    dataUrl,
    filename: file.name
  }), loadingMessage: 'Subiendo archivo a Drive...' }));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function uploadFile(trabajoId) {
  const file = document.getElementById('fileInput').files[0];
  if (!file) return showToast('Selecciona un archivo.');
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      await api('/api/upload-trabajo', { method: 'POST', body: JSON.stringify({
        trabajoId,
        dataUrl: e.target.result,
        filename: file.name,
        tipo: document.getElementById('Tipo_Foto').value,
        descripcion: document.getElementById('Descripcion').value
      }) });
      showToast('Archivo guardado localmente.');
      closeModal();
      loadData();
    } catch (error) {
      showError(error);
    }
  };
  reader.readAsDataURL(file);
}

function autocompleteCliente(q, forTrabajo = false) {
  const box = document.getElementById('clienteSuggestions');
  q = (q || '').toLowerCase();
  if (!q) { box.classList.add('hidden'); return; }
  const list = state.lookups.clientes.filter(c => `${c.nombre} ${c.direccion} ${c.tipo}`.toLowerCase().includes(q)).slice(0, 12);
  box.innerHTML = list.map(c => `<div onclick="selectCliente('${c.id}', ${forTrabajo})">${esc(c.label)}</div>`).join('');
  box.classList.toggle('hidden', !list.length);
}

function selectCliente(id, forTrabajo = false) {
  selectedCliente = state.clientes.find(c => c.ID === id);
  if (!selectedCliente) return;
  document.getElementById('Cliente_ID').value = selectedCliente.ID;
  const input = forTrabajo ? document.getElementById('trabClienteSearch') : (document.getElementById('clienteSearch') || document.getElementById('servClienteSearch'));
  if (input) input.value = selectedCliente.Nombre;
  setVal('Cliente_Documento', clientDocumentText(selectedCliente.ID));
  setVal('Factura_Documento', clientDocumentText(selectedCliente.ID));
  setVal('Cliente_Tipo', selectedCliente.Tipo || '');
  setVal('Direccion', selectedCliente.Direccion || '');
  const box = document.getElementById('clienteSuggestions'); if (box) box.classList.add('hidden');
  const unidadBox = document.getElementById('unidadBox');
  if (unidadBox) unidadBox.classList.toggle('hidden', selectedCliente.Tipo !== 'Consorcio');
  const dl = document.getElementById('unidadesList');
  if (dl) {
    const unidades = state.unidades.filter(u => u.Cliente_ID === id);
    dl.innerHTML = unidades.map(u => `<option value="${esc(u.Unidad)}">${esc(u.Propietario || u.Inquilino || '')}</option>`).join('');
  }
  const admin = state.administradores.find(a => a.Cliente_ID === id);
}

function bindGlobalSearch() {
  const input = document.getElementById('globalSearch');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { document.getElementById('searchResults').style.display = 'none'; return; }
    timer = setTimeout(async () => {
      try {
        const results = await api(`/api/search?q=${encodeURIComponent(q)}`);
        renderSearch(results);
      } catch (error) {
        showError(error);
      }
    }, 250);
  });
}

function renderSearch(results) {
  const box = document.getElementById('searchResults');
  box.style.display = 'block';
  box.innerHTML = results.length ? results.map(r => `<div class="searchItem"><b>${esc(r.tipo)}</b> - ${esc(r.id)}<br>${esc(r.texto)}</div>`).join('') : '<div class="searchItem">Sin resultados.</div>';
}

function renderHistorialOptions() {
  const q = document.getElementById('historialSearch').value.toLowerCase();
  const list = state.clientes.filter(c => `${c.Nombre} ${c.Direccion} ${c.CUIT_DNI}`.toLowerCase().includes(q)).slice(0, 10);
  document.getElementById('historialOptions').innerHTML = list.map(c => `<div class="optionItem" onclick="showHistorial('${c.ID}')">${c.Tipo === 'Consorcio' ? 'Edificio' : 'Cliente'} ${esc(c.Nombre)} - ${esc(c.Direccion || '')}</div>`).join('');
}

function showHistorial(id) {
  const c = state.clientes.find(x => x.ID === id);
  const presup = state.presupuestos.filter(p => p.Cliente_ID === id);
  const trab = state.trabajos.filter(t => t.Cliente_ID === id);
  const admins = state.administradores.filter(a => a.Cliente_ID === id);
  const unidades = state.unidades.filter(u => u.Cliente_ID === id);
  const cobros = state.cobros.filter(co => co.Cliente_ID === id);
  document.getElementById('historialContent').innerHTML = `
    <h2>${esc(c.Nombre)}</h2><p>${esc(c.Direccion || '')} - ${esc(c.Whatsapp || '')} - ${esc(c.Email || '')}</p>
    <div class="historyGrid">
      <div class="historyPanel"><h3>Presupuestos</h3>${presup.map(p => `<p><b>${p.ID}</b> - ${money(p.Total)} - ${p.Estado}<br><a class="link" href="/api/presupuestos/${p.ID}/pdf" target="_blank">Ver PDF</a></p>`).join('') || 'Sin presupuestos'}</div>
      <div class="historyPanel"><h3>Trabajos</h3>${trab.map(t => `<p><b>${t.ID}</b> - ${esc(t.Titulo)}<br>${esc(t.Estado)} - ${esc(t.Fecha_Programada || '')}</p>`).join('') || 'Sin trabajos'}</div>
      <div class="historyPanel"><h3>Contactos internos</h3>${admins.map(a => `<p><b>${esc(a.Administracion)}</b><br>${esc(a.Contacto)}<br>${wa(a.Whatsapp)} - ${mail(a.Email)}</p>`).join('') || ''}${unidades.map(u => `<p><b>Unidad ${esc(u.Unidad)}</b><br>Prop: ${esc(u.Propietario || '-')} ${wa(u.Propietario_Whatsapp)}<br>Inq: ${esc(u.Inquilino || '-')} ${wa(u.Inquilino_Whatsapp)}<br>Enc: ${esc(u.Encargado || '-')} ${wa(u.Encargado_Whatsapp)}</p>`).join('') || ''}</div>
      <div class="historyPanel"><h3>Cobros</h3>${cobros.map(co => `<p><b>${esc(co.Fecha)}</b> - ${money(co.Importe)}<br>${esc(co.Concepto)}</p>`).join('') || 'Sin cobros'}</div>
    </div>`;
}

async function deleteRow(table, id) {
  if (!confirm('Eliminar registro?')) return;
  try {
    await api(`/api/${table}/${id}`, { method: 'DELETE' });
    showToast('Eliminado.');
    loadData();
  } catch (error) {
    showError(error);
  }
}

async function cerrarTrabajo(id) {
  if (!confirm('Cerrar este trabajo? Despues no se podran cargar mas pagos, facturas ni adjuntos.')) return;
  try {
    await api(`/api/trabajos/${id}/cerrar`, { method: 'POST', body: JSON.stringify({}) });
    showToast('Trabajo cerrado.');
    loadData();
  } catch (error) {
    showError(error);
  }
}

function field(name, type = 'text', options = null, extra = '', value = '') {
  if (type === 'hidden') return `<input type="hidden" id="${name}" data-name="${name}" value="${esc(value)}">`;
  let input = '';
  if (type === 'select') input = `<select id="${name}" data-name="${name}">${(options || []).map(o => `<option ${o == value ? 'selected' : ''} value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
  else if (type === 'textarea') input = `<textarea id="${name}" data-name="${name}">${esc(value)}</textarea>`;
  else input = `<input type="${type}" id="${name}" data-name="${name}" value="${esc(value)}">`;
  return `<div class="field ${extra}"><label>${label(name)}</label>${input}</div>`;
}

function selectField(name, options, value = '', attrs = '') {
  return `<div class="field"><label>${label(name)}</label><select id="${name}" data-name="${name}" ${attrs}>${options.map(([v, l]) => `<option ${String(v) === String(value) ? 'selected' : ''} value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>`;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value).length <= 10 ? `${value}T12:00:00` : value);
  return isNaN(d) ? null : d;
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function periodKey(date, group) {
  if (group === 'year') return String(date.getFullYear());
  if (group === 'week') {
    const w = isoWeek(date);
    return `${w.year}-S${String(w.week).padStart(2, '0')}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(date, group) {
  if (group === 'year') return String(date.getFullYear());
  if (group === 'week') {
    const w = isoWeek(date);
    return `Semana ${String(w.week).padStart(2, '0')} / ${w.year}`;
  }
  return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

function parsePeriodSortDate(sort, group) {
  if (!sort) return null;
  if (group === 'year') return new Date(Number(sort), 0, 1);
  if (group === 'week') {
    const match = String(sort).match(/^(\d{4})-S(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const day = (simple.getDay() + 6) % 7;
    simple.setDate(simple.getDate() - day);
    return simple;
  }
  const parts = String(sort).split('-');
  return new Date(Number(parts[0]), Number(parts[1] || 1) - 1, 1);
}

function exportReportCsv() {
  const range = selectedDashboardRange();
  const rows = buildReportRows(reportGroup).filter(row => {
    const d = parsePeriodSortDate(row.sort, reportGroup);
    return d && d >= range.start && d <= range.end;
  });
  const lines = [['Periodo', 'Presupuestos en agenda', 'Visitas/Emergencias', 'Presupuestos', 'Ingresos', 'Gastos', 'Ganancia']]
    .concat(rows.map(r => [r.label, r.trabajos, r.servicios, r.presupuestos, r.ingresos, r.gastos, r.ganancia]))
    .map(cols => cols.map(v => `"${String(v).replaceAll('"', '""')}"`).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-${reportGroup}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function openModal(title, body) { document.getElementById('modalTitle').textContent = title; document.getElementById('modalBody').innerHTML = body; document.getElementById('modal').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal').classList.add('hidden'); }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 3500); }
function showError(err) { showToast('Error: ' + (err.message || err)); console.error(err); }
function formatCell(col, val) { if ((col === 'PDF_URL' || col === 'Factura_URL') && val) return `<a class="link" href="${val}" target="_blank">Ver</a>`; if (col === 'Detalle_Servicio' || col === 'Detalle' || col === 'Concepto') return detailPreview(val); if (col === 'Adelanto') return Number(val || 0) > 0 ? money(val) : '-'; if (['Total', 'Importe', 'Cobrado', 'Saldo'].includes(col)) return money(val); if (col === 'Whatsapp' && val) return wa(val); if (col === 'Email' && val) return mail(val); if (col === 'Estado' || col === 'Facturado') return `<span class="badge ${val === 'Aceptado' || val === 'Finalizado' || val === 'Activo' || val === 'Si' ? 'ok' : 'warn'}">${esc(val || '')}</span>`; return esc(val || ''); }
function detailPreview(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= 95) return `<span class="detailPreview">${esc(text)}</span>`;
  return `<details class="detailDrop"><summary>${esc(shortText(text, 95))}</summary><p>${esc(text)}</p></details>`;
}
function label(s) { return String(s).replaceAll('_', ' '); }
function money(n) { return '$ ' + Number(n || 0).toLocaleString('es-AR'); }
function shortText(value, max) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '...' : text; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function phoneDigits(n) { return String(n || '').replace(/\D/g, ''); }
function whatsappDigits(n) {
  let digits = phoneDigits(n);
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('9') && digits.length === 11) return `54${digits}`;
  if (digits.startsWith('54')) {
    const national = digits.slice(2).replace(/^0/, '').replace(/^15/, '');
    return `549${national}`;
  }
  if (digits.length === 10 && digits.startsWith('15')) return `54911${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('11')) return `549${digits}`;
  if (digits.length === 8 && !digits.startsWith('11')) return `54911${digits}`;
  if (digits.length >= 10 && digits.length <= 11) return `549${digits.replace(/^0/, '').replace(/^15/, '')}`;
  return digits;
}
function phoneHref(n) { const p = phoneDigits(n); return p ? `+${p}` : ''; }
function phoneLink(n) { return n ? `<a class="tableContactLink" href="tel:${esc(phoneHref(n))}">${esc(n)}</a>` : ''; }
function wa(n) { const p = whatsappDigits(n); return p ? `<a class="link" target="_blank" href="https://wa.me/${p}">${esc(n)}</a>` : ''; }
function mail(e) { return e ? `<a class="link" href="mailto:${esc(e)}">${esc(e)}</a>` : ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }
function toInputDate(d) { if (!d) return ''; const date = new Date(d); if (isNaN(date)) return d; return date.toISOString().slice(0, 10); }
function sameDay(a, b) {
  const d1 = a instanceof Date ? a : parseDate(a);
  const d2 = b instanceof Date ? b : parseDate(b);
  return !!d1 && !!d2 && d1.toDateString() === d2.toDateString();
}
function weekDays() { const now = new Date(); const day = (now.getDay() + 6) % 7; const monday = new Date(now); monday.setDate(now.getDate() - day); const names = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes']; return names.map((n, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return { label: n, short: d.toLocaleDateString('es-AR'), date: d }; }); }


