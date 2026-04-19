/* ── CARTA REBELION — Frontend ──────────────────────────────────────────── */

// ── Estado ─────────────────────────────────────────────────────────────────
let state = {
  ano:     'all',
  metric:  'ventas',
  sortCol: 'rank',
  sortDir: 'asc',
  search:  '',
  clase:   'all',
  cat:     'all',
  _anosLoaded: false,
};

let chartPareto    = null;
let chartDonut     = null;
let chartEvolucion = null;
let allItems       = [];

// ── Formato ─────────────────────────────────────────────────────────────────
function fmtPesos(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(0) + 'k';
  return '$' + Math.round(n).toLocaleString('es-AR');
}
function fmtPesosFull(n) {
  if (n == null) return '—';
  return '$' + Math.round(n).toLocaleString('es-AR');
}
function fmtNum(n) {
  if (n == null) return '—';
  return Math.round(n).toLocaleString('es-AR');
}
function fmtPct(n) {
  if (n == null) return '—';
  return n.toFixed(1) + '%';
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Chips de año ─────────────────────────────────────────────────────────────
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
  syncChips(container, state.ano);
  container.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.ano = btn.dataset.value;
    syncChips(container, state.ano);
    loadData();
  });
}

function syncChips(container, activeVal) {
  container.querySelectorAll('.chip').forEach(b =>
    b.classList.toggle('active', b.dataset.value === activeVal)
  );
}

// ── Filtro de métrica ─────────────────────────────────────────────────────────
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

// ── Summary cards ─────────────────────────────────────────────────────────────
function renderSummary(s) {
  const isVentas = state.metric === 'ventas';
  document.getElementById('summary-grid').innerHTML = `
    <div class="summary-card">
      <div class="s-label">${isVentas ? 'Ventas totales' : 'Unidades vendidas'}</div>
      <div class="s-value">${isVentas ? fmtPesos(s.totalVentas) : fmtNum(s.totalCantidad)}</div>
      <div class="s-sub">${(s.años || []).join(' · ')}</div>
    </div>
    <div class="summary-card">
      <div class="s-label">Items en carta</div>
      <div class="s-value">${s.totalItems}</div>
      <div class="s-sub">${s.totalCategorias} categorías</div>
    </div>
    <div class="summary-card">
      <div class="s-label">Precio promedio</div>
      <div class="s-value">${fmtPesosFull(s.ticketPromedio)}</div>
      <div class="s-sub">por unidad vendida</div>
    </div>
    <div class="summary-card">
      <div class="s-label">Período</div>
      <div class="s-value" style="font-size:1rem">${(s.meses || []).length} meses</div>
      <div class="s-sub">${s.meses?.[0] || ''} → ${s.meses?.at(-1) || ''}</div>
    </div>
  `;
}

// ── Colores por clase ─────────────────────────────────────────────────────────
const CLASE_COLOR = { A: '#38d9a9', B: '#f5a623', C: '#e03c5a' };

// ── Pareto chart ──────────────────────────────────────────────────────────────
function renderPareto(pareto) {
  const items   = pareto.items.slice(0, 20);
  const labels  = items.map(i => i.producto.length > 22 ? i.producto.slice(0, 20) + '…' : i.producto);
  const valores = items.map(i => state.metric === 'cantidad' ? i.cantidad : i.ventas);
  const bgColors = items.map(i => CLASE_COLOR[i.clase] + 'cc');
  const cumLine  = items.map(i => i.pctCum);
  const ctx = document.getElementById('chart-pareto').getContext('2d');

  if (chartPareto) {
    chartPareto.data.labels = labels;
    chartPareto.data.datasets[0].data = valores;
    chartPareto.data.datasets[0].backgroundColor = bgColors;
    chartPareto.data.datasets[1].data = cumLine;
    chartPareto.update();
    return;
  }

  chartPareto = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: state.metric === 'ventas' ? 'Ventas $' : 'Cantidad',
          data: valores,
          backgroundColor: bgColors,
          borderRadius: 4,
          yAxisID: 'yBar',
          order: 2,
        },
        {
          type: 'line',
          label: '% Acumulado',
          data: cumLine,
          borderColor: '#90caf9',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          yAxisID: 'yLine',
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: '#7b7f94', boxWidth: 12, padding: 14 } },
        tooltip: {
          backgroundColor: '#1a1d27', borderColor: '#2a2d3a', borderWidth: 1,
          titleColor: '#e8eaf0', bodyColor: '#7b7f94',
          callbacks: {
            label: ctx => ctx.dataset.yAxisID === 'yLine'
              ? ` Acum: ${ctx.parsed.y.toFixed(1)}%`
              : state.metric === 'ventas'
                ? ` ${fmtPesosFull(ctx.parsed.y)}`
                : ` ${fmtNum(ctx.parsed.y)} uds`,
          },
        },
      },
      scales: {
        x: { grid: { color: '#2a2d3a' }, ticks: { color: '#7b7f94', maxRotation: 45, font: { size: 10 } } },
        yBar: {
          position: 'left', grid: { color: '#2a2d3a' },
          ticks: { color: '#7b7f94', callback: v => state.metric === 'ventas'
            ? '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : (v/1e3).toFixed(0)+'k')
            : fmtNum(v) },
        },
        yLine: {
          position: 'right', grid: { drawOnChartArea: false }, min: 0, max: 100,
          ticks: { color: '#7b7f94', callback: v => v + '%' },
        },
      },
    },
  });
}

