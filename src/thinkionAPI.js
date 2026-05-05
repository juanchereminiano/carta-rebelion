/**
 * thinkionAPI.js
 * Reemplaza cartaSheets.js y ventasHorariosSheets.js para empresas conectadas
 * a Thinkion (thinkerp.cc).
 *
 * Reportes usados:
 *   320 → productos × día (carta principal)
 *   353 → productos × categoría (lookup — enriquecido con categorías manuales)
 *   294 → hora × día × órdenes (turnos & horarios)
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Constantes de fechas ──────────────────────────────────────────────────────
const MES_NOMBRES = [
  'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE',
];
const DIA_NOMBRES = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'];

// ── Config por empresa ────────────────────────────────────────────────────────
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── HTTP helper con reintentos y backoff ──────────────────────────────────────
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
      timeout: 30000,
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode === 429) {
          // Devolvemos un objeto especial para que thinkionRequest haga retry
          return resolve({ __rateLimit: true, retryAfter: parseInt(res.headers['retry-after'] || '10') });
        }
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
 * Llama a un reporte paginando automáticamente.
 * Reintenta automáticamente en caso de 429 con backoff exponencial.
 */
async function thinkionRequest(code, token, payload, retries = 5) {
  const allData = [];
  let pageToken = null;
  let attempts  = 0;

  do {
    if (attempts++ > 50) break; // safety cap

    const body = { ...payload };
    if (pageToken) body.page = pageToken;

    let result;
    let backoff = 5000; // empieza en 5 s

    for (let r = 0; r <= retries; r++) {
      result = await httpPost(`https://${code}.thinkerp.cc/online/reporting/public/`, token, body);
      if (!result.__rateLimit) break;
      const wait = result.retryAfter ? result.retryAfter * 1000 : backoff;
      console.warn(`[Thinkion] 429 rate limit — esperando ${wait / 1000}s (intento ${r + 1}/${retries})`);
      await sleep(wait);
      backoff = Math.min(backoff * 2, 60000); // max 60 s
    }

    if (result.__rateLimit) throw new Error('Thinkion: demasiados intentos con 429');

    (result.data || []).forEach(r => allData.push(r));
    pageToken = (result.page && result.page !== false) ? result.page : null;
  } while (pageToken);

  return allData;
}

/**
 * Ejecuta tasks de forma estrictamente secuencial con pausa entre cada una.
 * Thinkion devuelve data:[] vacío (sin 429) cuando la saturamos — la única
 * forma de evitarlo es ir de a uno con suficiente espacio entre requests.
 */
async function pooled(tasks, _limit, delayMs = 1500) {
  const results = [];
  for (let idx = 0; idx < tasks.length; idx++) {
    try {
      const rows = await tasks[idx]();
      results.push(rows);
    } catch (err) {
      console.error(`[Thinkion] Error en chunk ${idx} (no fatal):`, err.message);
      results.push([]);
    }
    if (idx < tasks.length - 1) await sleep(delayMs);
  }
  return results.flat();
}

// ── Categorías manuales ───────────────────────────────────────────────────────
/**
 * Carga el archivo data/categorias-{empresaId}.json si existe.
 * Formato: { "123": "BEBIDAS", "456": "COCINA", ... }  (id_product → categoria)
 * También acepta nombre de producto como clave para mayor facilidad:
 * { "COCA COLA": "BEBIDAS" }
 * Las claves numéricas tienen prioridad sobre las de texto.
 */
