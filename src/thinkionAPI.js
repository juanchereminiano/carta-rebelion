/**
 * thinkionAPI.js
 * Reemplaza cartaSheets.js y ventasHorariosSheets.js para empresas conectadas
 * a Thinkion (thinkerp.cc).
 *
 * Estrategia de persistencia:
 *   - Meses CERRADOS (anteriores al mes actual) → guardados en JSON en disco.
 *     Una vez descargados, nunca vuelven a consultarse a Thinkion.
 *   - Mes ACTUAL → siempre fresco desde Thinkion (cambia a diario).
 *
 * Reportes usados:
 *   320 → productos × día (carta principal)
 *   353 → productos × categoría (lookup)
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

// ── Directorio de caché persistente ──────────────────────────────────────────
// En Railway: configurá THINKION_DATA_DIR al mount path del volume (ej: /data)
// En local:   usa ./data/thinkion-cache
const DATA_DIR = process.env.THINKION_DATA_DIR
  || path.join(__dirname, '..', 'data', 'thinkion-cache');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Ruta del archivo de caché para una empresa + reporte + mes */
function cacheFile(empresaId, report, yearMonth) {
  const dir = path.join(DATA_DIR, empresaId);
  ensureDir(dir);
  return path.join(dir, `${report}-${yearMonth}.json`);
}

function readCache(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

function writeCache(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data), 'utf8'); }
  catch (e) { console.warn('[Thinkion] No se pudo escribir caché:', e.message); }
}

// ── Config por empresa ────────────────────────────────────────────────────────
const THINKION_CONFIG = {
  rebelion: {
    code:           'reb9',
    token:          process.env.THINKION_TOKEN_REBELION
                    || '55c0065e22774ec9fd13b587f43c8a94-999ea38ca43859e3af58269538f7c4e1-3e1a26e7ebdb1bd4886c9cfd5973f1da',
    establishments: [1],
  },
  trenquecraft: {
    code:           'tre9',
    token:          process.env.THINKION_TOKEN_TRENQUECRAFT
                    || '704575c0114c0ae51104b4712666e899-2b213d42f927c611d1c80fb871198384-4b882b11452f812b4b6dc5f5b0397c54',
    establishments: [1],
  },
  temple: {
    code:           'tem9',
    token:          process.env.THINKION_TOKEN_TEMPLE
                    || 'a1734b322a79b5bfb6056e3a09d1c21b-f812f0b8965da81cc64414ebdf82eef0-8856ed7f2de7301fa4fee1b420689afd',
    establishments: [3],
  },
  casatemple: {
    code:           'tem9',
    token:          process.env.THINKION_TOKEN_TEMPLE
                    || 'a1734b322a79b5bfb6056e3a09d1c21b-f812f0b8965da81cc64414ebdf82eef0-8856ed7f2de7301fa4fee1b420689afd',
    establishments: [8],
  },
};

// ── Helpers de fecha ──────────────────────────────────────────────────────────
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function yearMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

/**
 * Devuelve los chunks de los últimos N meses.
 * Marca cada chunk como "cerrado" si el mes ya terminó (no es el mes actual).
 */
