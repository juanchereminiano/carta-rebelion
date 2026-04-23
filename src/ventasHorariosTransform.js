const MES_ORDER = [
  'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE',
];
const DIA_ORDER = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'];

// ── Filtrado ─────────────────────────────────────────────────────────────────
function filterVentas(records, { anos, meses, dias, turno }) {
  return records.filter(r => {
    if (!anos.includes('all')  && !anos.includes(String(r.año)))      return false;
    if (!meses.includes('all') && !meses.includes(r.mesNombre))       return false;
    if (!dias.includes('all')  && !dias.includes(r.diaSemana))        return false;
    if (turno !== 'all'        && r.turno !== turno)                   return false;
    return true;
  });
}

// ── Estadísticas por hora ─────────────────────────────────────────────────────
function buildHourlyStats(records) {
  const map = new Map();

  for (const r of records) {
    if (!map.has(r.hora)) {
      map.set(r.hora, { ventaTotal: 0, ordenTotal: 0, count: 0, turno: r.turno });
    }
    const entry = map.get(r.hora);
    entry.ventaTotal += r.venta;
    entry.ordenTotal += r.orden;
    entry.count      += 1;
  }

  const result = [];
  for (const [hora, entry] of map) {
    result.push({
      hora,
      label:      String(hora).padStart(2, '0') + ':00',
      ventaTotal: entry.ventaTotal,
      ventaAvg:   entry.count > 0 ? entry.ventaTotal / entry.count : 0,
      ordenTotal: entry.ordenTotal,
      ordenAvg:   entry.count > 0 ? entry.ordenTotal / entry.count : 0,
      count:      entry.count,
      turno:      (hora >= 7 && hora <= 16) ? 'DIA' : 'NOCHE',
    });
  }

  result.sort((a, b) => a.hora - b.hora);
  return result;
}

// ── Evolución mensual DIA vs NOCHE ────────────────────────────────────────────
function buildShiftEvolucion(records) {
  // Agrupar por period (año-mes) y turno
  const map = new Map();

  for (const r of records) {
    const period = `${r.año}-${String(r.mes).padStart(2, '0')}`;
    if (!map.has(period)) {
      map.set(period, {
        period,
        año:      r.año,
        mes:      r.mes,
        mesNombre: r.mesNombre,
        DIA:   0,
        NOCHE: 0,
      });
    }
    const entry = map.get(period);
    entry[r.turno] += r.venta;
  }

  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
}

