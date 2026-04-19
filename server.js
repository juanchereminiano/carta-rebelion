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
} = require('./src/cartaTransform');

const app   = express();
const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 300 });

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
// Query params: ?ano=2024|all  &mes=ENERO|all  &metric=ventas|cantidad
app.get('/api/carta', async (req, res) => {
  try {
    const { records } = await getData();
    const { ano, mes, metric = 'ventas' } = req.query;
    const filtered = filterRecords(records, { ano, mes });

    res.json({
      summary:    buildSummary(filtered),
      pareto:     buildPareto(filtered, metric),
      categorias: buildCategories(filtered, metric),
      evolucion:  buildEvolucion(filtered),
      topItems:   buildTopItems(filtered, 30),
    });
  } catch (err) {
    console.error('Error /api/carta:', err.message);
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