// ── Donut categorías ──────────────────────────────────────────────────────────
function renderDonut(cats) {
  const top    = cats.slice(0, 10);
  const labels = top.map(c => c.nombre);
  const data   = top.map(c => state.metric === 'cantidad' ? c.cantidad : c.ventas);
  const colors = top.map(c => c.color);
  const ctx    = document.getElementById('chart-donut').getContext('2d');

  if (chartDonut) {
    chartDonut.data.labels = labels;
    chartDonut.data.datasets[0].data = data;
    chartDonut.data.datasets[0].backgroundColor = colors;
    chartDonut.update();
  } else {
    chartDonut = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#1a1d27', hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1d27', borderColor: '#2a2d3a', borderWidth: 1,
            titleColor: '#e8eaf0', bodyColor: '#7b7f94',
            callbacks: {
              label: ctx => {
                const pct = cats[ctx.dataIndex]?.pct || 0;
                const val = state.metric === 'ventas' ? fmtPesosFull(ctx.parsed) : fmtNum(ctx.parsed);
                return ` ${val}  (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // Leyenda manual
  document.getElementById('cat-legend').innerHTML = top.map(c => `
    <div class="cat-legend-item">
      <div class="cat-legend-dot" style="background:${c.color}"></div>
      <span>${c.nombre.replace(/^\d+\s+/, '')} <strong style="color:var(--text)">${c.pct}%</strong></span>
    </div>
  `).join('');

  // Poblar select de categorías
  const sel = document.getElementById('filter-cat');
  const cur = sel.value;
  sel.innerHTML = '<option value="all">Todas las categorías</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.nombre;
    opt.textContent = c.nombre;
    sel.appendChild(opt);
  });
  sel.value = cats.find(c => c.nombre === cur) ? cur : 'all';
}

// ── ABC cards ─────────────────────────────────────────────────────────────────
const ABC_INFO = {
  A: { label: 'Estrellas',   desc: 'Generan el 70% de las ventas. Nunca deben faltar.' },
  B: { label: 'Intermedios', desc: 'Entre el 70% y 90%. Sostienen el volumen.' },
  C: { label: 'Cola larga',  desc: 'Último 10%. Evaluar continuidad o rediseño.' },
};

function renderABCCards(pareto) {
  const isVentas = state.metric === 'ventas';
  document.getElementById('abc-cards').innerHTML = ['A','B','C'].map(clase => {
    const count  = pareto.conteo[clase] || 0;
    const ventas = pareto.ventasPorClase[clase] || 0;
    const pct    = pareto.total > 0 ? (ventas / pareto.total * 100).toFixed(1) : 0;
    return `
      <div class="abc-card">
        <div class="abc-card-header">
          <div class="badge-big ${clase.toLowerCase()}">${clase}</div>
          <div class="badge-title">${ABC_INFO[clase].label}</div>
        </div>
        <div class="abc-stats">
          <div class="abc-stat"><span class="label">Items</span><span class="value">${count}</span></div>
          <div class="abc-stat">
            <span class="label">${isVentas ? 'Ventas' : 'Unidades'}</span>
            <span class="value">${isVentas ? fmtPesos(ventas) : fmtNum(ventas)}</span>
          </div>
          <div class="abc-stat"><span class="label">% del total</span><span class="value">${pct}%</span></div>
        </div>
        <div style="margin-top:10px;font-size:0.73rem;color:var(--muted);line-height:1.4">${ABC_INFO[clase].desc}</div>
      </div>
    `;
  }).join('');
}

// ── Evolución mensual ─────────────────────────────────────────────────────────
function renderEvolucion(evo) {
  const isVentas = state.metric === 'ventas';
  const data = isVentas ? evo.ventas : evo.cantidad;
  const ctx  = document.getElementById('chart-evolucion').getContext('2d');

  if (chartEvolucion) {
    chartEvolucion.data.labels = evo.labels;
    chartEvolucion.data.datasets[0].data  = data;
    chartEvolucion.data.datasets[0].label = isVentas ? 'Ventas $' : 'Cantidad';
    chartEvolucion.update();
    return;
  }

  chartEvolucion = new Chart(ctx, {
    type: 'line',
    data: {
      labels: evo.labels,
      datasets: [{
        label: isVentas ? 'Ventas $' : 'Cantidad',
        data,
        borderColor: '#e03c5a',
        backgroundColor: '#e03c5a22',
        borderWidth: 2.5,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d27', borderColor: '#2a2d3a', borderWidth: 1,
          titleColor: '#e8eaf0', bodyColor: '#7b7f94',
          callbacks: { label: ctx => isVentas ? ` ${fmtPesosFull(ctx.parsed.y)}` : ` ${fmtNum(ctx.parsed.y)} uds` },
        },
      },
      scales: {
        x: { grid: { color: '#2a2d3a' }, ticks: { color: '#7b7f94', maxRotation: 45, font: { size: 11 } } },
        y: {
          grid: { color: '#2a2d3a' },
          ticks: { color: '#7b7f94', callback: v => isVentas
            ? '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : (v/1e3).toFixed(0)+'k')
            : fmtNum(v) },
        },
      },
    },
  });
}

// ── Tabla ─────────────────────────────────────────────────────────────────────
function renderTable() {
  const search = state.search.toLowerCase();
  const filtered = allItems.filter(item => {
    if (state.clase !== 'all' && item.clase !== state.clase) return false;
    if (state.cat  !== 'all' && item.categoria !== state.cat) return false;
    if (search && !item.producto.toLowerCase().includes(search) &&
        !item.categoria.toLowerCase().includes(search)) return false;
    return true;
  });

  const dir    = state.sortDir === 'asc' ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    let va = state.sortCol === 'rank' ? a._rank : a[state.sortCol];
    let vb = state.sortCol === 'rank' ? b._rank : b[state.sortCol];
    if (typeof va === 'string') return dir * va.localeCompare(vb);
    return dir * ((va ?? 0) - (vb ?? 0));
  });

  const tbody = document.getElementById('items-tbody');
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--muted)">Sin resultados</td></tr>`;
  } else {
    tbody.innerHTML = sorted.map((item, idx) => `
      <tr>
        <td class="rank-num">${idx + 1}</td>
        <td style="color:var(--text)">${item.producto}</td>
        <td><span class="cat-tag">${item.categoria.replace(/^\d+\s+/, '')}</span></td>
        <td>${fmtPesosFull(item.ventas)}</td>
        <td>${fmtNum(item.cantidad)}</td>
        <td>${fmtPesosFull(item.precioPromedio)}</td>
        <td>${fmtPct(item.pct)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${Math.min(item.pctCum,100)}%;background:${item.pctCum<=70?'#38d9a9':item.pctCum<=90?'#f5a623':'#e03c5a'};border-radius:2px"></div>
            </div>
            <span style="font-size:0.72rem;color:var(--muted)">${fmtPct(item.pctCum)}</span>
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

// Eventos de tabla
document.querySelectorAll('#items-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (state.sortCol === th.dataset.col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortCol = th.dataset.col; state.sortDir = th.dataset.col === 'rank' ? 'asc' : 'desc'; }
    renderTable();
  });
});
document.getElementById('search-item').addEventListener('input', e => { state.search = e.target.value; renderTable(); });
document.getElementById('filter-clase').addEventListener('change', e => { state.clase = e.target.value; renderTable(); });
document.getElementById('filter-cat').addEventListener('change', e => { state.cat = e.target.value; renderTable(); });

// ── Render completo ───────────────────────────────────────────────────────────
function renderAll(data) {
  renderSummary(data.summary);
  renderABCCards(data.pareto);
  renderPareto(data.pareto);
  renderDonut(data.categorias);
  renderEvolucion(data.evolucion);
  allItems = data.pareto.items.map((item, i) => ({ ...item, _rank: i + 1 }));
  renderTable();
  const now = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('last-update').textContent = `Actualizado ${now}`;
}

// ── Carga de datos ────────────────────────────────────────────────────────────
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
    showToast('Error al cargar datos: ' + err.message);
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