function loadManualCategories(empresaId) {
  const filePath = path.join(__dirname, '..', 'data', `categorias-${empresaId}.json`);
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[Thinkion] No se pudo leer categorías manuales para ${empresaId}:`, e.message);
    return {};
  }
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

  // ── Paso 1: categorías manuales (prioridad máxima) ───────────────────────
  const manualCats = loadManualCategories(empresaId);

  // ── Paso 2: lookup de categorías desde Thinkion (Report 353) ─────────────
  const catRows = await thinkionRequest(code, token, {
    id_report:      353,
    date_init:      chunks[0].date_init,
    date_end:       chunks[0].date_end,
    establishments,
  });

  // Mapa: id_product → categoria (desde Thinkion, como fallback)
  const thinkionCatById = {};
  catRows.forEach(r => {
    if (r.id_product && r.category) thinkionCatById[String(r.id_product)] = r.category;
  });

  // ── Paso 3: ventas por producto × día (Report 320) — todos los meses ─────
  const tasks = chunks.map(chunk => async () => {
    const rows = await thinkionRequest(code, token, {
      id_report:      320,
      date_init:      chunk.date_init,
      date_end:       chunk.date_end,
      establishments,
    });
    console.log(`[Thinkion/${empresaId}] Carta ${chunk.date_init}→${chunk.date_end}: ${rows.length} filas`);
    return rows;
  });

  const rawRows = await pooled(tasks, 3);
  console.log(`[Thinkion/${empresaId}] Total filas carta: ${rawRows.length}`);

  // ── Paso 4: convertir a formato interno ──────────────────────────────────
  const records = [];
  for (const row of rawRows) {
    const parsed = parseDating(row.dating);
    if (!parsed) continue;
    const { year, month1 } = parsed;
    const cant   = parseFloat(row.items) || 0;
    const dinero = parseFloat(row.sale)  || 0;
    if (!row.product || (!cant && !dinero)) continue;

    const idStr = String(row.id_product || '');
    const nombre = (row.product || '').trim().toUpperCase();

    // Prioridad: manual por ID → manual por nombre → Thinkion → vacío
    const categoria =
      manualCats[idStr]  ||
      manualCats[nombre] ||
      thinkionCatById[idStr] ||
      '';

    records.push({
      ano:           year,
      mes:           MES_NOMBRES[month1 - 1] || 'ENERO',
      categoria,
      codigo:        row.id_product ? parseInt(row.id_product) : null,
      producto:      row.product,
      cant,
      dinero,
      precioPromedio: parseFloat(row.avg_price) || null,
      mix:           '',
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
 */
async function fetchVentasHorariosThinkion(empresaId, monthsBack = 24) {
  const cfg = THINKION_CONFIG[empresaId];
  if (!cfg) throw new Error(`Empresa "${empresaId}" no tiene config Thinkion`);

  const { code, token, establishments } = cfg;
  const chunks = monthChunks(monthsBack);

  const tasks = chunks.map(chunk => async () => {
    const rows = await thinkionRequest(code, token, {
      id_report:      294,
      date_init:      chunk.date_init,
      date_end:       chunk.date_end,
      establishments,
    });
    console.log(`[Thinkion/${empresaId}] Turnos ${chunk.date_init}→${chunk.date_end}: ${rows.length} filas`);
    return rows;
  });

  const rawRows = await pooled(tasks, 3);
  console.log(`[Thinkion/${empresaId}] Total filas turnos: ${rawRows.length}`);

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

// ── Export de reporte de productos sin categoría ──────────────────────────────
/**
 * Devuelve la lista de productos únicos con su id y categoria actual.
 * Útil para generar el archivo de categorías manuales.
 */
async function reporteProductosSinCategoria(empresaId) {
  const cfg = THINKION_CONFIG[empresaId];
  if (!cfg) throw new Error(`Empresa "${empresaId}" no tiene config Thinkion`);

  const { code, token, establishments } = cfg;
  const chunks = monthChunks(3); // últimos 3 meses alcanza para el catálogo

  const manualCats = loadManualCategories(empresaId);

  const catRows = await thinkionRequest(code, token, {
    id_report: 353,
    date_init: chunks[chunks.length - 1].date_init,
    date_end:  chunks[0].date_end,
    establishments,
  });

  const productos = {};
  catRows.forEach(r => {
    if (!r.id_product) return;
    const idStr  = String(r.id_product);
    const nombre = (r.name || r.product || '').trim().toUpperCase();
    const catThinkion = r.category || '';
    const catManual   = manualCats[idStr] || manualCats[nombre] || '';
    productos[idStr] = {
      id:             idStr,
      nombre,
      categoriaThinkion: catThinkion,
      categoriaManual:   catManual,
      categoriaFinal:    catManual || catThinkion || '— sin categoría —',
    };
  });

  return Object.values(productos).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  fetchCartaDataThinkion,
  fetchVentasHorariosThinkion,
  reporteProductosSinCategoria,
  THINKION_CONFIG,
};
