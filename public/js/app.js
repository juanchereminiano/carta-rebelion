/* ── CARTA REBELION — App ──────────────────────────────────────────────── */

// ── Estado global ──────────────────────────────────────────────────────────
const state = {
  // Filtros multi-select (arrays; 'all' = sin restricción)
  anos:       ['all'],
  meses:      ['all'],
  categorias: ['all'],
  productos:  ['all'],
  metric:     'ventas',
  // Tabla
  sortCol: 'rank', sortDir: 'asc',
  search: '', clase: 'all', tableCat: 'all',
  _catalogReady: false,
};

// Instancias de charts
const charts = {};
let allItems  = [];
let rawData   = null;

// Catálogo completo (años, meses, cats, productos)
let catalog = { anos: [], meses: [], categorias: [], productos: [] };

// ── Seguimiento ────────────────────────────────────────────────────────────
const SEG_KEY = 'carta_seguimiento_v1';
let segList = JSON.parse(localStorage.getItem(SEG_KEY) || '[]'); // array de nombres

// Paleta de colores para sparklines de seguimiento
const SEG_PALETTE = ['#3b82f6','#c8a84b','#22c55e','#f43f5e','#a855f7','#14b8a6','#f97316','#6366f1'];

// ── Clase MultiSelect ──────────────────────────────────────────────────────
class MultiSelect {
  // searchable: si true, muestra un campo de búsqueda dentro del panel
  constructor({ container, label, onChange, searchable = false }) {
    this.container  = container;
    this.label      = label;
    this.onChange   = onChange;
    this.searchable = searchable;
    this.options    = [];   // [{value, text}]
    this.selected   = new Set(['all']);
    this._query     = '';   // texto del buscador interno
    this._build();
  }

  _build() {
    this.container.innerHTML = '';

    this.btn = document.createElement('button');
    this.btn.className = 'ms-btn';
    this.btn.innerHTML =
      `<span class="ms-label">${this.label}:</span>` +
      `<span class="ms-summary">Todos</span>` +
      `<span class="ms-caret">▾</span>`;

    this.panel = document.createElement('div');
    this.panel.className = 'ms-panel';

    // Buscador interno (solo si searchable)
    if (this.searchable) {
      this._searchInput = document.createElement('input');
      this._searchInput.type        = 'text';
      this._searchInput.placeholder = 'Buscar…';
      this._searchInput.className   = 'ms-search';
      this._searchInput.autocomplete = 'off';
      this._searchInput.addEventListener('input', () => {
        this._query = this._searchInput.value.trim().toLowerCase();
        this._renderList();
      });
      // Evitar que el keydown cierre el panel
      this._searchInput.addEventListener('keydown', e => e.stopPropagation());
      this.panel.appendChild(this._searchInput);

      const sep = document.createElement('div');
      sep.className = 'ms-divider';
      this.panel.appendChild(sep);
    }

    // Contenedor de opciones (scrollable)
    this._listEl = document.createElement('div');
    this._listEl.className = 'ms-list';
    this.panel.appendChild(this._listEl);

    this.container.appendChild(this.btn);
    this.container.appendChild(this.panel);

    this.btn.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });
    this.panel.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => this._close());
  }

  setOptions(options) {
    this.options = options;
    // Quitar seleccionados que ya no existen
    const valid = new Set(options.map(o => o.value));
    for (const v of this.selected) {
      if (v !== 'all' && !valid.has(v)) this.selected.delete(v);
    }
    if (this.selected.size === 0) this.selected.add('all');
    this._query = '';
    if (this._searchInput) this._searchInput.value = '';
    this._renderList();
    this._updateBtn();
  }

  _renderList() {
    this._listEl.innerHTML = '';
    const q = this._query;

    // Filtrar opciones según búsqueda
    const visible = q
      ? this.options.filter(o => o.text.toLowerCase().includes(q))
      : this.options;

    // "Todos" — solo si no hay búsqueda activa
    if (!q) {
      this._listEl.appendChild(this._makeOption('all', 'Todos', true));
      if (visible.length > 0) {
        const d = document.createElement('div');
        d.className = 'ms-divider';
        this._listEl.appendChild(d);
      }
    }

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ms-empty';
      empty.textContent = 'Sin resultados';
      this._listEl.appendChild(empty);
      return;
    }

    visible.forEach(opt => this._listEl.appendChild(this._makeOption(opt.value, opt.text, false)));
  }

  _makeOption(value, text, isAll) {
    const lbl = document.createElement('label');
    lbl.className = 'ms-option' + (isAll ? ' ms-option-all' : '');

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.value   = value;
    cb.checked = this.selected.has(value);

    cb.addEventListener('change', () => {
      if (value === 'all') {
        this.selected.clear();
        this.selected.add('all');
      } else {
        this.selected.delete('all');
        if (cb.checked) this.selected.add(value);
        else            this.selected.delete(value);
        if (this.selected.size === 0) this.selected.add('all');
      }
      this._renderList();
      this._updateBtn();
      this.onChange([...this.selected]);
    });

    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + text));
    return lbl;
  }

  _updateBtn() {
    const sumEl = this.btn.querySelector('.ms-summary');
    const isAll = this.selected.has('all');
    if (isAll) {
      sumEl.textContent = 'Todos';
      this.btn.classList.remove('has-filter');
    } else {
      const vals = [...this.selected];
      sumEl.textContent = vals.length === 1 ? vals[0] : `${vals.length} sel.`;
      this.btn.classList.add('has-filter');
    }
  }

  getValue() { return [...this.selected]; }

  reset() {
    this.selected.clear();
    this.selected.add('all');
    this._query = '';
    if (this._searchInput) this._searchInput.value = '';
    this._renderList();
    this._updateBtn();
  }

  _toggle() {
    const isOpen = this.panel.classList.contains('open');
    document.querySelectorAll('.ms-panel.open').forEach(p => p.classList.remove('open'));
    if (!isOpen) {
      this.panel.classList.add('open');
      // Foco al buscador al abrir
      if (this._searchInput) setTimeout(() => this._searchInput.focus(), 50);
    }
  }

  _close() { this.panel.classList.remove('open'); }
}

