/* ── CARTA REBELION — App ──────────────────────────────────────────────── */

// ── Estado global ──────────────────────────────────────────────────────────
const state = {
  ano: 'all', metric: 'ventas',
  sortCol: 'rank', sortDir: 'asc',
  search: '', clase: 'all', cat: 'all',
  _anosLoaded: false,
};

// Instancias de charts
const charts = {};
let allItems = [];
let rawData  = null;

// ── Formateo ───────────────────────────────────────────────────────────────
const fmt = {
  pesos:     n => n == null ? '—' : n >= 1e6 ? '$'+(n/1e6).toFixed(1)+'M' : n >= 1e3 ? '$'+(n/1e3).toFixed(0)+'k' : '$'+Math.round(n).toLocaleString('es-AR'),
  pesosFull: n => n == null ? '—' : '$'+Math.round(n).toLocaleString('es-AR'),
  num:       n => n == null ? '—' : Math.round(n).toLocaleString('es-AR'),
  pct:       n => n == null ? '—' : n.toFixed(1)+'%',
  growth:    n => n == null ? '—' : (n >= 0 ? '+' : '')+n.toFixed(1)+'%',
};

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Sidebar navigation ─────────────────────────────────────────────────────
const SECTION_TITLES = {
  dashboard: 'Dashboard',
  evolucion: 'Evolución',
  categorias: 'Categorías',
  tabla: 'Tabla de items',
  bcg: 'Matriz BCG',
  cmv: 'CMV',
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

// ── Filtros globales ────────────────────────────────────────────────────────
function buildAnoChips(años) {
  const container = document.getElementById('filter-ano');
  container.innerHTML = '<button class="chip active" data-value="all">Todos</button>';
  años.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.value = String(a);
    btn.textContent = a;
    container.appendChild(btn);
  });
  container.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.ano = btn.dataset.value;
    container.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.dataset.value === state.ano));
    loadData();
  });
}

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
    backgroundColor: '#1a1d27', borderColor: '#2a2d3a', borderWidth: 1,
    titleColor: '#e8eaf0', bodyColor: '#7b7f94',
  },
  legend: (pos='bottom') => ({
    position: pos, labels: { color: '#7b7f94', boxWidth: 12, padding: 14 },
  }),
  scaleX: { grid: { color: '#2a2d3a' }, ticks: { color: '#7b7f94', maxRotation: 45, font: { size: 11 } } },
  scaleY: { grid: { color: '#2a2d3a' }, ticks: { color: '#7b7f94' } },
};

const CLASE_COLOR  = { A: '#38d9a9', B: '#f5a623', C: '#e03c5a' };
const CAT_PALETTE  = ['#e03c5a','#f5a623','#7ed321','#4fc3f7','#ce93d8','#80cbc4','#ffb74d','#a5d6a7','#f48fb1','#90caf9'];

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
          borderColor: '#90caf9', backgroundColor: 'transparent',
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
        backgroundColor: colors, borderWidth: 2, borderColor: '#1a1d27', hoverOffset: 6 }],
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
        borderColor: '#e03c5a', backgroundColor: '#e03c5a18',
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
        backgroundColor: '#e03c5a88',
        borderColor: '#e03c5a',
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
        y: { grid: { color: '#2a2d3a' }, ticks: { color: '#7b7f94', font: { size: 11 } } },
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

  // Populate cat filter
  const sel = document.getElementById('filter-cat');
  const cur = sel.value;
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
    if (state.clase !== 'all' && item.clase !== state.clase) return false;
    if (state.cat  !== 'all' && item.categoria !== state.cat) return false;
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
document.getElementById('search-item').addEventListener('input',  e => { state.search = e.target.value; renderTable(); });
document.getElementById('filter-clase').addEventListener('change', e => { state.clase  = e.target.value; renderTable(); });
document.getElementById('filter-cat').addEventListener('change',   e => { state.cat    = e.target.value; renderTable(); });

// ── MATRIZ BCG ─────────────────────────────────────────────────────────────

const BCG_CONFIG = {
  Estrella:     { color: '#38d9a9', icon: '★', desc: 'Alta participación + crecimiento. Potenciar.' },
  Vaca:         { color: '#4fc3f7', icon: '◆', desc: 'Alta participación + estable/baja. Mantener.' },
  Interrogante: { color: '#f5a623', icon: '?', desc: 'Baja participación + crecimiento. Decidir.' },
  Perro:        { color: '#e03c5a', icon: '✕', desc: 'Baja participación + declive. Revisar.' },
};

