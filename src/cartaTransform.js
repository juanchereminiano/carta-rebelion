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
// Soporta parámetros simples (ano/mes string) y arrays (anos/meses/categorias/productos)
function filterRecords(records, filters = {}) {
  const { anos, meses, categorias, productos, ano, mes } = filters;

  // Normalizar a arrays (null = sin filtro activo)
  const anosArr = anos && !anos.includes('all') ? anos.map(String)
                : (ano && ano !== 'all' ? [String(ano)] : null);
  const mesesArr = meses && !meses.includes('all') ? meses.map(m => m.toUpperCase())
                 : (mes && mes !== 'all' ? [mes.toUpperCase()] : null);
  const catArr  = categorias && !categorias.includes('all') ? categorias : null;
  const prodArr = productos  && !productos.includes('all')  ? productos  : null;

  return records.filter(r => {
    if (anosArr  && !anosArr.includes(String(r.ano)))  return false;
    if (mesesArr && !mesesArr.includes(r.mes))         return false;
    if (catArr   && !catArr.includes(r.categoria))     return false;
    if (prodArr  && !prodArr.includes(r.producto))     return false;
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

// ── Matriz BCG adaptada — participación interna + crecimiento YoY ─────────────
//
// NOTA METODOLÓGICA:
// La BCG clásica usa share de mercado externo (vs competidores) y crecimiento del
// mercado (industria). Sin esos datos, esta es una adaptación para análisis interno:
//
//   Eje X — % de participación en ventas totales del período más reciente
//            Umbral: promedio simple (100% / n_productos).
//            Un producto "encima" del promedio tiene alta participación relativa.
//
//   Eje Y — Crecimiento YoY: (ventas último año - ventas año anterior) / ventas año anterior
//            Umbral: 0% (creciendo vs cayendo).
//            Para productos sin año anterior, growth = null (aparecen en el eje).
//
// Esto permite clasificar la carta con los datos disponibles de forma honesta.
//
function buildBCGData(records) {
  const años = [...new Set(records.map(r => r.ano).filter(Boolean))].sort();
  const hasMultiYear = años.length >= 2;
  const lastYear = años[años.length - 1];
  const prevYear = hasMultiYear ? años[años.length - 2] : null;

  // Agrupar por producto + año
  const byProduct = {};
  for (const r of records) {
    if (!r.producto || !r.ano) continue;
    if (!byProduct[r.producto])
      byProduct[r.producto] = { categoria: r.categoria || '—', byYear: {} };
    if (!byProduct[r.producto].byYear[r.ano])
      byProduct[r.producto].byYear[r.ano] = { ventas: 0, cantidad: 0 };
    byProduct[r.producto].byYear[r.ano].ventas   += r.dinero || 0;
    byProduct[r.producto].byYear[r.ano].cantidad += r.cant   || 0;
  }

  // Construir lista con ventas del último año y crecimiento YoY
  const items = [];
  for (const [producto, data] of Object.entries(byProduct)) {
    const curr = data.byYear[lastYear];
    if (!curr || curr.ventas === 0) continue;      // excluir sin ventas recientes

    const prev   = prevYear ? data.byYear[prevYear] : null;
    const growth = prev && prev.ventas > 0
      ? ((curr.ventas - prev.ventas) / prev.ventas) * 100
      : null;   // null = sin comparación disponible

    items.push({
      producto,
      categoria:  data.categoria,
      ventas:     curr.ventas,
      cantidad:   curr.cantidad,
      prevVentas: prev?.ventas || 0,
      growth,
    });
  }

  if (items.length === 0) return [];

  // ── Eje X: % de participación sobre el total de ventas del último año ────
  const totalVentas = items.reduce((s, i) => s + i.ventas, 0);
  // Umbral = participación promedio simple (si todos fueran iguales)
  const avgShare = items.length > 0 ? 100 / items.length : 0;

  // ── Eje Y: mediana de growth (para productos sin YoY, usamos 0) ──────────
  const growthsKnown = items.map(i => i.growth).filter(g => g !== null).sort((a, b) => a - b);
  // Umbral de crecimiento = 0% (creciendo vs cayendo)
  const growthThreshold = 0;

  return items.map(item => {
    const pctShare = totalVentas > 0 ? (item.ventas / totalVentas) * 100 : 0;
    const g        = item.growth ?? 0;  // null → 0 para graficarlo en el eje

    let cuadrante;
    const highShare  = pctShare >= avgShare;
    const highGrowth = g >= growthThreshold;

    if      ( highShare &&  highGrowth) cuadrante = 'Estrella';
    else if ( highShare && !highGrowth) cuadrante = 'Vaca';
    else if (!highShare &&  highGrowth) cuadrante = 'Interrogante';
    else                                cuadrante = 'Perro';

    return {
      ...item,
      pctShare:        Math.round(pctShare * 100) / 100,   // % sobre total ventas
      avgShare:        Math.round(avgShare  * 100) / 100,   // umbral (promedio)
      growth:          Math.round(g         * 10)  / 10,
      growthRaw:       item.growth,                          // null si no hay YoY
      cuadrante,
      hasYoY:          item.growth !== null,
    };
  });
}

// ── Evolución por producto (para Seguimiento) ──────────────────────────────────
// records: ya filtrados por año/mes
// productos: watchlist (array de nombres)
function buildProductEvolucion(records, productos = []) {
  const prodSet = new Set(productos.filter(p => p && p !== 'all'));

  // ── 1. Ranking global — sobre TODOS los productos del período ────────────
  const globalTotals = {};  // producto → { ventas, cantidad, categoria }
  for (const r of records) {
    if (!r.producto) continue;
    if (!globalTotals[r.producto])
      globalTotals[r.producto] = { ventas: 0, cantidad: 0, categoria: r.categoria || '—' };
    globalTotals[r.producto].ventas   += r.dinero || 0;
    globalTotals[r.producto].cantidad += r.cant   || 0;
  }

  // Ordenar por ventas para asignar rank
  const globalRanking = Object.entries(globalTotals)
    .sort((a, b) => b[1].ventas - a[1].ventas);

  const totalVentasGlobal   = globalRanking.reduce((s, [, d]) => s + d.ventas,   0);
  const totalCantidadGlobal = globalRanking.reduce((s, [, d]) => s + d.cantidad, 0);
  const totalProductos      = globalRanking.length;

  // Mapa producto → { rankVentas, rankCantidad, pctVentas, pctCantidad }
  const rankMap = {};
  globalRanking.forEach(([prod, d], idx) => {
    rankMap[prod] = {
      rankVentas:   idx + 1,
      pctVentas:    totalVentasGlobal   > 0 ? (d.ventas   / totalVentasGlobal)   * 100 : 0,
      pctCantidad:  totalCantidadGlobal > 0 ? (d.cantidad / totalCantidadGlobal) * 100 : 0,
    };
  });
  // Ranking por cantidad (separado)
  const byQty = Object.entries(globalTotals).sort((a, b) => b[1].cantidad - a[1].cantidad);
  byQty.forEach(([prod], idx) => { if (rankMap[prod]) rankMap[prod].rankCantidad = idx + 1; });

  // ── 2. Serie temporal — solo para los productos del watchlist ────────────
  const filtered = prodSet.size > 0 ? records.filter(r => prodSet.has(r.producto)) : records;

  const byProd  = {};
  const timeMap = {};

  for (const r of filtered) {
    if (!r.producto || !r.ano || !r.mes) continue;
    const tKey = `${r.ano}-${String(MES_ORDER.indexOf(r.mes)).padStart(2, '0')}`;
    timeMap[tKey] = { ano: r.ano, mes: r.mes };
    if (!byProd[r.producto]) byProd[r.producto] = { _categoria: r.categoria || '—' };
    if (!byProd[r.producto][tKey]) byProd[r.producto][tKey] = { ventas: 0, cantidad: 0 };
    byProd[r.producto][tKey].ventas   += r.dinero || 0;
    byProd[r.producto][tKey].cantidad += r.cant   || 0;
  }

  const allKeys = Object.keys(timeMap).sort();
  const labels  = allKeys.map(k => {
    const { ano, mes } = timeMap[k];
    return `${mes.slice(0, 3)} ${ano}`;
  });

  const resultado = {};
  for (const [prod, byKey] of Object.entries(byProd)) {
    const ventasArr   = allKeys.map(k => byKey[k]?.ventas   || 0);
    const cantidadArr = allKeys.map(k => byKey[k]?.cantidad || 0);
    const totalVentas   = ventasArr.reduce((s, v) => s + v, 0);
    const totalCantidad = cantidadArr.reduce((s, v) => s + v, 0);

    // Tendencia: últimos 3 meses vs previos 3
    const last3  = ventasArr.slice(-3).reduce((s, v) => s + v, 0);
    const prev3  = ventasArr.slice(-6, -3).reduce((s, v) => s + v, 0);
    const last3c = cantidadArr.slice(-3).reduce((s, v) => s + v, 0);
    const prev3c = cantidadArr.slice(-6, -3).reduce((s, v) => s + v, 0);

    const rk = rankMap[prod] || { rankVentas: null, rankCantidad: null, pctVentas: 0, pctCantidad: 0 };

    resultado[prod] = {
      ventas: ventasArr, cantidad: cantidadArr,
      totalVentas, totalCantidad,
      trendVentas:    prev3  > 0 ? ((last3  - prev3)  / prev3)  * 100 : null,
      trendCantidad:  prev3c > 0 ? ((last3c - prev3c) / prev3c) * 100 : null,
      categoria:      byKey._categoria || '—',
      precioPromedio: totalCantidad > 0 ? Math.round(totalVentas / totalCantidad) : null,
      // Ranking en el período filtrado
      rankVentas:    rk.rankVentas,
      rankCantidad:  rk.rankCantidad,
      pctVentas:     Math.round(rk.pctVentas   * 10) / 10,
      pctCantidad:   Math.round(rk.pctCantidad * 10) / 10,
      totalProductos,
    };
  }

  return { labels, productos: resultado, totalProductos };
}

module.exports = {
  filterRecords,
  buildSummary,
  buildPareto,
  buildCategories,
  buildEvolucion,
  buildTopItems,
  buildBCGData,
  buildProductEvolucion,
  MES_ORDER,
};