// Instancias
let msAno, msMes, msCat, msProd;

// ── Formateo ───────────────────────────────────────────────────────────────
const fmt = {
  pesos:     n => n == null ? '—' : n >= 1e6 ? '$'+(n/1e6).toFixed(1)+'M' : n >= 1e3 ? '$'+(n/1e3).toFixed(0)+'k' : '$'+Math.round(n).toLocaleString('es-AR'),
  pesosFull: n => n == null ? '—' : '$'+Math.round(n).toLocaleString('es-AR'),
  num:       n => n == null ? '—' : Math.round(n).toLocaleString('es-AR'),
  pct:       n => n == null ? '—' : n.toFixed(1)+'%',
  growth:    n => n == null ? '—' : (n >= 0 ? '+' : '')+n.toFixed(1)+'%',
};

function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── Refresh status indicator ───────────────────────────────────────────────
let _lastFetch    = null;   // timestamp de la última carga exitosa
let _statusTimer  = null;   // interval que actualiza "hace X seg"
let _autoRefresh  = null;   // interval del auto-refresh de 60s
let _autoCountdown = 60;    // segundos restantes para el próximo auto-refresh

function setRefreshStatus(state) {
  const el = document.getElementById('refresh-status');
  if (!el) return;
  el.className = 'refresh-status';
  if (state === 'loading') {
    el.textContent = 'Actualizando…';
  } else if (state === 'ok') {
    _lastFetch = Date.now();
    _autoCountdown = 60;
    el.classList.add('ok');
    _startStatusTick();
  } else if (state === 'error') {
    el.textContent = 'Error al cargar';
  }
}

function _startStatusTick() {
  if (_statusTimer) clearInterval(_statusTimer);
  _statusTimer = setInterval(() => {
    const el = document.getElementById('refresh-status');
    if (!el || !_lastFetch) return;
    const secsAgo = Math.round((Date.now() - _lastFetch) / 1000);
    _autoCountdown = Math.max(0, 60 - secsAgo);
    el.className = 'refresh-status ok';
    el.textContent = secsAgo < 5
      ? '✓ Actualizado'
      : `Actualizado hace ${secsAgo}s · próximo en ${_autoCountdown}s`;
  }, 1000);
}

function _startAutoRefresh() {
  if (_autoRefresh) clearInterval(_autoRefresh);
  _autoRefresh = setInterval(() => {
    loadData();   // el servidor tiene cache de 60s; este ciclo coincide con eso
  }, 60_000);
}

// ── Sidebar navigation ─────────────────────────────────────────────────────
const SECTION_TITLES = {
  dashboard:   'Dashboard',
  evolucion:   'Evolución',
  categorias:  'Categorías',
  tabla:       'Tabla de items',
  bcg:         'Matriz BCG',
  seguimiento: 'Seguimiento',
  cmv:         'CMV',
};

function navigateTo(section) {
  // Secciones
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('section-' + section);
  if (el) el.classList.add('active');

  // Nav items
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.section === section);
  });

  // Título topbar
  document.getElementById('section-title').textContent = SECTION_TITLES[section] || section;

  // Cerrar sidebar en mobile
  if (window.innerWidth <= 768) closeMobileSidebar();
}

document.querySelectorAll('.nav-item:not(.nav-item-disabled)').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.section));
});

// ── Sidebar collapse ───────────────────────────────────────────────────────
const sidebar    = document.getElementById('sidebar');
const appLayout  = document.querySelector('.app-layout');

document.getElementById('btn-collapse').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  appLayout.classList.toggle('sidebar-collapsed');
});

// Mobile
document.getElementById('btn-hamburger').addEventListener('click', () => {
  sidebar.classList.add('mobile-open');
  document.getElementById('overlay').classList.add('show');
});
function closeMobileSidebar() {
  sidebar.classList.remove('mobile-open');
  document.getElementById('overlay').classList.remove('show');
}
document.getElementById('overlay').addEventListener('click', closeMobileSidebar);

// ── Filtros globales — MultiSelect ─────────────────────────────────────────

function initFilters() {
  msAno = new MultiSelect({
    container: document.getElementById('ms-ano'),
    label: 'Año',
    onChange: vals => { state.anos = vals; loadData(); },
  });
  msMes = new MultiSelect({
    container: document.getElementById('ms-mes'),
    label: 'Mes',
    onChange: vals => { state.meses = vals; loadData(); },
  });
  msCat = new MultiSelect({
    container: document.getElementById('ms-cat'),
    label: 'Categoría',
    searchable: true,
    onChange: vals => {
      state.categorias = vals;
      _refreshProductOptions();
      loadData();
    },
  });
  msProd = new MultiSelect({
    container: document.getElementById('ms-prod'),
    label: 'Producto',
    searchable: true,
    onChange: vals => { state.productos = vals; loadData(); },
  });
}

