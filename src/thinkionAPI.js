/**
 * thinkionAPI.js
 * Reemplaza cartaSheets.js y ventasHorariosSheets.js para empresas conectadas
 * a Thinkion (thinkerp.cc).
 *
 * Reportes usados:
 *   320 → productos × día (carta principal)
 *   353 → productos × categoría (lookup)
 *   294 → hora × día × órdenes (turnos & horarios)
 */

const https = require('https');

// ── Constantes de fechas ──────────────────────────────────────────────────────
const MES_NOMBRES = [
  'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE',
];
const DIA_NOMBRES = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'];

// ── Config por empresa ────────────────────────────────────────────────────────
// Los tokens pueden sobreescribirse por env var; de lo contrario se usan los
// valores provistos por Thinkion.
const THINKION_CONFIG = {
  rebelion: {
    code:           'reb9',
    token:          process.env.THINKION_TOKEN_REBELION
                    || '55c0065e22774ec9fd13b587f43c8a94-999ea38ca43859e3af58269538f7c4e1-3e1a26e7ebdb1bd4886c9cfd5973f1da',
    establishments: [1],   // REBELIÓN SOHO
  },
  trenquecraft: {
    code:           'tre9',
    token:          process.env.THINKION_TOKEN_TRENQUECRAFT
                    || '704575c0114c0ae51104b4712666e899-2b213d42f927c611d1c80fb871198384-4b882b11452f812b4b6dc5f5b0397c54',
    establishments: [1],   // TRENQUECRAFT
  },
  temple: {
    code:           'tem9',
    token:          process.env.THINKION_TOKEN_TEMPLE
                    || 'a1734b322a79b5bfb6056e3a09d1c21b-f812f0b8965da81cc64414ebdf82eef0-8856ed7f2de7301fa4fee1b420689afd',
    establishments: [3],   // SOHO
  },
  casatemple: {
    code:           'tem9',
    token:          process.env.THINKION_TOKEN_TEMPLE
                    || 'a1734b322a79b5bfb6056e3a09d1c21b-f812f0b8965da81cc64414ebdf82eef0-8856ed7f2de7301fa4fee1b420689afd',
    establishments: [8],   // CASA TEMPLE
  },
  // casarebelion → no está en Thinkion, usa Google Sheets (cartaSheets.js)
};

// ── Helpers de fecha ──────────────────────────────────────────────────────────
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Devuelve N meses de chunks (date_init / date_end) hacia atrás desde hoy.
 * La API acepta máx 30 días por llamada, así que usamos meses completos.
 */
function monthChunks(monthsBack = 24) {
  const chunks = [];
  const now    = new Date();
  for (let i = 0; i < monthsBack; i++) {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const lastDay  = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const end      = lastDay > now ? now : lastDay;
    if (firstDay > now) continue;
    chunks.push({ date_init: fmtDate(firstDay), date_end: fmtDate(end) });
  }
  return chunks;
}

/** Parsea "01.01.2025" o "01-01-2025" → { year, month1, day } */
function parseDating(str) {
  if (!str) return null;
  const clean = str.trim().replace(/[\.\-]/g, '/');
  const [d, m, y] = clean.split('/').map(Number);
  if (!d || !m || !y) return null;
  return { year: y, month1: m, day: d };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpPost(url, token, payload) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname,
      method:   'POST',
      headers: {
        'X-Server-Token': token,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 20000,
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('Thinkion: JSON inválido — ' + raw.slice(0, 200))); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Thinkion: timeout')); });
    req.on('error',   reject);
    req.write(body);
    req.end();
  });
}

/**
 * Llama a un reporte paginando automáticamente hasta obtener todos los datos.
 */
async function thinkionRequest(code, token, payload) {
  const allData  = [];
  let pageToken  = null;
  let attempts   = 0;

  do {
    if (attempts++ > 50) break; // safety cap
    const body   = { ...payload };
    if (pageToken) body.page = pageToken;
    const result = await httpPost(`https://${code}.thinkerp.cc/online/reporting/public/`, token, body);
    (result.data || []).forEach(r => allData.push(r));
    pageToken = (result.page && result.page !== false) ? result.page : null;
  } while (pageToken);

  return allData;
}

/**
 * Ejecuta múltiples promises en paralelo con límite de concurrencia.
 */
async function pooled(tasks, limit = 6) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results.flat();
}

// ── Carta data ────────────────────────────────────────────────────────────────