function monthChunks(monthsBack = 24) {
  const chunks = [];
  const now    = new Date();
  const currentYM  = yearMonth(now);
  const previousYM = yearMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  // Un mes se considera "cerrado" (cacheable) recién el día 6 del mes siguiente.
  // Antes del día 6 el mes anterior todavía puede tener mesas abiertas.
  const prevMonthSafe = now.getDate() >= 6;

  for (let i = 0; i < monthsBack; i++) {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const lastDay  = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const end      = lastDay > now ? now : lastDay;
    if (firstDay > now) continue;
    const ym = yearMonth(firstDay);

    // Cerrado = no es el mes actual, Y si es el mes anterior solo si ya pasó el día 5
    const closed = ym !== currentYM && !(ym === previousYM && !prevMonthSafe);

    chunks.push({
      date_init: fmtDate(firstDay),
      date_end:  fmtDate(end),
      yearMonth: ym,
      closed,
    });
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
      timeout: 30000,
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode === 429) {
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
 * Reintenta si recibe 429 explícito.
 */
async function thinkionRequest(code, token, payload, retries = 5) {
  const allData = [];
  let pageToken = null;
  let attempts  = 0;

  do {
    if (attempts++ > 50) break;
    const body = { ...payload };
    if (pageToken) body.page = pageToken;

    let result;
    let backoff = 5000;

    for (let r = 0; r <= retries; r++) {
      result = await httpPost(`https://${code}.thinkerp.cc/online/reporting/public/`, token, body);
      if (!result.__rateLimit) break;
      const wait = result.retryAfter ? result.retryAfter * 1000 : backoff;
      console.warn(`[Thinkion] 429 — esperando ${wait / 1000}s (intento ${r + 1}/${retries})`);
      await sleep(wait);
      backoff = Math.min(backoff * 2, 60000);
    }

    if (result.__rateLimit) throw new Error('Thinkion: demasiados intentos con 429');

    (result.data || []).forEach(r => allData.push(r));
    pageToken = (result.page && result.page !== false) ? result.page : null;
  } while (pageToken);

  return allData;
}

/**
 * Fetch de un chunk con caché persistente.
 * - Si el chunk está cerrado y ya está en disco → devuelve disco (sin llamar a Thinkion)
 * - Si el chunk está cerrado y NO está en disco → llama a Thinkion, guarda en disco
 * - Si el chunk es el mes actual → siempre llama a Thinkion (datos del día)
 */
async function fetchChunkCached(empresaId, report, chunk, fetcher) {
  if (chunk.closed) {
    const file   = cacheFile(empresaId, report, chunk.yearMonth);
    const cached = readCache(file);
    if (cached !== null) {
      console.log(`[Thinkion/${empresaId}] R${report} ${chunk.yearMonth}: cache local (${cached.length} filas)`);
      return cached;
    }
  }

  // Hay que buscar en Thinkion
  let rows;
  try {
    rows = await fetcher();
  } catch (err) {
    console.error(`[Thinkion/${empresaId}] R${report} ${chunk.yearMonth}: error — ${err.message}`);
    return [];
  }

  const label = chunk.closed ? 'nuevo→guardado' : 'mes actual';
  console.log(`[Thinkion/${empresaId}] R${report} ${chunk.yearMonth}: ${rows.length} filas (${label})`);

  // Solo guardar en disco si el mes está cerrado y vino con datos
  if (chunk.closed && rows.length > 0) {
    writeCache(cacheFile(empresaId, report, chunk.yearMonth), rows);
  }

  return rows;
}

// ── Categorías manuales ───────────────────────────────────────────────────────
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
async function fetchCartaDataThinkion(empresaId, monthsBack = 24) {
  const cfg = THINKION_CONFIG[empresaId];
  if (!cfg) throw new Error(`Empresa "${empresaId}" no tiene config Thinkion`);

  const { code, token, establishments } = cfg;
  const chunks = monthChunks(monthsBack);

  // ── Categorías manuales (prioridad máxima) ────────────────────────────────
  const manualCats = loadManualCategories(empresaId);

  // ── Lookup de categorías desde Thinkion (Report 353, solo mes actual) ─────
  const currentChunk = chunks.find(c => !c.closed) || chunks[0];
  const catRows = await thinkionRequest(code, token, {
    id_report:      353,
    date_init:      currentChunk.date_init,
    date_end:       currentChunk.date_end,
    establishments,
  });
  const thinkionCatById = {};
  catRows.forEach(r => {
    if (r.id_product && r.category) thinkionCatById[String(r.id_product)] = r.category;
  });

  // ── Ventas por producto × día (Report 320) ────────────────────────────────
  const allRows = [];
  for (const chunk of chunks) {
    const rows = await fetchChunkCached(empresaId, 320, chunk, () =>
      thinkionRequest(code, token, {
        id_report:      320,
        date_init:      chunk.date_init,
        date_end:       chunk.date_end,
        establishments,
      })
    );
    allRows.push(...rows);
    // Pausa solo si vamos a Thinkion (mes actual o primera vez del cerrado)
    // La pausa está implícita: fetchChunkCached es secuencial
    if (!chunk.closed) await sleep(800);
  }

  console.log(`[Thinkion/${empresaId}] Total carta: ${allRows.length} filas`);

  // ── Convertir a formato interno ───────────────────────────────────────────
  const records = [];
  for (const row of allRows) {
    const parsed = parseDating(row.dating);
    if (!parsed) continue;
    const { year, month1 } = parsed;
    const cant   = parseFloat(row.items) || 0;
    const dinero = parseFloat(row.sale)  || 0;
    if (!row.product || (!cant && !dinero)) continue;

    const idStr  = String(row.id_product || '');
    const nombre = (row.product || '').trim().toUpperCase();

    const categoria =
      manualCats[idStr]  ||
      manualCats[nombre] ||
      thinkionCatById[idStr] ||
      '';

    records.push({
      ano:            year,
      mes:            MES_NOMBRES[month1 - 1] || 'ENERO',
      categoria,
      codigo:         row.id_product ? parseInt(row.id_product) : null,
      producto:       row.product,
      cant,
      dinero,
      precioPromedio: parseFloat(row.avg_price) || null,
      mix:            '',
    });
  }

  return {
    records,
    sheetName:  `Thinkion/${empresaId}`,
    allSheets:  [`thinkion-${THINKION_CONFIG[empresaId].code}`],
  };
}

// ── Turnos & Horarios data ────────────────────────────────────────────────────
async function fetchVentasHorariosThinkion(empresaId, monthsBack = 24) {
  const cfg = THINKION_CONFIG[empresaId];
  if (!cfg) throw new Error(`Empresa "${empresaId}" no tiene config Thinkion`);

  const { code, token, establishments } = cfg;
  const chunks = monthChunks(monthsBack);

  const allRows = [];
  for (const chunk of chunks) {
    const rows = await fetchChunkCached(empresaId, 294, chunk, () =>
      thinkionRequest(code, token, {
        id_report:      294,
        date_init:      chunk.date_init,
        date_end:       chunk.date_end,
        establishments,
      })
    );
    allRows.push(...rows);
    if (!chunk.closed) await sleep(800);
  }

  console.log(`[Thinkion/${empresaId}] Total turnos: ${allRows.length} filas`);

  const records = [];
  for (const row of allRows) {
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

// ── Reporte de productos para mapeo de categorías ─────────────────────────────
async function reporteProductosSinCategoria(empresaId) {
  const cfg = THINKION_CONFIG[empresaId];
  if (!cfg) throw new Error(`Empresa "${empresaId}" no tiene config Thinkion`);

  const { code, token, establishments } = cfg;
  const chunks = monthChunks(3);
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
    const idStr       = String(r.id_product);
    const nombre      = (r.name || r.product || '').trim().toUpperCase();
    const catThinkion = r.category || '';
    const catManual   = manualCats[idStr] || manualCats[nombre] || '';
    productos[idStr]  = {
      id: idStr, nombre,
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