// ── Mapa de calor ─────────────────────────────────────────────────────────────
function buildHeatmap(records) {
  // Paso 1: sumar venta por (fecha, mesNombre, diaSemana) → total del día
  const dayMap = new Map();

  for (const r of records) {
    const key = `${r.fecha}|${r.mesNombre}|${r.diaSemana}`;
    if (!dayMap.has(key)) {
      dayMap.set(key, {
        fecha:       r.fecha,
        mesNombre:   r.mesNombre,
        mesIdx:      r.mesIdx,
        diaSemana:   r.diaSemana,
        diaSemanaIdx: r.diaSemanaIdx,
        ventaTotal:  0,
      });
    }
    dayMap.get(key).ventaTotal += r.venta;
  }

  // Paso 2: agrupar por (mesNombre, diaSemana) → promedio de ventaTotal
  const groupMap = new Map();

  for (const day of dayMap.values()) {
    const key = `${day.mesNombre}|${day.diaSemana}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        mesNombre:   day.mesNombre,
        mesIdx:      day.mesIdx,
        diaSemana:   day.diaSemana,
        diaSemanaIdx: day.diaSemanaIdx,
        sum:   0,
        count: 0,
      });
    }
    const entry = groupMap.get(key);
    entry.sum   += day.ventaTotal;
    entry.count += 1;
  }

  return [...groupMap.values()].map(e => ({
    mesNombre:   e.mesNombre,
    mesIdx:      e.mesIdx,
    diaSemana:   e.diaSemana,
    diaSemanaIdx: e.diaSemanaIdx,
    avgVenta: e.count > 0 ? e.sum / e.count : 0,
    count:    e.count,
  }));
}

// ── KPIs de turnos ────────────────────────────────────────────────────────────
function buildTurnosKPIs(records) {
  let totalVenta = 0, totalDia = 0, totalNoche = 0, totalOrdenes = 0;

  const horaMap = new Map();
  const diaMap  = new Map();

  for (const r of records) {
    totalVenta  += r.venta;
    totalOrdenes += r.orden;

    if (r.turno === 'DIA')   totalDia   += r.venta;
    else                      totalNoche += r.venta;

    // Por hora
    if (!horaMap.has(r.hora)) horaMap.set(r.hora, 0);
    horaMap.set(r.hora, horaMap.get(r.hora) + r.venta);

    // Por día de semana
    if (!diaMap.has(r.diaSemana)) diaMap.set(r.diaSemana, 0);
    diaMap.set(r.diaSemana, diaMap.get(r.diaSemana) + r.venta);
  }

  let bestHora = null;
  if (horaMap.size > 0) {
    const [hora, ventaTotal] = [...horaMap.entries()].sort((a, b) => b[1] - a[1])[0];
    bestHora = { hora, label: String(hora).padStart(2, '0') + ':00', ventaTotal };
  }

  let bestDia = null;
  if (diaMap.size > 0) {
    const [diaSemana, ventaTotal] = [...diaMap.entries()].sort((a, b) => b[1] - a[1])[0];
    bestDia = { diaSemana, ventaTotal };
  }

  const pctDia   = totalVenta > 0 ? parseFloat(((totalDia   / totalVenta) * 100).toFixed(1)) : 0;
  const pctNoche = totalVenta > 0 ? parseFloat(((totalNoche / totalVenta) * 100).toFixed(1)) : 0;

  return {
    totalVenta,
    totalDia,
    totalNoche,
    pctDia,
    pctNoche,
    bestHora,
    bestDia,
    totalOrdenes,
  };
}

// ── Estaciones del año (Argentina) ───────────────────────────────────────────
const SEASON_DEF = {
  VERANO:    { label: 'Verano',    emoji: '🌞', meses: [12,1,2]  },
  OTOÑO:     { label: 'Otoño',     emoji: '🍂', meses: [3,4,5]   },
  INVIERNO:  { label: 'Invierno',  emoji: '❄️',  meses: [6,7,8]   },
  PRIMAVERA: { label: 'Primavera', emoji: '🌸', meses: [9,10,11] },
};
const SEASON_ORDER = ['VERANO','OTOÑO','INVIERNO','PRIMAVERA'];

function getSeason(mes) {
  if ([12,1,2].includes(mes))  return 'VERANO';
  if ([3,4,5].includes(mes))   return 'OTOÑO';
  if ([6,7,8].includes(mes))   return 'INVIERNO';
  return 'PRIMAVERA';
}

function buildSeasonStats(records) {
  const acc = {};
  for (const key of SEASON_ORDER) {
    acc[key] = { venta: 0, ordenes: 0, dias: new Set() };
  }

  for (const r of records) {
    const s = getSeason(r.mes);
    acc[s].venta   += r.venta;
    acc[s].ordenes += r.orden;
    acc[s].dias.add(r.fecha);
  }

  const result = {};
  const totalVenta = Object.values(acc).reduce((s, a) => s + a.venta, 0);

  for (const key of SEASON_ORDER) {
    const a = acc[key];
    const dias = a.dias.size;
    result[key] = {
      key,
      label:      SEASON_DEF[key].label,
      emoji:      SEASON_DEF[key].emoji,
      venta:      a.venta,
      ordenes:    a.ordenes,
      dias,
      ventaDia:   dias > 0 ? a.venta   / dias : 0,
      ordenesDia: dias > 0 ? a.ordenes / dias : 0,
      ticketProm: a.ordenes > 0 ? a.venta / a.ordenes : 0,
      pctTotal:   totalVenta > 0 ? parseFloat((a.venta / totalVenta * 100).toFixed(1)) : 0,
    };
  }
  return result;
}

// ── Estadísticas por día de semana ────────────────────────────────────────────
function buildWeekdayStats(records) {
  // Paso 1: total por (fecha, diaSemana)
  const dayMap = new Map();
  for (const r of records) {
    const key = `${r.fecha}|${r.diaSemana}`;
    if (!dayMap.has(key)) {
      dayMap.set(key, { diaSemana: r.diaSemana, diaSemanaIdx: r.diaSemanaIdx, venta: 0, ordenes: 0 });
    }
    const e = dayMap.get(key);
    e.venta   += r.venta;
    e.ordenes += r.orden;
  }

  // Paso 2: promedio por diaSemana
  const wMap = new Map();
  for (const d of dayMap.values()) {
    if (!wMap.has(d.diaSemana)) {
      wMap.set(d.diaSemana, { diaSemana: d.diaSemana, diaSemanaIdx: d.diaSemanaIdx, sumVenta: 0, sumOrdenes: 0, count: 0 });
    }
    const e = wMap.get(d.diaSemana);
    e.sumVenta   += d.venta;
    e.sumOrdenes += d.ordenes;
    e.count++;
  }

  const totalVenta   = [...wMap.values()].reduce((s, e) => s + e.sumVenta,   0);
  const totalOrdenes = [...wMap.values()].reduce((s, e) => s + e.sumOrdenes, 0);

  const rows = [];
  for (const e of wMap.values()) {
    rows.push({
      diaSemana:    e.diaSemana,
      diaSemanaIdx: e.diaSemanaIdx,
      avgVenta:     e.count > 0 ? e.sumVenta   / e.count : 0,
      avgOrdenes:   e.count > 0 ? e.sumOrdenes / e.count : 0,
      ticketProm:   e.sumOrdenes > 0 ? e.sumVenta / e.sumOrdenes : 0,
      pctVenta:     totalVenta   > 0 ? parseFloat((e.sumVenta   / totalVenta   * 100).toFixed(1)) : 0,
      pctOrdenes:   totalOrdenes > 0 ? parseFloat((e.sumOrdenes / totalOrdenes * 100).toFixed(1)) : 0,
      count:        e.count,
    });
  }

  return rows.sort((a, b) => a.diaSemanaIdx - b.diaSemanaIdx);
}

// ── Catálogo ──────────────────────────────────────────────────────────────────
function buildCatalog(records) {
  const anosSet  = new Set();
  const mesesSet = new Set();
  const diasSet  = new Set();

  for (const r of records) {
    anosSet.add(String(r.año));
    mesesSet.add(r.mesNombre);
    diasSet.add(r.diaSemana);
  }

  const anos  = [...anosSet].sort();
  const meses = MES_ORDER.filter(m => mesesSet.has(m));
  const dias  = DIA_ORDER.filter(d => diasSet.has(d));

  return { anos, meses, dias };
}

module.exports = {
  filterVentas,
  buildHourlyStats,
  buildShiftEvolucion,
  buildHeatmap,
  buildTurnosKPIs,
  buildSeasonStats,
  buildWeekdayStats,
  buildCatalog,
};