function _refreshProductOptions() {
  const catSel = state.categorias;
  let prods;
  if (catSel.includes('all')) {
    prods = catalog.productos;
  } else {
    prods = catalog.productos.filter(p => catSel.includes(p.categoria));
  }
  msProd.setOptions(prods.map(p => ({ value: p.producto, text: p.producto })));
}

function populateCatalog(cat) {
  catalog = cat;  // { anos, meses, categorias, productos }

  msAno.setOptions(cat.anos.map(a      => ({ value: String(a), text: String(a) })));
  msMes.setOptions(cat.meses.map(m     => ({ value: m, text: m.charAt(0) + m.slice(1).toLowerCase() })));
  msCat.setOptions(cat.categorias.map(c => ({ value: c, text: c })));
  _refreshProductOptions();
}

// Métrica
document.getElementById('metric-ventas').addEventListener('click', () => {
  state.metric = 'ventas';
  document.getElementById('metric-ventas').classList.add('active');
  document.getElementById('metric-cantidad').classList.remove('active');
  loadData();
});
document.getElementById('metric-cantidad').addEventListener('click', () => {
  state.metric = 'cantidad';
  document.getElementById('metric-cantidad').classList.add('active');
  document.getElementById('metric-ventas').classList.remove('active');
  loadData();
});

// ── Helper: crear o actualizar chart ───────────────────────────────────────
function upsertChart(id, config) {
  if (charts[id]) {
    charts[id].data    = config.data;
    charts[id].options = config.options || charts[id].options;
    charts[id].update();
    return charts[id];
  }
  charts[id] = new Chart(document.getElementById(id).getContext('2d'), config);
  return charts[id];
}

const CHART_DEFAULTS = {
  tooltip: {
    backgroundColor: '#1a1a1a', borderColor: '#e0dbd2', borderWidth: 1,
    titleColor: '#ffffff', bodyColor: '#cccccc',
  },
  legend: (pos='bottom') => ({
    position: pos, labels: { color: '#7a7060', boxWidth: 12, padding: 14 },
  }),
  scaleX: { grid: { color: '#e8e3db' }, ticks: { color: '#7a7060', maxRotation: 45, font: { size: 11 } } },
  scaleY: { grid: { color: '#e8e3db' }, ticks: { color: '#7a7060' } },
};

// Paleta Rebelión
const CLASE_COLOR  = { A: '#4a9eff', B: '#c8a84b', C: '#5a7fa8' };  // azul / dorado / azul apagado
const CAT_PALETTE  = ['#2b5ead','#4a9eff','#c8a84b','#3b8a6e','#6e4fa8','#2d7d9a','#b87333','#4a7c59','#7a5c8a','#2a6496','#8a6a2a','#3d6b8a'];

// ── DASHBOARD ──────────────────────────────────────────────────────────────

function renderSummary(s) {
  const isV = state.metric === 'ventas';
  document.getElementById('summary-grid').innerHTML = `
    <div class="summary-card">
      <div class="s-label">${isV ? 'Ventas totales' : 'Unidades vendidas'}</div>
      <div class="s-value">${isV ? fmt.pesos(s.totalVentas) : fmt.num(s.totalCantidad)}</div>
      <div class="s-sub">${(s.años||[]).join(' · ')}</div>
    </div>
    <div class="summary-card">
      <div class="s-label">Items en carta</div>
      <div class="s-value">${s.totalItems}</div>
      <div class="s-sub">${s.totalCategorias} categorías</div>
    </div>
    <div class="summary-card">
      <div class="s-label">Precio promedio</div>
      <div class="s-value">${fmt.pesosFull(s.ticketPromedio)}</div>
      <div class="s-sub">por unidad</div>
    </div>
    <div class="summary-card">
      <div class="s-label">Período</div>
      <div class="s-value" style="font-size:1rem">${(s.meses||[]).length} meses</div>
      <div class="s-sub">${s.meses?.[0]||''} → ${s.meses?.at(-1)||''}</div>
    </div>
  `;
}

function renderPareto(pareto) {
  const items   = pareto.items.slice(0, 20);
  const labels  = items.map(i => i.producto.length > 20 ? i.producto.slice(0,18)+'…' : i.producto);
  const valores = items.map(i => state.metric === 'cantidad' ? i.cantidad : i.ventas);
  const isV     = state.metric === 'ventas';

  upsertChart('chart-pareto', {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: isV ? 'Ventas $' : 'Cantidad',
          data: valores, backgroundColor: items.map(i => CLASE_COLOR[i.clase]+'cc'),
          borderRadius: 4, yAxisID: 'yBar', order: 2,
        },
        {
          type: 'line', label: '% Acumulado',
          data: items.map(i => i.pctCum),
          borderColor: '#c8a84b', backgroundColor: 'transparent',
          borderWidth: 2, pointRadius: 3, tension: 0.3, yAxisID: 'yLine', order: 1,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: CHART_DEFAULTS.legend(),
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: ctx => ctx.dataset.yAxisID === 'yLine'
            ? ` Acum: ${ctx.parsed.y.toFixed(1)}%`
            : isV ? ` ${fmt.pesosFull(ctx.parsed.y)}` : ` ${fmt.num(ctx.parsed.y)} uds`,
        }},
      },
      scales: {
        x: CHART_DEFAULTS.scaleX,
        yBar: { ...CHART_DEFAULTS.scaleY, position: 'left', ticks: { color: '#7b7f94',
          callback: v => isV ? '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':(v/1e3).toFixed(0)+'k') : fmt.num(v) } },
        yLine: { position: 'right', grid: { drawOnChartArea: false }, min: 0, max: 100,
          ticks: { color: '#7b7f94', callback: v => v+'%' } },
      },
    },
  });
}

