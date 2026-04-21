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
      // En mobile: posicionar el panel fijo anclado debajo del botón
      if (window.innerWidth <= 960) {
        const rect = this.btn.getBoundingClientRect();
        this.panel.style.top  = (rect.bottom + 6) + 'px';
        this.panel.style.left = '10px';
        this.panel.style.right = '10px';
        this.panel.style.width = 'auto';
      } else {
        this.panel.style.top  = '';
        this.panel.style.left = '';
        this.panel.style.right = '';
        this.panel.style.width = '';
      }
      if (this._searchInput) setTimeout(() => this._searchInput.focus(), 50);
    }
  }

  _close() { this.panel.classList.remove('open'); }
}

// Instancias
let msAno, msMes, msCat, msProd;

// ── Filter panel toggle (mobile/tablet) ────────────────────────────────────
function initFilterToggle() {
  const btn   = document.getElementById('btn-filter-toggle');
  const panel = document.getElementById('filter-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open', !isOpen);
    btn.classList.toggle('active', !isOpen);
  });

  // Cerrar el panel al hacer click fuera
  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && !btn.contains(e.target)) {
      panel.classList.remove('open');
      btn.classList.remove('active');
    }
  });
}

// Actualiza el badge de filtros activos en el botón
function updateFilterBadge() {
  const badge = document.getElementById('filter-count-badge');
  if (!badge) return;
  let count = 0;
  if (!state.anos.includes('all'))       count++;
  if (!state.meses.includes('all'))      count++;
  if (!state.categorias.includes('all')) count++;
  if (!state.productos.includes('all'))  count++;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

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
let _autoRefresh   = null;   // interval del auto-refresh
let _nextRefreshAt = null;   // Date de la próxima actualización automática

const AUTO_REFRESH_MS = 10 * 60 * 1000;  // 10 minutos

function _fmtTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function setRefreshStatus(state) {
  const el = document.getElementById('refresh-status');
  if (!el) return;
  el.className = 'refresh-status';
  if (state === 'loading') {
    el.textContent = 'Actualizando…';
  } else if (state === 'ok') {
    _nextRefreshAt = new Date(Date.now() + AUTO_REFRESH_MS);
    el.classList.add('ok');
    el.textContent = `✓ Actualizado · próximo ${_fmtTime(_nextRefreshAt)}`;
  } else if (state === 'error') {
    el.textContent = 'Error al cargar';
  }
}

function _startAutoRefresh() {
  if (_autoRefresh) clearInterval(_autoRefresh);
  _autoRefresh = setInterval(() => loadData(), AUTO_REFRESH_MS);
}

// ── Sidebar navigation ─────────────────────────────────────────────────────
const SECTION_TITLES = {
  dashboard:   'Dashboard Carta',
  tabla:       'Tabla de items',
  bcg:         'Matriz BCG',
  inflacion:   'Inflación Carta',
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
    onChange: vals => { state.anos = vals; updateFilterBadge(); loadData(); },
  });
  msMes = new MultiSelect({
    container: document.getElementById('ms-mes'),
    label: 'Mes',
    onChange: vals => { state.meses = vals; updateFilterBadge(); loadData(); },
  });
  msCat = new MultiSelect({
    container: document.getElementById('ms-cat'),
    label: 'Categoría',
    searchable: true,
    onChange: vals => {
      state.categorias = vals;
      _refreshProductOptions();
      updateFilterBadge();
      loadData();
    },
  });
  msProd = new MultiSelect({
    container: document.getElementById('ms-prod'),
    label: 'Producto',
    searchable: true,
    onChange: vals => { state.productos = vals; updateFilterBadge(); loadData(); },
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

// ── Helper: gradiente canvas ───────────────────────────────────────────────
function canvasGradient(canvasId, stops) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return stops[0][1];
  const ctx = canvas.getContext('2d');
  const h = canvas.parentElement?.offsetHeight || 280;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach(([pos, color]) => g.addColorStop(pos, color));
  return g;
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────

function renderSummary(s) {
  const isV = state.metric === 'ventas';
  document.getElementById('summary-grid').innerHTML = `
    <div class="summary-card">
      <div class="s-label">${isV ? 'Ventas totales' : 'Unidades vendidas'}</div>
      <div class="s-value">${isV ? fmt.pesosFull(s.totalVentas) : fmt.num(s.totalCantidad)}</div>
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
  const labels  = items.map(i => i.producto.length > 18 ? i.producto.slice(0,16)+'…' : i.producto);
  const valores = items.map(i => state.metric === 'cantidad' ? i.cantidad : i.ventas);
  const isV     = state.metric === 'ventas';

  // Colores por clase: A=verde esmeralda, B=dorado, C=azul apagado
  const CLASE_BAR = { A: '#38d9a9', B: '#c8a84b', C: '#6e8faf' };

  upsertChart('chart-pareto', {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: isV ? 'Ventas $' : 'Cantidad',
          data: valores,
          backgroundColor: items.map(i => CLASE_BAR[i.clase] + 'dd'),
          borderColor:     items.map(i => CLASE_BAR[i.clase]),
          borderWidth: 0,
          borderRadius: { topLeft: 5, topRight: 5 },
          borderSkipped: 'bottom',
          yAxisID: 'yBar', order: 2,
        },
        {
          type: 'line', label: '% Acumulado',
          data: items.map(i => i.pctCum),
          borderColor: '#c8a84b',
          backgroundColor: 'rgba(200,168,75,0.08)',
          borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#c8a84b',
          tension: 0.35, yAxisID: 'yLine', order: 1, fill: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: true, aspectRatio: 2.6,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: CHART_DEFAULTS.legend(),
        tooltip: {
          ...CHART_DEFAULTS.tooltip,
          callbacks: {
            title: (ctx) => ctx[0]?.label || '',
            label: ctx => ctx.dataset.yAxisID === 'yLine'
              ? ` Acum: ${ctx.parsed.y.toFixed(1)}%`
              : isV ? ` ${fmt.pesosFull(ctx.parsed.y)}` : ` ${fmt.num(ctx.parsed.y)} uds`,
          },
        },
      },
      scales: {
        x: {
          ...CHART_DEFAULTS.scaleX,
          ticks: { color: '#7a7060', maxRotation: 50, font: { size: 10 } },
        },
        yBar: {
          ...CHART_DEFAULTS.scaleY,
          position: 'left',
          ticks: { color: '#7b7f94',
            callback: v => isV ? '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':(v>=1e3?(v/1e3).toFixed(0)+'k':v)) : fmt.num(v),
          },
        },
        yLine: {
          position: 'right', grid: { drawOnChartArea: false }, min: 0, max: 100,
          ticks: { color: '#c8a84b', callback: v => v+'%', font: { size: 10 } },
        },
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
      responsive: true, maintainAspectRatio: true, aspectRatio: 1.7, cutout: '62%',
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
  const grad = canvasGradient('chart-evolucion', [
    [0,   'rgba(74,158,255,0.28)'],
    [0.6, 'rgba(74,158,255,0.06)'],
    [1,   'rgba(74,158,255,0.00)'],
  ]);

  upsertChart('chart-evolucion', {
    type: 'line',
    data: {
      labels: evo.labels,
      datasets: [{
        label: isV ? 'Ventas $' : 'Cantidad',
        data: isV ? evo.ventas : evo.cantidad,
        borderColor: '#4a9eff',
        backgroundColor: grad,
        borderWidth: 2.5,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#4a9eff',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
        fill: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: true, aspectRatio: 3,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: ctx => isV ? ` ${fmt.pesosFull(ctx.parsed.y)}` : ` ${fmt.num(ctx.parsed.y)} uds`,
        }},
      },
      scales: {
        x: CHART_DEFAULTS.scaleX,
        y: {
          ...CHART_DEFAULTS.scaleY,
          ticks: { color: '#7b7f94',
            callback: v => isV ? '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':(v>=1e3?(v/1e3).toFixed(0)+'k':v)) : fmt.num(v),
          },
        },
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
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor:     colors,
        borderWidth: 0,
        borderRadius: { topRight: 5, bottomRight: 5 },
        borderSkipped: 'left',
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: true, aspectRatio: 1.8,
      plugins: {
        legend: { display: false },
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: ctx => isV ? ` ${fmt.pesosFull(ctx.parsed.x)}` : ` ${fmt.num(ctx.parsed.x)} uds`,
        }},
      },
      scales: {
        x: {
          ...CHART_DEFAULTS.scaleY,
          ticks: { color: '#7b7f94',
            callback: v => isV ? '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':(v>=1e3?(v/1e3).toFixed(0)+'k':v)) : fmt.num(v),
          },
        },
        y: { grid: { display: false }, ticks: { color: '#7a7060', font: { size: 11 } } },
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

// ── TOP 10 / TOP 11-20 (Dashboard) ────────────────────────────────────────

function renderDashTopTables(items) {
  const isV = state.metric === 'ventas';

  function buildRows(slice, startRank) {
    if (!slice.length) return `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">Sin datos</td></tr>`;
    return slice.map((item, i) => {
      const rank = startRank + i;
      const rankColor = rank === 1 ? '#c8a84b' : rank <= 3 ? '#4a9eff' : 'var(--muted)';
      return `
        <tr>
          <td style="text-align:center;font-weight:700;color:${rankColor};font-size:0.78rem">${rank}</td>
          <td style="text-align:left;color:var(--text);font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.producto}</td>
          <td style="text-align:left"><span class="cat-tag">${(item.categoria||'').replace(/^\d+\s+/,'')}</span></td>
          <td>${isV ? fmt.pesosFull(item.ventas) : fmt.num(item.cantidad)}</td>
          <td style="color:var(--muted)">${fmt.num(item.cantidad)}</td>
          <td>${fmt.pct(item.pct)}</td>
          <td><span class="badge-inline ${(item.clase||'c').toLowerCase()}">${item.clase||'C'}</span></td>
        </tr>`;
    }).join('');
  }

  const t1 = document.getElementById('top10-tbody');
  const t2 = document.getElementById('top20-tbody');
  const h1 = document.querySelector('#top10-table thead tr');
  const h2 = document.querySelector('#top20-table thead tr');

  // Actualizar encabezado de columna según métrica
  const valHeader = isV ? 'Ventas $' : 'Cant.';
  [h1, h2].forEach(h => { if (h) h.cells[3].textContent = valHeader; });

  if (t1) t1.innerHTML = buildRows(items.slice(0, 10), 1);
  if (t2) t2.innerHTML = buildRows(items.slice(10, 20), 11);
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

  const tbody   = document.getElementById('items-tbody');
  const isMobile = window.innerWidth <= 640;

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--muted)">Sin resultados</td></tr>`;
    return;
  }

  if (isMobile) {
    // ── Vista card en mobile ──────────────────────────────────────────────
    tbody.innerHTML = sorted.map((item, idx) => {
      const acumColor = item.pctCum <= 70 ? '#38d9a9' : item.pctCum <= 90 ? '#f5a623' : '#e03c5a';
      return `
        <tr class="item-row-card">
          <td colspan="9">
            <div class="item-card">
              <div class="item-card-top">
                <div class="item-card-rank">${idx + 1}</div>
                <div class="item-card-name">${item.producto}</div>
                <span class="badge-inline ${item.clase.toLowerCase()}">${item.clase}</span>
              </div>
              <div class="item-card-cat"><span class="cat-tag">${item.categoria.replace(/^\d+\s+/, '')}</span></div>
              <div class="item-card-stats">
                <div class="item-card-stat">
                  <span class="item-stat-label">Ventas</span>
                  <span class="item-stat-val">${fmt.pesos(item.ventas)}</span>
                </div>
                <div class="item-card-stat">
                  <span class="item-stat-label">Unidades</span>
                  <span class="item-stat-val">${fmt.num(item.cantidad)}</span>
                </div>
                <div class="item-card-stat">
                  <span class="item-stat-label">Precio</span>
                  <span class="item-stat-val">${fmt.pesos(item.precioPromedio)}</span>
                </div>
                <div class="item-card-stat">
                  <span class="item-stat-label">% total</span>
                  <span class="item-stat-val">${fmt.pct(item.pct)}</span>
                </div>
              </div>
              <div class="item-card-bar">
                <div class="item-bar-track">
                  <div class="item-bar-fill" style="width:${Math.min(item.pctCum,100)}%;background:${acumColor}"></div>
                </div>
                <span class="item-bar-label">Acum. ${fmt.pct(item.pctCum)}</span>
              </div>
            </div>
          </td>
        </tr>`;
    }).join('');
  } else {
    // ── Vista tabla normal ────────────────────────────────────────────────
    tbody.innerHTML = sorted.map((item, idx) => `
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
  }

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

// Re-render tabla si cambia orientación/tamaño (card ↔ tabla)
let _lastMobileTable = window.innerWidth <= 640;
window.addEventListener('resize', () => {
  const nowMobile = window.innerWidth <= 640;
  if (nowMobile !== _lastMobileTable) { _lastMobileTable = nowMobile; renderTable(); }
});

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
  const bcgItems = data.bcgData && data.bcgData.length > 0 ? data.bcgData : [];

  if (bcgItems.length === 0) {
    document.getElementById('bcg-cards').innerHTML =
      '<p style="color:var(--muted);grid-column:1/-1;text-align:center;padding:24px">Sin datos suficientes.</p>';
    return;
  }

  // Umbral X = participación promedio (dinámico, viene del backend)
  const avgShare = bcgItems[0]?.avgShare ?? (100 / bcgItems.length);
  const totalVentas = bcgItems.reduce((s, i) => s + i.ventas, 0) || 1;
  const noYoY = bcgItems.every(i => !i.hasYoY);

  // Rango dinámico de ejes
  const allX = bcgItems.map(i => i.pctShare);
  const allY = bcgItems.map(i => i.growth);
  const xMax = Math.ceil((Math.max(...allX) * 1.2) / 1 ) || 20;
  const yAbsMax = Math.ceil(Math.max(Math.abs(Math.min(...allY)), Math.abs(Math.max(...allY))) * 1.2 / 10) * 10 || 50;

  const datasets = ['Estrella','Vaca','Interrogante','Perro'].map(q => {
    const qItems = bcgItems.filter(i => i.cuadrante === q);
    return {
      label: q,
      data: qItems.map(i => ({
        x:        parseFloat(i.pctShare.toFixed(2)),
        y:        parseFloat(i.growth.toFixed(1)),
        r:        Math.max(5, Math.min(24, (i.ventas / totalVentas) * 600)),
        producto: i.producto,
        ventas:   i.ventas,
        growth:   i.growth,
        hasYoY:   i.hasYoY,
        pctShare: i.pctShare,
      })),
      backgroundColor: BCG_CONFIG[q].color + 'bb',
      borderColor:     BCG_CONFIG[q].color,
      borderWidth: 1,
    };
  });

  // Plugin cuadrantes — usa avgShare como umbral X, 0% como umbral Y
  const bcgQPlugin = {
    id: 'bcgQuadrants',
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x || !scales.y) return;
      const { left, right, top, bottom } = chartArea;

      const xMid = Math.max(left,  Math.min(right,  scales.x.getPixelForValue(avgShare)));
      const yMid = Math.max(top,   Math.min(bottom, scales.y.getPixelForValue(0)));

      const quads = [
        { color: BCG_CONFIG.Interrogante.bg, x: left,  y: top,  w: xMid-left,  h: yMid-top,    label: 'Interrogante', lx: left+8,    ly: top+14,    anchor:'left',  baseline:'top' },
        { color: BCG_CONFIG.Estrella.bg,     x: xMid,  y: top,  w: right-xMid, h: yMid-top,    label: 'Estrella',     lx: right-8,   ly: top+14,    anchor:'right', baseline:'top' },
        { color: BCG_CONFIG.Perro.bg,        x: left,  y: yMid, w: xMid-left,  h: bottom-yMid, label: 'Perro',        lx: left+8,    ly: bottom-8,  anchor:'left',  baseline:'bottom' },
        { color: BCG_CONFIG.Vaca.bg,         x: xMid,  y: yMid, w: right-xMid, h: bottom-yMid, label: 'Vaca',         lx: right-8,   ly: bottom-8,  anchor:'right', baseline:'bottom' },
      ];

      ctx.save();
      quads.forEach(q => {
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x, q.y, q.w, q.h);
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.textAlign    = q.anchor;
        ctx.textBaseline = q.baseline;
        ctx.fillText(q.label.toUpperCase(), q.lx, q.ly);
      });

      // Líneas divisorias
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(xMid, top);    ctx.lineTo(xMid, bottom);  ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left, yMid);   ctx.lineTo(right, yMid);   ctx.stroke();
      ctx.setLineDash([]);

      // Etiqueta de umbral X (participación promedio)
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`↕ promedio (${avgShare.toFixed(1)}%)`, xMid, bottom - 2);

      ctx.restore();
    },
  };

  if (charts['chart-bcg']) { charts['chart-bcg'].destroy(); delete charts['chart-bcg']; }

  charts['chart-bcg'] = new Chart(
    document.getElementById('chart-bcg').getContext('2d'),
    {
      type: 'bubble',
      plugins: [bcgQPlugin],
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: true, aspectRatio: 1.6,
        plugins: {
          legend: CHART_DEFAULTS.legend('bottom'),
          tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
            label: ctx => {
              const d = ctx.raw;
              const growthLine = d.hasYoY
                ? `  Crecimiento YoY: ${d.growth >= 0 ? '+' : ''}${d.growth.toFixed(1)}%`
                : `  Crecimiento YoY: sin dato (nuevo)`;
              return [
                `  ${d.producto}`,
                `  Participación en ventas: ${d.pctShare.toFixed(2)}%`,
                growthLine,
                `  Ventas: ${fmt.pesos(d.ventas)}`,
              ];
            },
          }},
        },
        scales: {
          x: {
            min: 0, max: xMax,
            title: { display: true, text: 'Participación en ventas totales (%)', color: '#7a7060', font: { size: 11 } },
            grid: { color: '#e8e3db' },
            ticks: { color: '#7a7060', callback: v => v.toFixed(1) + '%' },
          },
          y: {
            min: noYoY ? -10 : -yAbsMax,
            max: noYoY ?  10 :  yAbsMax,
            title: { display: true, text: 'Crecimiento año a año (%)', color: '#7a7060', font: { size: 11 } },
            grid: { color: '#e8e3db' },
            ticks: { color: '#7a7060', callback: v => (v >= 0 ? '+' : '') + v + '%' },
          },
        },
      },
    }
  );

  // Nota metodológica debajo del gráfico
  const nota = noYoY
    ? '⚠️ Solo hay datos de un año — el crecimiento YoY no está disponible. Todos los productos aparecen en Y=0.'
    : `Umbral horizontal: participación promedio por producto (${avgShare.toFixed(1)}%). Umbral vertical: 0% de crecimiento YoY. Tamaño de burbuja = ventas absolutas.`;

  // Cards por cuadrante
  document.getElementById('bcg-cards').innerHTML = `
    <div class="bcg-nota" style="grid-column:1/-1">${nota}</div>
    ` + ['Estrella','Vaca','Interrogante','Perro'].map(q => {
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
              <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
                <span class="bcg-item-val">${fmt.pesos(i.ventas)}</span>
                <span style="font-size:0.65rem;color:var(--muted)">${i.pctShare.toFixed(1)}%</span>
                ${i.hasYoY ? `<span style="font-size:0.65rem;color:${i.growth>=0?'#28a67e':'#c0334f'}">${i.growth>=0?'+':''}${i.growth.toFixed(0)}%</span>` : ''}
              </div>
            </div>
          `).join('')}
          ${total > 8 ? `<div style="font-size:0.7rem;color:var(--muted);text-align:center;padding:4px">+${total - 8} más</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── SEGUIMIENTO ────────────────────────────────────────────────────────────

// Estado propio del seguimiento (independiente de los filtros globales)
const segState = {
  anos:   ['all'],
  meses:  ['all'],
  metric: 'ventas',
};
let segMsAno, segMsMes;  // instancias MultiSelect propias

function saveSegList() {
  localStorage.setItem(SEG_KEY, JSON.stringify(segList));
}

function renderSegChips() {
  const container = document.getElementById('seg-chips');
  if (!container) return;
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

function initSegFilters() {
  // MultiSelect Año y Mes propios de la sección
  segMsAno = new MultiSelect({
    container: document.getElementById('seg-ms-ano'),
    label: 'Año',
    onChange: vals => { segState.anos = vals; },
  });
  segMsMes = new MultiSelect({
    container: document.getElementById('seg-ms-mes'),
    label: 'Mes',
    onChange: vals => { segState.meses = vals; },
  });

  // Métrica propia
  document.getElementById('seg-metric-ventas').addEventListener('click', () => {
    segState.metric = 'ventas';
    document.getElementById('seg-metric-ventas').classList.add('active');
    document.getElementById('seg-metric-cantidad').classList.remove('active');
  });
  document.getElementById('seg-metric-cantidad').addEventListener('click', () => {
    segState.metric = 'cantidad';
    document.getElementById('seg-metric-cantidad').classList.add('active');
    document.getElementById('seg-metric-ventas').classList.remove('active');
  });

  // Botón Ver datos
  document.getElementById('seg-btn-apply').addEventListener('click', loadSeguimiento);
}

function populateSegCatalog(cat) {
  // Llamado luego de cargar el catálogo global — llena los dropdowns del seguimiento
  if (segMsAno) segMsAno.setOptions(cat.anos.map(a => ({ value: String(a), text: String(a) })));
  if (segMsMes) segMsMes.setOptions(cat.meses.map(m => ({ value: m, text: m.charAt(0) + m.slice(1).toLowerCase() })));
}

function initSegSearch() {
  const input       = document.getElementById('seg-input');
  const suggestions = document.getElementById('seg-suggestions');
  if (!input) return;

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
    if (!input.contains(e.target) && !suggestions.contains(e.target))
      suggestions.classList.remove('open');
  });
}

async function loadSeguimiento() {
  const grid     = document.getElementById('seg-grid');
  const empty    = document.getElementById('seg-empty');
  const combCard = document.getElementById('seg-combined-card');

  if (segList.length === 0) {
    grid.innerHTML = '';
    combCard.style.display = 'none';
    empty.style.display    = '';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;padding:8px 0">Cargando…</p>';

  try {
    const params = new URLSearchParams({ productos: segList.join(',') });
    if (!segState.anos.includes('all'))  params.set('anos',  segState.anos.join(','));
    if (!segState.meses.includes('all')) params.set('meses', segState.meses.join(','));

    const data = await fetch(`/api/seguimiento?${params}`).then(r => r.json());
    if (data.error) throw new Error(data.error);

    // Etiqueta de período en el gráfico combinado
    const periodLabel = _buildPeriodLabel();
    const labelEl = document.getElementById('seg-period-label');
    if (labelEl) labelEl.textContent = periodLabel;

    renderSegCards(data);
    renderSegCombined(data);
    combCard.style.display = Object.keys(data.productos).length > 1 ? '' : 'none';
  } catch (err) {
    grid.innerHTML = `<p style="color:#e03c5a;padding:8px 0">Error: ${err.message}</p>`;
  }
}

function _buildPeriodLabel() {
  const aLabel = segState.anos.includes('all')  ? 'Todos los años'  : segState.anos.join(', ');
  const mLabel = segState.meses.includes('all') ? 'Todos los meses' : segState.meses.map(m => m.charAt(0) + m.slice(1).toLowerCase()).join(', ');
  return `${aLabel} · ${mLabel}`;
}

function _segTrendBlock(trend, label) {
  if (trend === null) return '';
  let cls = 'flat', icon = '→', txt = 'Estable';
  if (trend > 1)       { cls = 'up';   icon = '↑'; txt = `+${trend.toFixed(1)}%`; }
  else if (trend < -1) { cls = 'down'; icon = '↓'; txt = `${trend.toFixed(1)}%`; }
  return `<div class="seg-trend ${cls}">${icon} ${txt} <span style="font-weight:400;opacity:0.65;font-size:0.68rem">${label}</span></div>`;
}

function renderSegCards(data) {
  const grid  = document.getElementById('seg-grid');
  const isV   = segState.metric === 'ventas';
  const prods = Object.entries(data.productos);

  if (prods.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:0.82rem;padding:8px 0">Sin datos para el período seleccionado.</p>';
    return;
  }

  // Destruir sparklines anteriores
  Object.keys(charts).filter(k => k.startsWith('seg-spark-')).forEach(k => {
    charts[k].destroy(); delete charts[k];
  });

  grid.innerHTML = prods.map(([prod, d], i) => {
    const color = SEG_PALETTE[i % SEG_PALETTE.length];
    const trend = isV ? d.trendVentas : d.trendCantidad;
    const trendBlock = _segTrendBlock(trend, 'vs 3m ant.');
    const cat = d.categoria && d.categoria !== '—' ? d.categoria : null;

    // Ranking y participación según métrica activa
    const rank    = isV ? d.rankVentas    : d.rankCantidad;
    const pct     = isV ? d.pctVentas     : d.pctCantidad;
    const total   = d.totalProductos || '?';

    // Barra de participación (ancho = pct, max visual = 30% → 100% de la barra)
    const barW = Math.min(100, pct > 0 ? (pct / 30) * 100 : 0);

    // Color del ranking: top 3 dorado, top 10 azul, resto gris
    const rankColor = rank <= 3 ? '#c8a84b' : rank <= 10 ? '#3b82f6' : 'var(--muted)';
    const rankLabel = rank ? `#${rank} de ${total}` : '—';

    return `
      <div class="seg-card">
        <div class="seg-card-header">
          <div style="flex:1;min-width:0">
            <div class="seg-card-name">${prod}</div>
            ${cat ? `<div class="seg-card-cat"><span class="cat-tag">${cat}</span></div>` : ''}
          </div>
          <div class="seg-rank-badge" style="color:${rankColor}" title="Posición en el ranking del período">
            <span class="seg-rank-num">${rankLabel}</span>
          </div>
        </div>

        <!-- Participación -->
        <div class="seg-share-row">
          <div class="seg-share-bar-track">
            <div class="seg-share-bar-fill" style="width:${barW}%;background:${color}"></div>
          </div>
          <span class="seg-share-label">${pct > 0 ? pct.toFixed(1) + '%' : '—'} del total</span>
        </div>

        <div class="seg-kpis">
          <div class="seg-kpi">
            <span class="seg-kpi-label">Ventas</span>
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
        ${trendBlock}
        <div class="seg-sparkline"><canvas id="seg-spark-${i}"></canvas></div>
      </div>`;
  }).join('');

  // Sparklines
  prods.forEach(([, d], i) => {
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
          borderWidth: 2, pointRadius: 2, tension: 0.4, fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          ...CHART_DEFAULTS.tooltip,
          callbacks: { label: c => isV ? ` ${fmt.pesos(c.parsed.y)}` : ` ${fmt.num(c.parsed.y)} uds` },
        }},
        scales: { x: { display: false }, y: { display: false } },
      },
    });
  });
}

