/**
 * productCatalog.js
 * Maneja el catálogo maestro de productos por empresa.
 *
 * Archivo en disco: data/productos-{empresaId}.json
 * Clave: id_product (string). Si no hay ID, clave = nombre en mayúsculas.
 *
 * Campos editables:
 *   nombreInforme      → nombre canónico para agrupar en informes
 *   categoria          → texto libre (ej: "CERVEZAS", "COCINA")
 *   mix                → Comida | Bebida | Promos | Mercado | Evento
 *   excluirInflacion   → boolean (default false) — excluir del análisis de Inflación de Carta
 */

const fs   = require('fs');
const path = require('path');

// En Railway: el volumen persistente está en THINKION_DATA_DIR (ej: /data).
// Guardamos el catálogo ahí para que sobreviva redeploys.
// Localmente cae en ./data (mismo que el cache de Thinkion).
const DATA_DIR = process.env.THINKION_DATA_DIR
  || path.join(__dirname, '..', 'data');

function catalogFile(empresaId) {
  return path.join(DATA_DIR, `productos-${empresaId}.json`);
}

/** Lee el catálogo completo. Devuelve un Map id→producto. */
function readCatalog(empresaId) {
  try {
    const file = catalogFile(empresaId);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`[Catálogo] Error leyendo ${empresaId}:`, e.message);
    return {};
  }
}

/** Guarda el catálogo completo. */
function writeCatalog(empresaId, catalog) {
  const file = catalogFile(empresaId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2), 'utf8');
}

/**
 * Actualiza uno o varios productos.
 * `updates` = array de { id, nombreInforme?, categoria?, mix? }
 */
function updateProducts(empresaId, updates) {
  const catalog = readCatalog(empresaId);
  for (const u of updates) {
    if (!u.id) continue;
    const key = String(u.id);
    if (!catalog[key]) catalog[key] = { id: key };
    if (u.nombreOriginal     !== undefined) catalog[key].nombreOriginal     = u.nombreOriginal;
    if (u.nombreInforme      !== undefined) catalog[key].nombreInforme      = u.nombreInforme;
    if (u.categoria          !== undefined) catalog[key].categoria          = u.categoria;
    if (u.mix                !== undefined) catalog[key].mix                = u.mix;
    if (u.excluirInflacion   !== undefined) catalog[key].excluirInflacion   = u.excluirInflacion;
  }
  writeCatalog(empresaId, catalog);
  return catalog;
}

/**
 * Construye la lista de productos únicos escaneando los archivos de caché
 * de Thinkion en disco (report 320), sin tocar la API.
 * Los enriquece con los datos del catálogo manual.
 */
function buildProductList(empresaId) {
  const catalog  = readCatalog(empresaId);
  const cacheDir = path.join(
    process.env.THINKION_DATA_DIR || path.join(__dirname, '..', 'data', 'thinkion-cache'),
    empresaId
  );

  const productos = {};  // id → { id, nombreOriginal, ventas, meses }

  if (fs.existsSync(cacheDir)) {
    const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('320-'));
    for (const file of files) {
      const mes = file.replace('320-', '').replace('.json', '');
      let rows;
      try { rows = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8')); }
      catch { continue; }

      for (const row of rows) {
        if (!row.product) continue;
        const rawId  = row.id_product;
        // Mismo criterio que thinkionAPI: id numérico (≠0) o nombre en mayúscula
        const key    = (rawId != null && rawId !== 0 && rawId !== '')
                     ? String(rawId)
                     : row.product.trim().toUpperCase();
        const venta  = parseFloat(row.sale) || 0;

        if (!productos[key]) {
          productos[key] = {
            id:             key,
            nombreOriginal: row.product.trim(),
            totalVentas:    0,
            meses:          new Set(),
          };
        }
        productos[key].totalVentas += venta;
        productos[key].meses.add(mes);

        // Si el nombre cambió, guardamos el más reciente (los meses vienen desc)
        // En realidad el primero que encontramos está bien
      }
    }
  }

  // Combinar con catálogo manual
  return Object.values(productos)
    .map(p => {
      const cat = catalog[p.id] || {};
      return {
        id:                p.id,
        nombreOriginal:    cat.nombreOriginal || p.nombreOriginal,
        nombreInforme:     cat.nombreInforme  || p.nombreOriginal,
        categoria:         cat.categoria      || '',
        mix:               cat.mix            || '',
        excluirInflacion:  cat.excluirInflacion === true,
        totalVentas:       Math.round(p.totalVentas),
        meses:             p.meses.size,
        editado:           !!(cat.nombreInforme || cat.categoria || cat.mix || cat.excluirInflacion),
      };
    })
    .sort((a, b) => b.totalVentas - a.totalVentas);
}

module.exports = { readCatalog, updateProducts, buildProductList };