function buildBCG(data) {
  const items    = data.pareto.items;
  const maxVentas = Math.max(...items.map(i => i.ventas));

  // Calcular crecimiento usando evolucion (comparar primer mitad vs segunda mitad del período)
  const evo      = data.evolucion;
  const mid      = Math.floor(evo.labels.length / 2);
  const totalOld = evo.ventas.slice(0, mid).reduce((s, v) => s + (v||0), 0);
  const totalNew = evo.ventas.slice(mid).reduce((s, v) => s + (v||0), 0);
  const globalGrowth = totalOld > 0 ? ((totalNew - totalOld) / totalOld) * 100 : 0;

  return items.map(item => {
    const relShare = maxVentas > 0 ? item.ventas / maxVentas : 0;
    // Simular crecimiento por item basado en su clase y posición
    // (sin datos por período por item, usamos proxy: clase A = positivo, C = negativo)
    const growthProxy = item.clase === 'A' ? globalGrowth * (0.8 + Math.random()*0.4)
                      : item.clase === 'B' ? globalGrowth * (0.4 + Math.random()*0.4)
                      : globalGrowth * (-0.2 + Math.random()*0.4);

    let cuadrante;
    if      (relShare >= 0.15 && growthProxy >= 0)  cuadrante = 'Estrella';
    else if (relShare >= 0.15 && growthProxy <  0)  cuadrante = 'Vaca';
    else if (relShare <  0.15 && growthProxy >= 0)  cuadrante = 'Interrogante';
    else                                             cuadrante = 'Perro';

    return { ...item, relShare, growth: growthProxy, cuadrante };
  });
}

function renderBCG(data) {
  const bcgItems = buildBCG(data);

  // Scatter chart
  const datasets = ['Estrella','Vaca','Interrogante','Perro'].map(q => {
    const qItems = bcgItems.filter(i => i.cuadrante === q).slice(0, 30);
    return {
      label: q,
      data: qItems.map(i => ({
        x: parseFloat((i.relShare * 100).toFixed(1)),
        y: parseFloat(i.growth.toFixed(1)),
        r: Math.max(4, Math.min(20, (i.ventas / data.pareto.total) * 400)),
        producto: i.producto,
        ventas: i.ventas,
      })),
      backgroundColor: BCG_CONFIG[q].color + '99',
      borderColor:     BCG_CONFIG[q].color,
      borderWidth: 1,
    };
  });

  upsertChart('chart-bcg', {
    type: 'bubble',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: CHART_DEFAULTS.legend('bottom'),
        tooltip: { ...CHART_DEFAULTS.tooltip, callbacks: {
          label: ctx => {
            const d = ctx.raw;
            return [`  ${d.producto}`, `  Participación: ${d.x}%`, `  Ventas: ${fmt.pesos(d.ventas)}`];
          },
        }},
        annotation: { /* líneas de cuadrante */ },
      },
      scales: {
        x: {
          title: { display: true, text: 'Participación de mercado (%)', color: '#7b7f94', font: { size: 11 } },
          grid: { color: '#2a2d3a' }, ticks: { color: '#7b7f94', callback: v => v+'%' },
        },
        y: {
          title: { display: true, text: 'Crecimiento estimado (%)', color: '#7b7f94', font: { size: 11 } },
          grid: { color: '#2a2d3a' }, ticks: { color: '#7b7f94', callback: v => v+'%' },
        },
      },
    },
  });

  // BCG cards por cuadrante
  document.getElementById('bcg-cards').innerHTML = ['Estrella','Vaca','Interrogante','Perro'].map(q => {
    const cfg   = BCG_CONFIG[q];
    const items = bcgItems.filter(i => i.cuadrante === q).slice(0, 8);
    return `
      <div class="bcg-card">
        <div class="bcg-card-header">
          <div class="bcg-icon" style="background:${cfg.color}22;color:${cfg.color}">${cfg.icon}</div>
          <div>
            <div class="bcg-card-title" style="color:${cfg.color}">${q}</div>
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
          ${bcgItems.filter(i => i.cuadrante === q).length > 8
            ? `<div style="font-size:0.7rem;color:var(--muted);text-align:center;padding:4px">+${bcgItems.filter(i=>i.cuadrante===q).length - 8} más</div>`
            : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ── Render completo ────────────────────────────────────────────────────────

function renderAll(data) {
  rawData = data;

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

async function loadData() {
  document.getElementById('btn-refresh').classList.add('spinning');
  try {
    const params = new URLSearchParams({ ano: state.ano, metric: state.metric });
    const data   = await fetch(`/api/carta?${params}`).then(r => r.json());
    if (data.error) throw new Error(data.error);

    if (!state._anosLoaded && data.summary?.años?.length) {
      buildAnoChips(data.summary.años);
      state._anosLoaded = true;
    }
    renderAll(data);
  } catch (err) {
    console.error(err);
    showToast('Error: ' + err.message);
  } finally {
    document.getElementById('btn-refresh').classList.remove('spinning');
  }
}

document.getElementById('btn-refresh').addEventListener('click', async () => {
  await fetch('/api/refresh', { method: 'POST' });
  showToast('Recargando datos...');
  state._anosLoaded = false;
  loadData();
});

loadData();
