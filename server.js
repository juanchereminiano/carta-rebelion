require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const https     = require('https');
const NodeCache = require('node-cache');

const { fetchCartaData }  = require('./src/cartaSheets');
const {
  filterRecords,
  buildSummary,
  buildPareto,
  buildCategories,
  buildEvolucion,
  buildTopItems,
  buildBCGData,
  buildProductEvolucion,
  buildInflacion,
} = require('./src/cartaTransform');

const app      = express();
const cache    = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 600 });
const ipcCache = new NodeCache({ stdTTL: 12 * 3600 }); // IPC INDEC: cache 12 h

// ── Helper HTTP GET → JSON (sin dependencias extra) ─────────────────────────
function httpsGetJSON(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, res => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirects > 0) {
        req.destroy();
        httpsGetJSON(res.headers.location, redirects - 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} en ${url}`));
        res.resume();
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

// ── IPC INDEC — datos.gob.ar ─────────────────────────────────────────────────
// Series: IPC Nivel General - variación mensual (INDEC)
const IPC_URL = 'https://apis.datos.gob.ar/series/api/series/'
  + '?ids=148.3_INIVELNAL_DICI_M_26'
  + '&limit=200&format=json&sort=asc';

const MES_NAMES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                   'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

async function fetchIPC() {
  const cached = ipcCache.get('ipc');
  if (cached) return cached;

  const json = await httpsGetJSON(IPC_URL);

  const data = (json.data || [])
    .filter(([, v]) => v != null)
    .map(([date, value]) => {
      const d = new Date(date + 'T12:00:00Z');
      const m = d.getUTCMonth(); // 0-11
      return {
        period: `${d.getUTCFullYear()}-${String(m + 1).padStart(2, '0')}`,
        year:   d.getUTCFullYear(),
        month:  m + 1,
        mes:    MES_NAMES[m],
        mom:    parseFloat(value.toFixed(2)),
      };
    });

  ipcCache.set('ipc', data);
  return data;
}

app.use(cors());
app.use(express.static('public'));

async function getData() {
  const cached = cache.get('carta');
  if (cached) return cached;
  const data = await fetchCartaData();
  cache.set('carta', data);
  return data;
}

// Datos del tablero (con filtros opcionales)
// Query params: ?anos=2024,2025  &meses=ENERO,FEBRERO  &categorias=C1,C2  &productos=P1  &metric=ventas|cantidad
app.get('/api/carta', async (req, res) => {
  try {
    const { records } = await getData();
    const metric = req.query.metric || 'ventas';

    // Parsear parámetros — soporta comma-separated arrays
    const parse = (key, legacy) => {
      if (req.query[key])    return req.query[key].split(',').map(s => s.trim());
      if (req.query[legacy]) return [req.query[legacy]];
      return ['all'];
    };
    const anos       = parse('anos', 'ano');
    const meses      = parse('meses', 'mes');
    const categorias = parse('categorias');
    const productos  = parse('productos');

    const filtered = filterRecords(records, { anos, meses, categorias, productos });

    // Catálogo completo (sin filtros) para los dropdowns del cliente
    const allRecords = records;
    const catalog = {
      anos:       [...new Set(allRecords.map(r => r.ano).filter(Boolean))].sort().map(String),
      meses:      [...new Set(allRecords.map(r => r.mes).filter(Boolean))],
      categorias: [...new Set(allRecords.map(r => r.categoria).filter(Boolean))].sort(),
      productos:  buildTopItems(allRecords, 9999).map(i => ({ producto: i.producto, categoria: i.categoria })),
    };

    res.json({
      summary:    buildSummary(filtered),
      pareto:     buildPareto(filtered, metric),
      categorias: buildCategories(filtered, metric),
      evolucion:  buildEvolucion(filtered),
      topItems:   buildTopItems(filtered, 30),
      bcgData:    buildBCGData(records),
      inflacion:  buildInflacion(records),   // sin filtros — historia completa
      catalog,
    });
  } catch (err) {
    console.error('Error /api/carta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Seguimiento — evolución mensual por producto (con filtros propios de año y mes)
app.get('/api/seguimiento', async (req, res) => {
  try {
    const { records } = await getData();
    const productos = req.query.productos ? req.query.productos.split(',').map(s => s.trim()).filter(Boolean) : [];
    const anos      = req.query.anos      ? req.query.anos.split(',').map(s => s.trim())      : ['all'];
    const meses     = req.query.meses     ? req.query.meses.split(',').map(s => s.trim())     : ['all'];

    // Filtrar por año/mes pero NO por categoría/producto globales — solo los del watchlist
    const filtered = filterRecords(records, { anos, meses });
    res.json(buildProductEvolucion(filtered, productos));
  } catch (err) {
    console.error('Error /api/seguimiento:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Info de hojas disponibles (debug)
app.get('/api/meta', async (req, res) => {
  try {
    const { sheetName, allSheets } = await getData();
    res.json({ sheetName, allSheets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// IPC INDEC — datos oficiales (datos.gob.ar)
app.get('/api/ipc', async (req, res) => {
  try {
    const data = await fetchIPC();
    res.json({ ok: true, data, fuente: 'INDEC / datos.gob.ar', serie: '148.3_INIVELNAL_DICI_M_26' });
  } catch (err) {
    console.error('Error /api/ipc:', err.message);
    // Falla silenciosa: devuelve array vacío para no romper el frontend
    res.json({ ok: false, data: [], error: err.message });
  }
});

// Limpiar cache
app.post('/api/refresh', (req, res) => {
  cache.flushAll();
  ipcCache.flushAll();   // también limpia el IPC para forzar refetch
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Carta Rebelión corriendo en http://localhost:${PORT}`);
});
