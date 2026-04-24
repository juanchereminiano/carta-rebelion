const { google } = require('googleapis');

const MES_NOMBRES = [
  'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE',
];

const DIA_NOMBRES = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'];

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

function normalize(str) {
  return (str || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseNum(raw) {
  if (!raw || raw.trim() === '' || raw === '#DIV/0!' || raw === '#N/A') return null;
  const clean = raw.replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

async function fetchVentasHorarios(spreadsheetId) {
  if (!spreadsheetId) spreadsheetId = process.env.CARTA_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('CARTA_SPREADSHEET_ID no está configurado en .env');

  const auth   = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // Descubrir tabs disponibles
  const meta      = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetList = meta.data.sheets.map(s => s.properties.title);

  // Buscar la hoja que incluya "VENTAS HORARIOS" o "HORARIOS"
  const sheetName = sheetList.find(name => {
    const n = normalize(name);
    return n.includes('ventas horarios') || n.includes('horarios');
  }) || null;

  if (!sheetName) {
    throw new Error(`No se encontró la hoja "VENTAS HORARIOS". Hojas disponibles: ${sheetList.join(', ')}`);
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:D50000`,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return [];

  // Primera fila = headers
  const headers = rows[0].map(h => normalize(h));

  const idxHora   = headers.findIndex(h => h === 'hora');
  const idxOrden  = headers.findIndex(h => h === 'orden' || h.includes('orden'));
  const idxFecha  = headers.findIndex(h => h === 'fecha');
  const idxVenta  = headers.findIndex(h => h === 'venta' || h.includes('venta'));

  const records = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];

    const rawFecha = idxFecha >= 0 ? (row[idxFecha] || '').trim() : '';
    const rawVenta = idxVenta >= 0 ? (row[idxVenta] || '').trim() : '';
    const rawHora  = idxHora  >= 0 ? (row[idxHora]  || '').trim() : '';
    const rawOrden = idxOrden >= 0 ? (row[idxOrden] || '').trim() : '';

    if (!rawFecha || !rawVenta) continue;

    const venta = parseNum(rawVenta);
    const hora  = parseInt(rawHora, 10);

    if (venta === null || isNaN(hora)) continue;
    if (hora < 0 || hora > 23) continue;

    // Parsear fecha "DD/MM/YYYY"
    const parts = rawFecha.split('/');
    if (parts.length !== 3) continue;
    const [d, m, y] = parts.map(p => parseInt(p, 10));
    if (isNaN(d) || isNaN(m) || isNaN(y)) continue;

    const dateObj = new Date(y, m - 1, d);
    if (isNaN(dateObj.getTime())) continue;

    const fechaISO    = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const mesIdx      = m - 1;  // 0-11
    const mesNombre   = MES_NOMBRES[mesIdx] || 'ENERO';
    const jsDay       = dateObj.getDay();  // 0=Sunday
    const diaSemanaIdx = jsDay === 0 ? 6 : jsDay - 1;  // Monday-first
    const diaSemana   = DIA_NOMBRES[diaSemanaIdx];
    const turno       = (hora >= 7 && hora <= 16) ? 'DIA' : 'NOCHE';
    const orden       = parseNum(rawOrden) || 0;

    records.push({
      hora,
      orden,
      fecha: fechaISO,
      año: y,
      mes: m,
      mesNombre,
      mesIdx,
      diaSemana,
      diaSemanaIdx,
      venta,
      turno,
    });
  }

  return records;
}

module.exports = { fetchVentasHorarios };