function renderDonut(cats, canvasId = 'chart-donut', legendId = 'cat-legend') {
  const top    = cats.slice(0, 10);
  const isV    = state.metric === 'ventas';
  const colors = top.map((_, i) => CAT_PALETTE[i % CAT_PALETTE.length]);

  upsertChart(canvasId, {
    type: 'doughnut',
    data: {
      labels: top.map(c => c.nombre),
      datasets: [{ data: top.map(c => isV ? c.ventas : c.cantidad),
        backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: ctx => { const pct = cats[ctx.dataIndex]?.pct||0;
            return ` ${isV ? fmt.pesosFull(ctx.parsed) : fmt.num(ctx.parsed)}  (${pct}%)`; },
        }},
      },
    },
  });

  if (legendId) {
    document.getElementById(legendId).innerHTML = top.map((c, i) => `
      <div class="cat-legend-item">
        <div class="cat-legend-dot" style="background:${colors[i]}"></div>
        <span>${c.nombre.replace(/^\d+\s+/,'')} <strong style="color:var(--text)">${c.pct}%</strong></span>
      </div>
    `).join('');
  }
}

function renderABCCards(pareto) {
  const isV = state.metric === 'ventas';
  const ABC_INFO = {
    A: { label: 'Estrellas',   desc: 'Generan el 70% de las ventas. Nunca deben faltar.' },
    B: { label: 'Intermedios', desc: 'Entre el 70% y 90%. Sostienen el volumen.' },
    C: { label: 'Cola larga',  desc: 'Último 10%. Evaluar continuidad o rediseño.' },
  };
  document.getElementById('abc-cards').innerHTML = ['A','B','C'].map(cl => {
    const count = pareto.conteo[cl] || 0;
    const val   = pareto.ventasPorClase[cl] || 0;
    const pct   = pareto.total > 0 ? (val/pareto.total*100).toFixed(1) : 0;
    return `<div class="abc-card">
      <div class="abc-card-header">
        <div class="badge-big ${cl.toLowerCase()}">${cl}</div>
        <div class="badge-title">${ABC_INFO[cl].label}</div>
      </div>
      <div class="abc-stats">
        <div class="abc-stat"><span class="label">Items</span><span class="value">${count}</span></div>
        <div class="abc-stat"><span class="label">${isV?'Ventas':'Uds.'}</span>
          <span class="value">${isV ? fmt.pesos(val) : fmt.num(val)}</span></div>
        <div class="abc-stat"><span class="label">% total</span><span class="value">${pct}%</span></div>
      </div>
      <div class="abc-desc">${ABC_INFO[cl].desc}</div>
    </div>`;
  }).join('');
}

// ── EVOLUCIÓN ──────────────────────────────────────────────────────────────

function renderEvolucion(evo) {
  const isV = state.metric === 'ventas';
  upsertChart('chart-evolucion', {
    type: 'line',
    data: {
      labels: evo.labels,
      datasets: [{
        label: isV ? 'Ventas $' : 'Cantidad',
        data: isV ? evo.ventas : evo.cantidad,
        borderColor: '#4a9eff', backgroundColor: '#2b5ead18',
        borderWidth: 2.5, tension: 0.35, pointRadius: 4, fill: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: ctx => isV ? ` ${fmt.pesosFull(ctx.parsed.y)}` : ` ${fmt.num(ctx.parsed.y)} uds`,
        }},
      },
      scales: {
        x: CHART_DEFAULTS.scaleX,
        y: { ...CHART_DEFAULTS.scaleY, ticks: { color: '#7b7f94',
          callback: v => isV ? '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':(v/1e3).toFixed(0)+'k') : fmt.num(v) } },
      },
    },
  });
}

function renderEvolucionCat(data) {
  // Top 6 categorías por ventas totales, evolución mensual
  const isV   = state.metric === 'ventas';
  const items = data.pareto.items;
  const evo   = data.evolucion;

  // Agrupar por categoría desde los items del pareto
  const catMap = {};
  items.forEach(item => {
    if (!catMap[item.categoria]) catMap[item.categoria] = { ventas: 0, cantidad: 0 };
    catMap[item.categoria].ventas   += item.ventas;
    catMap[item.categoria].cantidad += item.cantidad;
  });
  // Top 6 categorías
  const top6 = Object.entries(catMap).sort((a,b) => b[1].ventas - a[1].ventas).slice(0,6).map(([n]) => n);

  // Para la evolución por categoría necesitamos los datos raw — usamos los datos del summary
  // Simplificación: mostramos la evolución total con área coloreada por el top 6
  // En vez de eso mostramos barras apiladas si tenemos los datos
  upsertChart('chart-evolucion-cat', {
    type: 'bar',
    data: {
      labels: evo.labels,
      datasets: [{
        label: isV ? 'Total ventas' : 'Total unidades',
        data: isV ? evo.ventas : evo.cantidad,
        backgroundColor: '#2b5ead88',
        borderColor: '#4a9eff',
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: ctx => isV ? ` ${fmt.pesosFull(ctx.parsed.y)}` : ` ${fmt.num(ctx.parsed.y)} uds`,
        }},
      },
      scales: {
        x: CHART_DEFAULTS.scaleX,
        y: { ...CHART_DEFAULTS.scaleY, ticks: { color: '#7b7f94',
          callback: v => isV ? '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':(v/1e3).toFixed(0)+'k') : fmt.num(v) } },
      },
    },
  });
}

// ── CATEGORÍAS ─────────────────────────────────────────────────────────────

