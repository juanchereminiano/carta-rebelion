const { google } = require('googleapis');

// Nombres candidatos de la hoja (en orden de prioridad)
const SHEET_CANDIDATES = [
  'BASE VENTAS MENSUALES',
  'BASE VENTAS',
  'Ventas',
  'VENTAS',
  'Sheet1',
];

function getAuthClient() {
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf8')
    );
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

function parseValue(raw) {
  if (!raw || raw.trim() === '' || raw === '#DIV/0!' || raw === '#N/A') return null;
  const clean = raw.replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function normalize(str) {
  return (str || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseRows(rows) {
  // Buscar fila de encabezados (contiene "año" o "ano")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i] || [];
    if (row.some(cell => /^a[ñn]o$/i.test(normalize(cell || '')))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) headerIdx = 1; // fallback: segunda fila

  const headers = (rows[headerIdx] || []).map(h => normalize(h));

  // Índices de columnas (tolerante a variaciones)
  const idxAno   = headers.findIndex(h => h === 'ano');
  const idxMes   = headers.findIndex(h => h === 'mes');
  const idxCat   = headers.findIndex(h => h.includes('categor'));
  const idxCod   = headers.findIndex(h => h === 'codigo' || h === 'cod');
  const idxProd  = headers.findIndex(h => h === 'producto' || h.includes('product'));
  const idxCant  = headers.findIndex(h => h === 'cant' || h === 'cantidad');
  // "Dinero" puede estar en varias columnas; tomamos la primera que matchea
  const idxDin   = headers.findIndex(h => h === 'dinero' || h.includes('venta') || h === 'total');
  const idxPrecio = headers.findIndex(h => h.includes('precio'));

  const records = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row[idxAno] && !row[idxProd]) continue; // fila vacía

    const ano      = parseValue(row[idxAno] || '');
    const mes      = (row[idxMes] || '').trim().toUpperCase();
    const categoria = (idxCat >= 0 ? row[idxCat] : '').trim();
    const codigo   = idxCod >= 0 ? parseValue(row[idxCod] || '') : null;
    const producto = (idxProd >= 0 ? row[idxProd] : '').trim();
    const cant     = idxCant >= 0 ? parseValue(row[idxCant] || '') : null;
    const dinero   = idxDin >= 0 ? parseValue(row[idxDin] || '') : null;
    const precioPromedio = idxPrecio >= 0 ? parseValue(row[idxPrecio] || '') : null;

    if (!producto || !mes) continue;

    records.push({ ano, mes, categoria, codigo, producto, cant, dinero, precioPromedio });
  }

  return records;
}

async function fetchCartaData() {
  const spreadsheetId = process.env.CARTA_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('CARTA_SPREADSHEET_ID no está configurado en .env');

  const auth   = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // Descubrir tabs disponibles
  const meta       = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetList  = meta.data.sheets.map(s => s.properties.title);

  // Elegir la hoja correcta
  const sheetName = sheetList.find(name =>
    SHEET_CANDIDATES.some(c => normalize(name).includes(normalize(c).split(' ')[0]))
  ) || sheetList[0];

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:J10000`,
  });

  const rows    = response.data.values || [];
  const records = parseRows(rows);

  return { records, sheetName, allSheets: sheetList };
}

module.exports = { fetchCartaData };
