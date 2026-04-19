// ── Orden de meses ────────────────────────────────────────────────────────────
const MES_ORDER = [
  'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE',
];

// ── Paleta de colores para categorías ─────────────────────────────────────────
const CAT_COLORS = [
  '#e03c5a','#f5a623','#7ed321','#4fc3f7','#ce93d8',
  '#80cbc4','#ffb74d','#a5d6a7','#f48fb1','#90caf9',
  '#ffe082','#bcaaa4','#b0bec5','#ef9a9a','#80deea',
  '#c5e1a5','#fff59d','#ffcc80','#b39ddb','#80cbc4',
];

// ── Filtro ─────────────────────────────────────────────────────────────────────
function filterRecords(records, { ano, mes } = {}) {
  return records.filter(r => {
    if (ano && ano !== 'all' && String(r.ano) !== String(ano)) return false;
    if (mes && mes !== 'all' && r.mes !== mes.toUpperCase())   return false;
    return true;
  });
}

// ── Resumen general ────────────────────────────────────────────────────────────
function buildSummary(records) {
  const años   = [...new Set(records.map(r => r.ano).filter(Boolean))].sort();
  const meses  = [...new Set(records.map(r => r.mes).filter(Boolean))]
    .sort((a, b) => MES_ORDER.indexOf(a) - MES_ORDER.indexOf(b));

  const totalVentas    = records.reduce((s, r) => s + (r.dinero  || 0), 0);
  const totalCantidad  = records.reduce((s, r) => s + (r.cant    || 0), 0);
  const productos      = new Set(records.map(r => r.producto));
  const categorias     = new Set(records.map(r => r.categoria));

  return {
    totalVentas,
    totalCantidad,
    totalItems:      productos.size,
    totalCategorias: categorias.size,
    años,
    meses,
    ticketPromedio:  totalCantidad > 0 ? Math.round(totalVentas / totalCantidad) : null,
  };
}

// ── Pareto 80/20 ───────────────────────────────────────────────────────────────
// Clasifica cada item como A (≤70% acumulado), B (70-90%), C (>90%)
function buildPareto(records, metric = 'ventas') {
  const sortKey = metric === 'cantidad' ? 'cant' : 'dinero';

  // Agrupar por producto
  const map = {};
  for (const r of records) {
    if (!r.producto) continue;
    if (!map[r.producto]) {
      map[r.producto] = {
        producto:   r.producto,
        categoria:  r.categoria || '—',
        ventas:     0,
        cantidad:   0,
      };
    }
    map[r.producto].ventas   += r.dinero || 0;
    map[r.producto].cantidad += r.cant   || 0;
  }

  const items = Object.values(map);

  // Ordenar por métrica elegida
  const key = metric === 'cantidad' ? 'cantidad' : 'ventas';
  items.sort((a, b) => b[key] - a[key]);

  const total  = items.reduce((s, i) => s + i[key], 0);
  let cumSum   = 0;

  const classified = items.map(item => {
    cumSum += item[key];
    const pct    = total > 0 ? (item[key] / total) * 100 : 0;
    const pctCum = total > 0 ? (cumSum  / total) * 100 : 0;
    let clase = 'C';
    if (pctCum <= 70) clase = 'A';
    else if (pctCum <= 90) clase = 'B';

    return {
      ...item,
      precioPromedio: item.cantidad > 0 ? Math.round(item.ventas / item.cantidad) : null,
      pct:    Math.round(pct    * 100) / 100,
      pctCum: Math.round(pctCum * 100) / 100,
      clase,
    };
  });

  // Conteo por clase
  const conteo = { A: 0, B: 0, C: 0 };
  const ventasPorClase = { A: 0, B: 0, C: 0 };
  classified.forEach(i => {
    conteo[i.clase]++;
    ventasPorClase[i.clase] += i.ventas;
  });

  return { items: classified, total, conteo, ventasPorClase };
}

// ── Categorías ─────────────────────────────────────────────────────────────────
function buildCategories(records, metric = 'ventas') {
  const key = metric === 'cantidad' ? 'cantidad' : 'ventas';

  const map = {};
  for (const r of records) {
    const cat = r.categoria || 'Sin categoría';
    if (!map[cat]) {
      map[cat] = { nombre: cat, ventas: 0, cantidad: 0, items: new Set() };
    }
    map[cat].ventas   += r.dinero || 0;
    map[cat].cantidad += r.cant   || 0;
    map[cat].items.add(r.producto);
  }

  const cats = Object.values(map).map((c, i) => ({
    nombre:   c.nombre,
    ventas:   c.ventas,
    cantidad: c.cantidad,
    items:    c.items.size,
    color:    CAT_COLORS[i % CAT_COLORS.length],
  }));

  cats.sort((a, b) => b[key] - a[key]);

  const total = cats.reduce((s, c) => s + c[key], 0);
  return cats.map(c => ({
    ...c,
    pct: total > 0 ? Math.round((c[key] / total) * 1000) / 10 : 0,
  }));
}

// ── Evolución mensual ──────────────────────────────────────────────────────────
function buildEvolucion(records) {
  const map = {};
  for (const r of records) {
    if (!r.ano || !r.mes) continue;
    const key = `${r.ano}-${String(MES_ORDER.indexOf(r.mes)).padStart(2, '0')}`;
    if (!map[key]) map[key] = { ano: r.ano, mes: r.mes, ventas: 0, cantidad: 0 };
    map[key].ventas   += r.dinero || 0;
    map[key].cantidad += r.cant   || 0;
  }

  const sorted = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  return {
    labels:   sorted.map(d => `${d.mes.slice(0, 3)} ${d.ano}`),
    ventas:   sorted.map(d => d.ventas),
    cantidad: sorted.map(d => d.cantidad),
  };
}

// ── Top items enriquecidos ─────────────────────────────────────────────────────
function buildTopItems(records, n = 30) {
  const { items } = buildPareto(records, 'ventas');
  return items.slice(0, n);
}

module.exports = {
  filterRecords,
  buildSummary,
  buildPareto,
  buildCategories,
  buildEvolucion,
  buildTopItems,
  MES_ORDER,
};