function renderCatBar(cats) {
  const isV  = state.metric === 'ventas';
  const top  = cats.slice(0, 12);
  const colors = top.map((_, i) => CAT_PALETTE[i % CAT_PALETTE.length]);

  upsertChart('chart-cat-bar', {
    type: 'bar',
    data: {
      labels: top.map(c => c.nombre.replace(/^\d+\s+/,'')),
      datasets: [{
        label: isV ? 'Ventas $' : 'Cantidad',
        data: top.map(c => isV ? c.ventas : c.cantidad),
        backgroundColor: colors,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: ctx => isV ? ` ${fmt.pesosFull(ctx.parsed.x)}` : ` ${fmt.num(ctx.parsed.x)} uds`,
        }},
      },
      scales: {
        x: { ...CHART_DEFAULTS.scaleY, ticks: { color: '#7b7f94',
          callback: v => isV ? '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':(v/1e3).toFixed(0)+'k') : fmt.num(v) } },
        y: { grid: { color: '#e8e3db' }, ticks: { color: '#7a7060', font: { size: 11 } } },
      },
    },
  });
}

function renderCatTable(cats) {
  const isV = state.metric === 'ventas';
  document.getElementById('cat-tbody').innerHTML = cats.map(c => `
    <tr>
      <td style="text-align:left;color:var(--text)">${c.nombre}</td>
      <td>${c.items}</td>
      <td>${fmt.pesosFull(c.ventas)}</td>
      <td>${fmt.num(c.cantidad)}</td>
      <td>${fmt.pct(c.pct)}</td>
      <td>${c.ventas > 0 && c.cantidad > 0 ? fmt.pesosFull(Math.round(c.ventas/c.cantidad)) : '—'}</td>
    </tr>
  `).join('');

  // Populate table cat filter
  const sel = document.getElementById('filter-cat');
  const cur = state.tableCat;
  sel.innerHTML = '<option value="all">Todas las categorías</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.nombre; opt.textContent = c.nombre;
    sel.appendChild(opt);
  });
  if (cats.find(c => c.nombre === cur)) sel.value = cur;
}

// ── TABLA ──────────────────────────────────────────────────────────────────

function renderTable() {
  const search   = state.search.toLowerCase();
  const filtered = allItems.filter(item => {
    if (state.clase    !== 'all' && item.clase      !== state.clase)    return false;
    if (state.tableCat !== 'all' && item.categoria  !== state.tableCat) return false;
    if (search && !item.producto.toLowerCase().includes(search) &&
        !item.categoria.toLowerCase().includes(search)) return false;
    return true;
  });

  const dir    = state.sortDir === 'asc' ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    const va = state.sortCol === 'rank' ? a._rank : a[state.sortCol];
    const vb = state.sortCol === 'rank' ? b._rank : b[state.sortCol];
    if (typeof va === 'string') return dir * va.localeCompare(vb);
    return dir * ((va ?? 0) - (vb ?? 0));
  });

  const tbody = document.getElementById('items-tbody');
  tbody.innerHTML = sorted.length === 0
    ? `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--muted)">Sin resultados</td></tr>`
    : sorted.map((item, idx) => `
      <tr>
        <td style="color:var(--muted);font-size:0.75rem">${idx+1}</td>
        <td style="text-align:left;color:var(--text)">${item.producto}</td>
        <td style="text-align:left"><span class="cat-tag">${item.categoria.replace(/^\d+\s+/,'')}</span></td>
        <td>${fmt.pesosFull(item.ventas)}</td>
        <td>${fmt.num(item.cantidad)}</td>
        <td>${fmt.pesosFull(item.precioPromedio)}</td>
        <td>${fmt.pct(item.pct)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:5px">
            <div style="flex:1;height:3px;background:var(--border);border-radius:2px">
              <div style="height:100%;width:${Math.min(item.pctCum,100)}%;background:${item.pctCum<=70?'#38d9a9':item.pctCum<=90?'#f5a623':'#e03c5a'};border-radius:2px"></div>
            </div>
            <span style="font-size:0.7rem;color:var(--muted)">${fmt.pct(item.pctCum)}</span>
          </div>
        </td>
        <td><span class="badge-inline ${item.clase.toLowerCase()}">${item.clase}</span></td>
      </tr>
    `).join('');

  document.querySelectorAll('#items-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.col === state.sortCol) th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

document.querySelectorAll('#items-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (state.sortCol === th.dataset.col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortCol = th.dataset.col; state.sortDir = th.dataset.col === 'rank' ? 'asc' : 'desc'; }
    renderTable();
  });
});
document.getElementById('search-item').addEventListener('input',  e => { state.search   = e.target.value; renderTable(); });
document.getElementById('filter-clase').addEventListener('change', e => { state.clase    = e.target.value; renderTable(); });
document.getElementById('filter-cat').addEventListener('change',   e => { state.tableCat = e.target.value; renderTable(); });

// ── MATRIZ BCG ─────────────────────────────────────────────────────────────

const BCG_CONFIG = {
  Estrella:     { color: '#3b82f6', bg: 'rgba(59,130,246,0.07)',  icon: '★', desc: 'Alta participación + crecimiento. Potenciar.' },
  Vaca:         { color: '#c8a84b', bg: 'rgba(200,168,75,0.07)',  icon: '◆', desc: 'Alta participación + estable. Mantener.' },
  Interrogante: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.07)', icon: '?', desc: 'Baja participación + crecimiento. Decidir.' },
  Perro:        { color: '#94a3b8', bg: 'rgba(148,163,184,0.07)',icon: '✕', desc: 'Baja participación + declive. Revisar.' },
};

