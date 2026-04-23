require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const https     = require('https');
const path      = require('path');
const session   = require('express-session');
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
const { fetchVentasHorarios } = require('./src/ventasHorariosSheets');
const {
  filterVentas,
  buildHourlyStats,
  buildShiftEvolucion,
  buildHeatmap,
  buildTurnosKPIs,
  buildSeasonStats,
  buildWeekdayStats,
  buildCatalog,
} = require('./src/ventasHorariosTransform');
const auth = require('./src/auth');

const app        = express();
const cache      = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 600 });
const ipcCache   = new NodeCache({ stdTTL: 12 * 3600 }); // IPC INDEC: cache 12 h
const turnosCache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 600 });

// ── Configuración de proxy (Railway usa HTTPS terminado en proxy) ────────────
app.set('trust proxy', 1);

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

  // La serie devuelve el NIVEL del índice (base = 100 en diciembre de algún año),
  // no la variación mensual. Calculamos MoM = (actual / anterior - 1) * 100.
  const raw = (json.data || [])
    .filter(([, v]) => v != null)
    .map(([date, value]) => {
      const d = new Date(date + 'T12:00:00Z');
      const m = d.getUTCMonth(); // 0-11
      return {
        period: `${d.getUTCFullYear()}-${String(m + 1).padStart(2, '0')}`,
        year:   d.getUTCFullYear(),
        month:  m + 1,
        mes:    MES_NAMES[m],
        index:  value,
      };
    });

  // Derivada: % cambio entre meses consecutivos (orden ascendente garantizado por sort=asc)
  const data = raw
    .map((d, i) => ({
      period: d.period,
      year:   d.year,
      month:  d.month,
      mes:    d.mes,
      mom:    i === 0 ? null : parseFloat(((d.index / raw[i - 1].index - 1) * 100).toFixed(2)),
    }))
    .filter(d => d.mom !== null);  // descartamos el primer dato (sin anterior)

  ipcCache.set('ipc', data);
  return data;
}

app.use(cors());
app.use(express.json());

// ── Sesiones ─────────────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'carta-rebelion-dev-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   8 * 3600 * 1000,                          // 8 horas
    secure:   process.env.NODE_ENV === 'production',    // HTTPS en Railway
  },
}));

// ── Middleware de autenticación ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  return res.redirect('/login');
}

// ── Rutas públicas (sin autenticación) ───────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const user = auth.findByEmail(email);
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const ok = await auth.verifyPassword(user, password);
  if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

  req.session.userId = user.id;
  res.json({ ok: true, user: auth.publicUser(user) });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── Todo lo que sigue requiere autenticación ──────────────────────────────────
app.use(requireAuth);

// ── Rutas autenticadas ─────────────────────────────────────────────────────
app.get('/auth/me', (req, res) => {
  const user = auth.findById(req.session.userId);
  if (!user) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Sesión inválida' }); }
  res.json(auth.publicUser(user));
});

app.post('/auth/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Faltan campos' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const user = auth.findById(req.session.userId);
  const ok   = await auth.verifyPassword(user, currentPassword);
  if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

  await auth.changePassword(user.id, newPassword);
  res.json({ ok: true });
});

// ── Rutas de admin ────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const user = auth.findById(req.session.userId);
  if (!user || user.role !== 'admin')
    return res.status(403).json({ error: 'Permiso insuficiente' });
  next();
}

app.get('/admin/users', requireAdmin, (req, res) => {
  res.json(auth.listUsers());
});

app.post('/admin/reset-password', requireAdmin, async (req, res) => {
  const { userId, newPassword } = req.body || {};
  if (!userId || !newPassword)
    return res.status(400).json({ error: 'Faltan campos' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'Mínimo 6 caracteres' });

  const ok = await auth.changePassword(userId, newPassword);
  if (!ok) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true });
});

app.post('/admin/users', requireAdmin, async (req, res) => {
  const { name, email, role, password } = req.body || {};
  const result = await auth.createUser(name, email, role, password);
  if (result.error) return res.status(409).json({ error: result.error });
  res.json(result);
});

app.delete('/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  // No permitir que el admin se borre a sí mismo
  if (String(id) === String(req.session.userId))
    return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });
  const ok = auth.deleteUser(id);
  if (!ok) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true });
});

app.patch('/admin/users/:id/role', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { role } = req.body || {};
  if (!role) return res.status(400).json({ error: 'Falta el rol' });
  const ok = auth.updateUserRole(id, role);
  if (!ok) return res.status(400).json({ error: 'Rol inválido o usuario no encontrado' });
  res.json({ ok: true });
});

// ── Archivos estáticos (solo para usuarios autenticados) ──────────────────────
app.use(express.static('public'));

async function getData() {
  const cached = cache.get('carta');
  if (cached) return cached;
  const data = await fetchCartaData();
  cache.set('carta', data);
  return data;
}

async function getTurnosData() {
  const cached = turnosCache.get('turnos');
  if (cached) return cached;
  const data = await fetchVentasHorarios();
  turnosCache.set('turnos', data);
  return data;
}

// Turnos & Horarios
app.get('/api/turnos', async (req, res) => {
  try {
    const allRecords = await getTurnosData();
    const parse = key => req.query[key] ? req.query[key].split(',').map(s => s.trim()) : ['all'];
    const anos  = parse('anos');
    const meses = parse('meses');
    const dias  = parse('dias');
    const turno = req.query.turno || 'all';

    const filtered  = filterVentas(allRecords, { anos, meses, dias, turno });
    // Estaciones: filtrar solo por año para tener visión completa de la temporada
    const byYear    = filterVentas(allRecords, { anos, meses: ['all'], dias: ['all'], turno: 'all' });
    const catalog   = buildCatalog(allRecords);

    res.json({
      kpis:           buildTurnosKPIs(filtered),
      hourlyStats:    buildHourlyStats(filtered),
      shiftEvolucion: buildShiftEvolucion(filtered),
      heatmap:        buildHeatmap(filtered),
      seasonStats:    buildSeasonStats(byYear),
      weekdayStats:   buildWeekdayStats(filtered),
      catalog,
    });
  } catch (err) {
    console.error('Error /api/turnos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
  ipcCache.flushAll();     // también limpia el IPC para forzar refetch
  turnosCache.flushAll();  // limpia datos de turnos & horarios
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Carta Rebelión corriendo en http://localhost:${PORT}`);
});
