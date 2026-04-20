require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
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
} = require('./src/cartaTransform');

const app   = express();
const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 60 });

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
      catalog,
    });
  } catch (err) {
    console.error('Error /api/carta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Seguimiento — evolución mensual por producto
app.get('/api/seguimiento', async (req, res) => {
  try {
    const { records } = await getData();
    const productos = req.query.productos ? req.query.productos.split(',').map(s => s.trim()).filter(Boolean) : [];
    res.json(buildProductEvolucion(records, productos));
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

// Limpiar cache
app.post('/api/refresh', (req, res) => {
  cache.flushAll();
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Carta Rebelión corriendo en http://localhost:${PORT}`);
});