// Plugin que pinta los fondos de los cuadrantes antes de dibujar los datos
const bcgQuadrantPlugin = {
  id: 'bcgQuadrants',
  beforeDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.x || !scales.y) return;
    const { left, right, top, bottom } = chartArea;

    const xMid = scales.x.getPixelForValue(15);   // 15% = umbral share
    const yMid = scales.y.getPixelForValue(0);    // 0% = umbral crecimiento

    const xMidClamped = Math.max(left, Math.min(right, xMid));
    const yMidClamped = Math.max(top,  Math.min(bottom, yMid));

    const quads = [
      { color: BCG_CONFIG.Interrogante.bg, x: left,        y: top,         w: xMidClamped - left,   h: yMidClamped - top,    label: 'Interrogante', lx: left + 8,        ly: top + 14 },
      { color: BCG_CONFIG.Estrella.bg,     x: xMidClamped, y: top,         w: right - xMidClamped,  h: yMidClamped - top,    label: 'Estrella',     lx: right - 8,       ly: top + 14,      anchor: 'right' },
      { color: BCG_CONFIG.Perro.bg,        x: left,        y: yMidClamped, w: xMidClamped - left,   h: bottom - yMidClamped, label: 'Perro',        lx: left + 8,        ly: bottom - 8 },
      { color: BCG_CONFIG.Vaca.bg,         x: xMidClamped, y: yMidClamped, w: right - xMidClamped,  h: bottom - yMidClamped, label: 'Vaca',         lx: right - 8,       ly: bottom - 8,    anchor: 'right' },
    ];

    ctx.save();
    quads.forEach(q => {
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x, q.y, q.w, q.h);

      // Etiqueta del cuadrante
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.textAlign = q.anchor === 'right' ? 'right' : 'left';
      ctx.textBaseline = q.ly < yMidClamped ? 'top' : 'bottom';
      ctx.fillText(q.label.toUpperCase(), q.lx, q.ly);
    });

    // Líneas divisorias
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xMidClamped, top);
    ctx.lineTo(xMidClamped, bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(left, yMidClamped);
    ctx.lineTo(right, yMidClamped);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },
};

function renderBCG(data) {
  const bcgItems = data.bcgData && data.bcgData.length > 0
    ? data.bcgData
    : [];

  if (bcgItems.length === 0) {
    document.getElementById('bcg-cards').innerHTML =
      '<p style="color:var(--muted);grid-column:1/-1;text-align:center;padding:24px">No hay suficientes datos para la matriz BCG (se necesitan al menos 2 años).</p>';
    return;
  }

  const totalVentas = bcgItems.reduce((s, i) => s + i.ventas, 0) || 1;

  const datasets = ['Estrella','Vaca','Interrogante','Perro'].map(q => {
    const qItems = bcgItems.filter(i => i.cuadrante === q);
    return {
      label: q,
      data: qItems.map(i => ({
        x: parseFloat(i.relShare.toFixed(1)),
        y: parseFloat(i.growth.toFixed(1)),
        r: Math.max(5, Math.min(22, (i.ventas / totalVentas) * 500)),
        producto: i.producto,
        ventas:   i.ventas,
        growth:   i.growth,
      })),
      backgroundColor: BCG_CONFIG[q].color + 'bb',
      borderColor:     BCG_CONFIG[q].color,
      borderWidth: 1,
    };
  });

  // Calcular rango dinámico de los ejes
  const allX = bcgItems.map(i => i.relShare);
  const allY = bcgItems.map(i => i.growth);
  const xMax = Math.min(100, Math.ceil((Math.max(...allX) * 1.15) / 10) * 10 || 100);
  const yAbsMax = Math.ceil((Math.max(Math.abs(Math.min(...allY)), Math.abs(Math.max(...allY))) * 1.2) / 10) * 10 || 50;

  // Destruir y recrear el chart con el plugin (upsertChart no soporta plugins nuevos)
  if (charts['chart-bcg']) {
    charts['chart-bcg'].destroy();
    delete charts['chart-bcg'];
  }
  charts['chart-bcg'] = new Chart(
    document.getElementById('chart-bcg').getContext('2d'),
    {
      type: 'bubble',
      plugins: [bcgQuadrantPlugin],
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: CHART_DEFAULTS.legend('bottom'),
          tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
            label: ctx => {
              const d = ctx.raw;
              return [
                `  ${d.producto}`,
                `  Participación: ${d.x.toFixed(1)}%`,
                `  Crecimiento YoY: ${d.growth >= 0 ? '+' : ''}${d.growth.toFixed(1)}%`,
                `  Ventas: ${fmt.pesos(d.ventas)}`,
              ];
            },
          }},
        },
        scales: {
          x: {
            min: 0, max: xMax,
            title: { display: true, text: 'Participación relativa (%)', color: '#7a7060', font: { size: 11 } },
            grid: { color: '#e8e3db' },
            ticks: { color: '#7a7060', callback: v => v + '%' },
          },
          y: {
            min: -yAbsMax, max: yAbsMax,
            title: { display: true, text: 'Crecimiento año a año (%)', color: '#7a7060', font: { size: 11 } },
            grid: { color: '#e8e3db' },
            ticks: { color: '#7a7060', callback: v => (v >= 0 ? '+' : '') + v + '%' },
          },
        },
      },
    }
  );

  // BCG cards por cuadrante
  document.getElementById('bcg-cards').innerHTML = ['Estrella','Vaca','Interrogante','Perro'].map(q => {
    const cfg   = BCG_CONFIG[q];
    const items = bcgItems.filter(i => i.cuadrante === q).slice(0, 8);
    const total = bcgItems.filter(i => i.cuadrante === q).length;
    return `
      <div class="bcg-card">
        <div class="bcg-card-header">
          <div class="bcg-icon" style="background:${cfg.color}22;color:${cfg.color}">${cfg.icon}</div>
          <div>
            <div class="bcg-card-title" style="color:${cfg.color}">${q} <span style="font-size:0.75rem;font-weight:400;color:var(--muted)">(${total})</span></div>
            <div class="bcg-card-sub">${cfg.desc}</div>
          </div>
        </div>
        <div class="bcg-items">
          ${items.map(i => `
            <div class="bcg-item">
              <span class="bcg-item-name" title="${i.producto}">${i.producto}</span>
              <span class="bcg-item-val">${fmt.pesos(i.ventas)}</span>
            </div>
          `).join('')}
          ${total > 8
            ? `<div style="font-size:0.7rem;color:var(--muted);text-align:center;padding:4px">+${total - 8} más</div>`
            : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ── SEGUIMIENTO ────────────────────────────────────────────────────────────

function saveSegList() {
  localStorage.setItem(SEG_KEY, JSON.stringify(segList));
}

function renderSegChips() {
  const container = document.getElementById('seg-chips');
  container.innerHTML = segList.map((name, i) => `
    <div class="seg-chip">
      <span>${name}</span>
      <button class="seg-chip-remove" data-idx="${i}" title="Quitar">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('.seg-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      segList.splice(Number(btn.dataset.idx), 1);
      saveSegList();
      renderSegChips();
      loadSeguimiento();
    });
  });
}