/**
 * Equivalente a fetchCartaData() para empresas Thinkion.
 * Devuelve { records, sheetName, allSheets }
 */
async function fetchCartaDataThinkion(empresaId, monthsBack = 24) {
  const cfg = THINKION_CONFIG[empresaId];
  if (!cfg) throw new Error(`Empresa "${empresaId}" no tiene config Thinkion`);

  const { code, token, establishments } = cfg;
  const chunks = monthChunks(monthsBack);

  // ── Paso 1: lookup de categorías (Report 353 — últimos 30 días) ──────────
  const catRows = await thinkionRequest(code, token, {
    id_report:      353,
    date_init:      chunks[0].date_init,  // mes más reciente
    date_end:       chunks[0].date_end,
    establishments,
  });
  // Mapa: id_product → categoria
  const catMap = {};
  catRows.forEach(r => {
    if (r.id_product && r.category) catMap[String(r.id_product)] = r.category;
  });

  // ── Paso 2: ventas por producto × día (Report 320) — todos los meses ────
  const tasks = chunks.map(chunk => () => thinkionRequest(code, token, {
    id_report:      320,
    date_init:      chunk.date_init,
    date_end:       chunk.date_end,
    establishments,
  }));

  const rawRows = await pooled(tasks, 6);

  // ── Paso 3: convertir a formato interno ──────────────────────────────────
  const records = [];
  for (const row of rawRows) {
    const parsed = parseDating(row.dating);
    if (!parsed) continue;
    const { year, month1 } = parsed;
    const cant   = parseFloat(row.items) || 0;
    const dinero = parseFloat(row.sale)  || 0;
    if (!row.product || (!cant && !dinero)) continue;

    records.push({
      ano:           year,
      mes:           MES_NOMBRES[month1 - 1] || 'ENERO',
      categoria:     catMap[String(row.id_product)] || '',
      codigo:        row.id_product ? parseInt(row.id_product) : null,
      producto:      row.product,
      cant,
      dinero,
      precioPromedio: parseFloat(row.avg_price) || null,
      mix:           '',   // Thinkion no expone mix; se puede enriquecer manualmente
    });
  }

  return {
    records,
    sheetName:  `Thinkion/${empresaId}`,
    allSheets:  [`thinkion-${code}`],
  };
}

// ── Turnos & Horarios data ────────────────────────────────────────────────────

/**
 * Equivalente a fetchVentasHorarios() para empresas Thinkion.
 * Devuelve array de { hora, orden, fecha, año, mes, mesNombre, mesIdx,
 *                     diaSemana, diaSemanaIdx, venta, turno }
 */
async function fetchVentasHorariosThinkion(empresaId, monthsBack = 24) {
  const cfg = THINKION_CONFIG[empresaId];
  if (!cfg) throw new Error(`Empresa "${empresaId}" no tiene config Thinkion`);

  const { code, token, establishments } = cfg;
  const chunks = monthChunks(monthsBack);

  // Report 294: hour_sale, orders, payment, establishment, dating
  const tasks = chunks.map(chunk => () => thinkionRequest(code, token, {
    id_report:      294,
    date_init:      chunk.date_init,
    date_end:       chunk.date_end,
    establishments,
  }));

  const rawRows = await pooled(tasks, 6);

  const records = [];
  for (const row of rawRows) {
    const parsed = parseDating(row.dating);
    if (!parsed) continue;
    const { year, month1, day } = parsed;
    const hora  = parseInt(row.hour_sale, 10);
    const venta = parseFloat(row.payment) || 0;
    const orden = parseInt(row.orders, 10) || 0;

    if (isNaN(hora) || hora < 0 || hora > 23) continue;
    if (!venta && !orden) continue;

    const dateObj      = new Date(year, month1 - 1, day);
    const jsDay        = dateObj.getDay();
    const diaSemanaIdx = jsDay === 0 ? 6 : jsDay - 1;

    records.push({
      hora,
      orden,
      fecha:        `${year}-${String(month1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
      año:          year,
      mes:          month1,
      mesNombre:    MES_NOMBRES[month1 - 1] || 'ENERO',
      mesIdx:       month1 - 1,
      diaSemana:    DIA_NOMBRES[diaSemanaIdx],
      diaSemanaIdx,
      venta,
      turno:        (hora >= 7 && hora <= 16) ? 'DIA' : 'NOCHE',
    });
  }

  return records;
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  fetchCartaDataThinkion,
  fetchVentasHorariosThinkion,
  THINKION_CONFIG,
};