function renderSegCombined(data) {
  const isV    = segState.metric === 'ventas';
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
        responsive: true, maintainAspectRatio: true, aspectRatio: 2.8,
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

// ── INFLACIÓN CARTA ────────────────────────────────────────────────────────

// Cache de datos INDEC (se carga una vez por sesión)
let _indecData   = null;   // array de { period, year, month, mes, mom }
let _indecLoaded = false;

async function loadINDEC() {
  if (_indecLoaded) return _indecData;
  try {
    const r = await fetch('/api/ipc').then(r => r.json());
    _indecData = r.ok ? r.data : [];
  } catch { _indecData = []; }
  _indecLoaded = true;
  return _indecData;
}

// Construye lookup period→mom desde el array INDEC  { "2024-01": 20.6, ... }
function _indecLookup(indec) {
  const map = {};
  (indec || []).forEach(d => { map[d.period] = d.mom; });
  return map;
}

// Convierte label de mes ("ENE 2024") al period INDEC ("2024-01")
const _MES_NUM = { ENE:1,FEB:2,MAR:3,ABR:4,MAY:5,JUN:6,JUL:7,AGO:8,SEP:9,OCT:10,NOV:11,DIC:12 };
function _labelToPeriod(label) {
  const [m, y] = label.split(' ');
  const num = _MES_NUM[m.slice(0,3).toUpperCase()];
  return num ? `${y}-${String(num).padStart(2,'0')}` : null;
}

// Devuelve color CSS según el % y si es anual o mensual
function _infColor(pct, isAnnual = false) {
  if (pct == null) return 'var(--muted)';
  if (isAnnual) {
    if (pct <  30) return '#28a67e';   // bajo
    if (pct <  80) return '#c8a84b';   // moderado-alto
    if (pct < 150) return '#e07b39';   // muy alto
    return '#e03c5a';                  // extremo (Argentina)
  } else {
    if (pct < 0)  return '#4a9eff';    // deflación
    if (pct < 3)  return '#28a67e';
    if (pct < 7)  return '#c8a84b';
    if (pct < 15) return '#e07b39';
    return '#e03c5a';
  }
}

function renderInflacion(inf, indec) {
  if (!inf || !inf.labels || inf.labels.length === 0) return;
  const lookup = _indecLookup(indec);
  _renderInfAnnual(inf, indec, lookup);
  _renderInfChart(inf, indec, lookup);
  _renderInfTable(inf.months, lookup);
}

function _renderInfAnnual(inf, indec, lookup) {
  const grid = document.getElementById('inf-annual-grid');
  if (!grid) return;

  // Calcular acumulado anual INDEC (producto compuesto de MoM del año)
  function indecAnnual(ano, meses) {
    if (!indec || !indec.length) return null;
    // Toma los meses del año que tengamos en INDEC
    const months = indec.filter(d => d.year === ano && d.mom != null);
    if (months.length === 0) return null;
    // Filtrar solo los meses del período que cubre nuestra data
    const coveredMonths = months.filter(d => {
      const period = `${d.year}-${String(d.month).padStart(2,'0')}`;
      // Solo tomar hasta el último mes que tenemos en restaurante
      return true;
    }).slice(0, meses);  // misma cantidad de meses que el restaurante
    if (coveredMonths.length === 0) return null;
    const compound = coveredMonths.reduce((acc, d) => acc * (1 + d.mom / 100), 1) - 1;
    return parseFloat((compound * 100).toFixed(1));
  }

  function signStr(v) { return v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—'; }
  function diffBlock(rest, ind) {
    if (rest == null || ind == null) return '';
    const diff = rest - ind;
    const cls  = Math.abs(diff) < 2 ? 'var(--muted)' : diff > 0 ? '#e03c5a' : '#28a67e';
    const lbl  = diff > 2 ? 'por encima del INDEC' : diff < -2 ? 'por debajo del INDEC' : 'en línea con INDEC';
    return `<div class="inf-vs-indec" style="border-color:${cls}">
      <span style="color:${cls};font-weight:700">${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pp</span>
      <span>${lbl}</span>
    </div>`;
  }

  const annualCards = inf.annual.map(y => {
    const color   = _infColor(y.cumulative, true);
    const partial = y.meses < 12;
    const indecCum = indecAnnual(y.ano, y.meses);
    return `
      <div class="inf-annual-card">
        <div class="inf-year-label">${y.ano}${partial ? ' <span class="inf-partial">en curso</span>' : ''}</div>
        <div class="inf-cumulative" style="color:${color}">${signStr(y.cumulative)}</div>
        <div class="inf-year-sub">Inflación carta${partial ? ' (parcial)' : ''}</div>
        <div class="inf-year-stats">
          <div class="inf-stat"><span>Precio inicio</span><span>${y.firstPrice != null ? fmt.pesosFull(y.firstPrice) : '—'}</span></div>
          <div class="inf-stat"><span>Precio cierre</span><span>${y.lastPrice != null ? fmt.pesosFull(y.lastPrice) : '—'}</span></div>
          <div class="inf-stat"><span>Prom. mensual</span>
            <span style="color:${_infColor(y.avgMom)};font-weight:700">${signStr(y.avgMom)}</span>
          </div>
          <div class="inf-stat inf-stat-indec"><span>INDEC acumulado</span>
            <span style="color:${_infColor(indecCum, true)}">${signStr(indecCum)}</span>
          </div>
        </div>
        ${diffBlock(y.cumulative, indecCum)}
      </div>`;
  }).join('');

  // Card total histórico
  let totalCard = '';
  if (inf.annual.length > 1 && inf.totalCum != null) {
    const color = _infColor(inf.totalCum, true);
    // INDEC total histórico: compuesto de todos los meses en el rango
    let indecTotal = null;
    if (indec && indec.length) {
      const firstPeriod = _labelToPeriod(inf.firstLabel);
      const lastPeriod  = _labelToPeriod(inf.lastLabel);
      const range = indec.filter(d => d.period >= firstPeriod && d.period <= lastPeriod && d.mom != null);
      if (range.length > 0) {
        indecTotal = parseFloat(((range.reduce((a, d) => a * (1 + d.mom / 100), 1) - 1) * 100).toFixed(1));
      }
    }
    totalCard = `
      <div class="inf-annual-card inf-total-card">
        <div class="inf-year-label">Total histórico</div>
        <div class="inf-cumulative" style="color:${color}">+${inf.totalCum.toFixed(1)}%</div>
        <div class="inf-year-sub">${inf.firstLabel} → ${inf.lastLabel}</div>
        <div class="inf-year-stats">
          <div class="inf-stat"><span>Años en base</span><span>${inf.annual.length}</span></div>
          <div class="inf-stat inf-stat-indec"><span>INDEC mismo período</span>
            <span style="color:${_infColor(indecTotal, true)}">${signStr(indecTotal)}</span>
          </div>
        </div>
        ${ inf.totalCum != null && indecTotal != null ? (() => {
          const diff = inf.totalCum - indecTotal;
          const cls  = diff > 5 ? '#e03c5a' : diff < -5 ? '#28a67e' : 'var(--muted)';
          return `<div class="inf-vs-indec" style="border-color:${cls}">
            <span style="color:${cls};font-weight:700">${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pp</span>
            <span>${diff > 5 ? 'La carta subió más que inflación' : diff < -5 ? 'La carta subió menos que inflación' : 'En línea con la inflación'}</span>
          </div>`;
        })() : ''}
      </div>`;
  }

  grid.innerHTML = annualCards + totalCard;
}

function _renderInfChart(inf, indec, lookup) {
  const momColors = inf.mom.map(v => {
    if (v == null) return 'rgba(0,0,0,0)';
    const c = v < 0 ? '#4a9eff' : v < 3 ? '#28a67e' : v < 7 ? '#c8a84b' : v < 15 ? '#e07b39' : '#e03c5a';
    return c + 'bb';
  });
  const momBorders = inf.mom.map(v => {
    if (v == null) return 'rgba(0,0,0,0)';
    return v < 0 ? '#4a9eff' : v < 3 ? '#28a67e' : v < 7 ? '#c8a84b' : v < 15 ? '#e07b39' : '#e03c5a';
  });

  // INDEC MoM alineado a las mismas etiquetas de nuestra carta
  const indecMomData = inf.labels.map(label => {
    const period = _labelToPeriod(label);
    return (period && lookup && lookup[period] != null) ? lookup[period] : null;
  });
  const hasIndec = indecMomData.some(v => v != null);

  const datasets = [
    {
      type: 'line', label: 'Precio promedio ($)',
      data: inf.avgPrices,
      borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,0.10)',
      borderWidth: 2.5, pointRadius: 3,
      pointBackgroundColor: '#4a9eff', pointBorderColor: '#fff', pointBorderWidth: 2,
      tension: 0.3, fill: true, yAxisID: 'yPrice', order: 1,
    },
    {
      type: 'bar', label: 'Carta MoM (%)',
      data: inf.mom,
      backgroundColor: momColors, borderColor: momBorders, borderWidth: 1,
      borderRadius: 4, yAxisID: 'yMom', order: 3,
    },
  ];

  if (hasIndec) {
    datasets.push({
      type: 'line', label: 'INDEC MoM (%)',
      data: indecMomData,
      borderColor: '#e03c5a',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [5, 4],
      pointRadius: 3,
      pointBackgroundColor: '#e03c5a',
      pointBorderColor: '#fff',
      pointBorderWidth: 1.5,
      tension: 0.3,
      fill: false,
      spanGaps: true,
      yAxisID: 'yMom', order: 2,
    });
  }

  upsertChart('chart-inflacion', {
    data: { labels: inf.labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: true, aspectRatio: 3,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: CHART_DEFAULTS.legend(),
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: ctx => {
            if (ctx.dataset.yAxisID === 'yPrice')
              return ` Precio prom: ${fmt.pesosFull(ctx.parsed.y)}`;
            const v = ctx.parsed.y;
            if (v == null) return null;
            const prefix = ctx.dataset.label === 'INDEC MoM (%)' ? ' INDEC' : ' Carta';
            return `${prefix}: ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
          },
        }},
      },
      scales: {
        x: CHART_DEFAULTS.scaleX,
        yPrice: {
          ...CHART_DEFAULTS.scaleY, position: 'left',
          ticks: { color: '#4a9eff', callback: v => fmt.pesosFull(v) },
        },
        yMom: {
          position: 'right', grid: { drawOnChartArea: false },
          ticks: { color: '#7a7060', callback: v => v != null ? (v >= 0 ? '+' : '') + v + '%' : '' },
        },
      },
    },
  });
}

function _renderInfTable(months, lookup) {
  const tbody = document.getElementById('inf-monthly-tbody');
  if (!tbody || !months) return;

  function pctCell(val, isAnnual = false) {
    if (val == null) return `<td style="color:var(--muted)">—</td>`;
    const color = _infColor(val, isAnnual);
    const sign  = val >= 0 ? '+' : '';
    const bg    = Math.abs(val) > 10 ? `background:${color}18;` : '';
    return `<td style="color:${color};font-weight:600;${bg}">${sign}${val.toFixed(1)}%</td>`;
  }

  tbody.innerHTML = [...months].reverse().map(m => {
    const momTd = m.mom == null
      ? `<td style="color:var(--muted)">—</td>`
      : (() => {
          const color = _infColor(m.mom);
          const sign  = m.mom >= 0 ? '+' : '';
          const bg    = Math.abs(m.mom) > 10 ? `background:${color}18;` : '';
          const title = m.momCob ? ` title="Cobertura: ${m.momCob}% de ventas del mes"` : '';
          return `<td style="color:${color};font-weight:600;${bg}"${title}>${sign}${m.mom.toFixed(1)}%</td>`;
        })();

    // INDEC MoM para este período
    const period    = _labelToPeriod(m.label);
    const indecMom  = (lookup && period && lookup[period] != null) ? lookup[period] : null;
    const indecTd   = indecMom == null
      ? `<td style="color:var(--muted)">—</td>`
      : (() => {
          const color = _infColor(indecMom);
          const sign  = indecMom >= 0 ? '+' : '';
          return `<td style="color:${color}">${sign}${indecMom.toFixed(1)}%</td>`;
        })();

    // Diferencia en pp (carta − INDEC)
    const diffTd = (m.mom != null && indecMom != null)
      ? (() => {
          const diff  = m.mom - indecMom;
          const color = Math.abs(diff) < 1 ? 'var(--muted)' : diff > 0 ? '#e03c5a' : '#28a67e';
          return `<td style="color:${color};font-weight:600">${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pp</td>`;
        })()
      : `<td style="color:var(--muted)">—</td>`;

    return `
      <tr>
        <td style="text-align:left;font-weight:500;color:var(--text)">${m.label}</td>
        <td>${m.avgPrice != null ? fmt.pesosFull(m.avgPrice) : '—'}</td>
        ${momTd}
        ${indecTd}
        ${diffTd}
        ${pctCell(m.yoy)}
        ${pctCell(m.cumAnual)}
      </tr>`;
  }).join('');
}

// ── Render completo ────────────────────────────────────────────────────────

function renderAll(data) {
  rawData = data;

  // Catálogo — siempre actualiza para reflejar nuevos productos/años
  if (data.catalog) {
    populateCatalog(data.catalog);
    populateSegCatalog(data.catalog);
  }

  // Dashboard (incluye Evolución y Categorías)
  renderSummary(data.summary);
  renderPareto(data.pareto);
  renderDonut(data.categorias, 'chart-donut', 'cat-legend');
  renderABCCards(data.pareto);
  renderEvolucion(data.evolucion);
  renderDashTopTables(data.pareto.items);
  renderCatTable(data.categorias);

  // Tabla
  allItems = data.pareto.items.map((item, i) => ({ ...item, _rank: i+1 }));
  renderTable();

  // BCG
  renderBCG(data);

  // Inflación Carta
  renderInflacion(data.inflacion, _indecData);

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
// Cuando navega a Inflación, cargar INDEC si aún no se cargó y re-renderizar
document.querySelectorAll('.nav-item').forEach(item => {
  if (item.dataset.section === 'seguimiento') {
    item.addEventListener('click', () => { if (segList.length > 0) loadSeguimiento(); }, { capture: true });
  }
  if (item.dataset.section === 'inflacion') {
    item.addEventListener('click', async () => {
      if (!_indecLoaded) {
        await loadINDEC();
        // Re-renderizar la sección con los datos INDEC recién cargados
        if (rawData && rawData.inflacion) renderInflacion(rawData.inflacion, _indecData);
      }
    }, { capture: true });
  }
});

// Iniciar
initFilterToggle();
initFilters();
initSegFilters();
renderSegChips();
initSegSearch();
_startAutoRefresh();   // auto-refresh cada 60s
loadData();