function initSegSearch() {
  const input       = document.getElementById('seg-input');
  const suggestions = document.getElementById('seg-suggestions');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { suggestions.classList.remove('open'); return; }

    const matches = catalog.productos
      .filter(p => p.producto.toLowerCase().includes(q))
      .slice(0, 12);

    if (matches.length === 0) { suggestions.classList.remove('open'); return; }

    suggestions.innerHTML = matches.map(p => {
      const already = segList.includes(p.producto);
      return `
        <div class="seg-sug-item${already ? ' seg-sug-already' : ''}" data-prod="${p.producto}" data-cat="${p.categoria || ''}">
          <span class="seg-sug-name">${p.producto}</span>
          <span class="seg-sug-cat">${p.categoria || ''}</span>
          <span class="seg-sug-add">${already ? '✓ ya agregado' : '+ Agregar'}</span>
        </div>`;
    }).join('');
    suggestions.classList.add('open');

    suggestions.querySelectorAll('.seg-sug-item:not(.seg-sug-already)').forEach(el => {
      el.addEventListener('click', () => {
        const prod = el.dataset.prod;
        if (!segList.includes(prod)) {
          segList.push(prod);
          saveSegList();
          renderSegChips();
          loadSeguimiento();
        }
        input.value = '';
        suggestions.classList.remove('open');
      });
    });
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !suggestions.contains(e.target)) {
      suggestions.classList.remove('open');
    }
  });
}

async function loadSeguimiento() {
  const grid    = document.getElementById('seg-grid');
  const empty   = document.getElementById('seg-empty');
  const combCard = document.getElementById('seg-combined-card');

  if (segList.length === 0) {
    grid.innerHTML = '';
    combCard.style.display = 'none';
    empty.style.display    = '';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;padding:8px">Cargando…</p>';

  try {
    const params = new URLSearchParams({ productos: segList.join(',') });
    const data   = await fetch(`/api/seguimiento?${params}`).then(r => r.json());
    if (data.error) throw new Error(data.error);

    renderSegCards(data);
    renderSegCombined(data);
    combCard.style.display = segList.length > 1 ? '' : 'none';
  } catch (err) {
    grid.innerHTML = `<p style="color:#e03c5a;padding:8px">Error: ${err.message}</p>`;
  }
}

function renderSegCards(data) {
  const grid  = document.getElementById('seg-grid');
  const isV   = state.metric === 'ventas';
  const prods = Object.entries(data.productos);

  if (prods.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;padding:8px">Sin datos para los productos seleccionados.</p>';
    return;
  }

  // Destruir sparkline charts anteriores
  Object.keys(charts).filter(k => k.startsWith('seg-spark-')).forEach(k => {
    charts[k].destroy(); delete charts[k];
  });

  grid.innerHTML = prods.map(([prod, d], i) => {
    const color = SEG_PALETTE[i % SEG_PALETTE.length];
    const trend = d.trendVentas;
    let trendClass = 'flat', trendIcon = '→', trendTxt = 'Sin comparación';
    if (trend !== null) {
      if (trend > 1)       { trendClass = 'up';   trendIcon = '↑'; trendTxt = `+${trend.toFixed(1)}%`; }
      else if (trend < -1) { trendClass = 'down'; trendIcon = '↓'; trendTxt = `${trend.toFixed(1)}%`; }
      else                  { trendTxt = 'Estable'; }
    }
    return `
      <div class="seg-card">
        <div class="seg-card-header">
          <div>
            <div class="seg-card-name">${prod}</div>
          </div>
          <div class="seg-card-badge" style="background:${color}"></div>
        </div>
        <div class="seg-kpis">
          <div class="seg-kpi">
            <span class="seg-kpi-label">Ventas totales</span>
            <span class="seg-kpi-val">${fmt.pesos(d.totalVentas)}</span>
          </div>
          <div class="seg-kpi">
            <span class="seg-kpi-label">Unidades</span>
            <span class="seg-kpi-val">${fmt.num(d.totalCantidad)}</span>
          </div>
          ${d.precioPromedio ? `<div class="seg-kpi">
            <span class="seg-kpi-label">Precio prom.</span>
            <span class="seg-kpi-val">${fmt.pesosFull(d.precioPromedio)}</span>
          </div>` : ''}
        </div>
        <div class="seg-trend ${trendClass}">${trendIcon} ${trendTxt} <span style="font-weight:400;opacity:0.7;font-size:0.68rem">vs 3m ant.</span></div>
        <div class="seg-sparkline"><canvas id="seg-spark-${i}"></canvas></div>
      </div>`;
  }).join('');

  // Dibujar sparklines
  prods.forEach(([prod, d], i) => {
    const color  = SEG_PALETTE[i % SEG_PALETTE.length];
    const values = isV ? d.ventas : d.cantidad;
    const ctx    = document.getElementById(`seg-spark-${i}`);
    if (!ctx) return;
    charts[`seg-spark-${i}`] = new Chart(ctx.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{
          data: values, borderColor: color,
          backgroundColor: color + '18',
          borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          ...CHART_DEFAULTS.tooltip,
          callbacks: { label: ctx => isV ? ` ${fmt.pesos(ctx.parsed.y)}` : ` ${fmt.num(ctx.parsed.y)} uds` },
        }},
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
  });
}

function renderSegCombined(data) {
  const isV    = state.metric === 'ventas';
  const prods  = Object.entries(data.productos);
  const datasets = prods.map(([prod, d], i) => ({
    label: prod,
    data:  isV ? d.ventas : d.cantidad,
    borderColor:     SEG_PALETTE[i % SEG_PALETTE.length],
    backgroundColor: SEG_PALETTE[i % SEG_PALETTE.length] + '15',
    borderWidth: 2, tension: 0.35, pointRadius: 3, fill: false,
  }));

  if (charts['chart-seguimiento']) {
    charts['chart-seguimiento'].destroy();
    delete charts['chart-seguimiento'];
  }
  if (datasets.length === 0) return;

  charts['chart-seguimiento'] = new Chart(
    document.getElementById('chart-seguimiento').getContext('2d'),
    {
      type: 'line',
      data: { labels: data.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: CHART_DEFAULTS.legend('bottom'),
          tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
            label: ctx => isV
              ? ` ${ctx.dataset.label}: ${fmt.pesosFull(ctx.parsed.y)}`
              : ` ${ctx.dataset.label}: ${fmt.num(ctx.parsed.y)} uds`,
          }},
        },
        scales: {
          x: CHART_DEFAULTS.scaleX,
          y: { ...CHART_DEFAULTS.scaleY, ticks: { color: '#7a7060',
            callback: v => isV ? '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':(v/1e3).toFixed(0)+'k') : fmt.num(v) } },
        },
      },
    }
  );
}

// ── Render completo ────────────────────────────────────────────────────────

function renderAll(data) {
  rawData = data;

  // Catálogo (solo la primera vez o en refresh total)
  if (!state._catalogReady && data.catalog) {
    populateCatalog(data.catalog);
    state._catalogReady = true;
  }

  // Dashboard
  renderSummary(data.summary);
  renderPareto(data.pareto);
  renderDonut(data.categorias, 'chart-donut', 'cat-legend');
  renderABCCards(data.pareto);

  // Evolución
  renderEvolucion(data.evolucion);
  renderEvolucionCat(data);

  // Categorías
  renderDonut(data.categorias, 'chart-donut2', null);
  renderCatBar(data.categorias);
  renderCatTable(data.categorias);

  // Tabla
  allItems = data.pareto.items.map((item, i) => ({ ...item, _rank: i+1 }));
  renderTable();

  // BCG
  renderBCG(data);

  // Timestamp
  const now = new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
  document.getElementById('last-update').textContent = `Act. ${now}`;
}

// ── Carga de datos ─────────────────────────────────────────────────────────

async function loadData({ forceFlush = false } = {}) {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('spinning');
  setRefreshStatus('loading');
  try {
    if (forceFlush) {
      await fetch('/api/refresh', { method: 'POST' });
      state._catalogReady = false;
    }

    const params = new URLSearchParams({ metric: state.metric });
    if (!state.anos.includes('all'))       params.set('anos',       state.anos.join(','));
    if (!state.meses.includes('all'))      params.set('meses',      state.meses.join(','));
    if (!state.categorias.includes('all')) params.set('categorias', state.categorias.join(','));
    if (!state.productos.includes('all'))  params.set('productos',  state.productos.join(','));

    const data = await fetch(`/api/carta?${params}`).then(r => r.json());
    if (data.error) throw new Error(data.error);
    renderAll(data);
    setRefreshStatus('ok');
  } catch (err) {
    console.error(err);
    setRefreshStatus('error');
    showToast('Error al cargar datos: ' + err.message);
  } finally {
    btn.classList.remove('spinning');
  }
}

document.getElementById('btn-refresh').addEventListener('click', () => {
  showToast('Forzando actualización desde Google Sheets…', 2000);
  loadData({ forceFlush: true });
});

// Cuando el usuario navega a Seguimiento, recargar si hay productos
document.querySelectorAll('.nav-item').forEach(item => {
  if (item.dataset.section === 'seguimiento') {
    item.addEventListener('click', () => { if (segList.length > 0) loadSeguimiento(); }, { capture: true });
  }
});

// Iniciar
initFilters();
renderSegChips();
initSegSearch();
_startAutoRefresh();   // auto-refresh cada 60s
loadData();
