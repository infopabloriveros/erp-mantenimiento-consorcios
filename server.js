require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');
const { TABLES, PREFIX } = require('./src/backend/models/schema');

const app = express();
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const isVercel = Boolean(process.env.VERCEL);
const writableRoot = isVercel ? path.join('/tmp', 'erp-mantenimiento') : root;
const dataDir = isVercel ? path.join(writableRoot, 'data') : path.join(root, 'data');
const dataFile = path.join(dataDir, 'db.json');
const uploadDir = isVercel ? path.join(writableRoot, 'uploads') : path.join(root, 'public', 'uploads');
const quoteDir = isVercel ? path.join(writableRoot, 'presupuestos') : path.join(root, 'public', 'presupuestos');
const dbMode = process.env.DB_MODE || 'local-json';
const spreadsheetId = process.env.SPREADSHEET_ID || '';
const appsScriptUrl = process.env.APPS_SCRIPT_URL || '';
const appsScriptToken = process.env.APPS_SCRIPT_TOKEN || '';
const appsScriptReadMode = process.env.APPS_SCRIPT_READ_MODE || 'cache';
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const adminUser = String(process.env.ERP_ADMIN_USER || (!isVercel ? 'admin' : '')).trim();
const adminPassword = String(process.env.ERP_ADMIN_PASSWORD || (!isVercel ? 'admin123' : '')).trim();
const sessionSecret = String(process.env.ERP_SESSION_SECRET || supabaseServiceRoleKey || (!isVercel ? 'dev-session-secret' : '')).trim();
const serviceAccountFile = path.resolve(root, process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './service-account.json');
let sheetsClient = null;
let sheetsReady = false;
let supabaseClient = null;

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(root, 'public')));

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index > -1) acc[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return acc;
  }, {});
}

function signSession(payload) {
  if (!sessionSecret) throw new Error('Falta configurar ERP_SESSION_SECRET.');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifySessionToken(token) {
  try {
    if (!token || !sessionSecret || !token.includes('.')) return null;
    const [body, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function sessionCookieOptions(maxAgeSeconds) {
  const parts = [
    `erp_session=`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (isVercel) parts.push('Secure');
  return parts;
}

function setSessionCookie(res, token, maxAgeSeconds = 60 * 60 * 12) {
  const parts = sessionCookieOptions(maxAgeSeconds);
  parts[0] = `erp_session=${encodeURIComponent(token)}`;
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', sessionCookieOptions(0).join('; '));
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function currentSession(req) {
  return verifySessionToken(parseCookies(req).erp_session);
}

function requireAuth(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (['/api/auth/login', '/api/auth/logout', '/api/auth/session'].includes(req.path)) return next();
  const session = currentSession(req);
  if (!session) return res.status(401).json({ ok: false, message: 'Necesitas iniciar sesion.' });
  req.user = session;
  next();
}

app.use(requireAuth);

function ensureDirs() {
  [dataDir, uploadDir, quoteDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function emptyDb() {
  const db = {};
  Object.keys(TABLES).forEach(table => db[table] = []);
  return db;
}

function readLocalDb() {
  ensureDirs();
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify(emptyDb(), null, 2));
  const db = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  Object.keys(TABLES).forEach(table => {
    if (!Array.isArray(db[table])) db[table] = [];
  });
  return db;
}

function writeLocalDb(db) {
  ensureDirs();
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  if (!spreadsheetId) throw new Error('Falta SPREADSHEET_ID en .env.');
  if (!fs.existsSync(serviceAccountFile)) throw new Error(`Falta el archivo de credenciales: ${serviceAccountFile}`);
  const auth = new google.auth.GoogleAuth({
    keyFile: serviceAccountFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function sheetRange(table) {
  return `'${table}'!A:ZZ`;
}

function rowsToSheetValues(table, rows) {
  const headers = TABLES[table];
  return [
    headers,
    ...(rows || []).map(row => headers.map(field => row[field] ?? ''))
  ];
}

function sheetValuesToRows(table, values) {
  const headers = values && values[0] && values[0].length ? values[0] : TABLES[table];
  return (values || []).slice(1).map(valuesRow => {
    const row = {};
    TABLES[table].forEach(field => {
      const index = headers.indexOf(field);
      row[field] = index >= 0 ? clean(valuesRow[index] || '') : '';
    });
    return row;
  }).filter(row => Object.values(row).some(Boolean));
}

async function ensureSheets() {
  if (sheetsReady) return;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set((meta.data.sheets || []).map(sheet => sheet.properties.title));
  const missing = Object.keys(TABLES).filter(table => !existing.has(table));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map(table => ({ addSheet: { properties: { title: table } } }))
      }
    });
  }
  for (const table of Object.keys(TABLES)) {
    const current = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${table}'!1:1` });
    const headers = current.data.values && current.data.values[0] ? current.data.values[0] : [];
    if (!headers.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${table}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [TABLES[table]] }
      });
    }
  }
  sheetsReady = true;
}

async function readSheetsDb() {
  await ensureSheets();
  const sheets = await getSheetsClient();
  const db = emptyDb();
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: Object.keys(TABLES).map(sheetRange)
  });
  (response.data.valueRanges || []).forEach((range, index) => {
    const table = Object.keys(TABLES)[index];
    db[table] = sheetValuesToRows(table, range.values || []);
  });
  const sheetHasData = Object.values(db).some(rows => rows.length);
  const localDb = readLocalDb();
  const localHasData = Object.values(localDb).some(rows => rows.length);
  if (!sheetHasData && localHasData) {
    await writeSheetsDb(localDb);
    return localDb;
  }
  writeLocalDb(db);
  return db;
}

async function writeSheetsDb(db) {
  await ensureSheets();
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: Object.keys(TABLES).map(sheetRange) }
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: Object.keys(TABLES).map(table => ({
        range: `'${table}'!A1`,
        values: rowsToSheetValues(table, db[table])
      }))
    }
  });
  writeLocalDb(db);
}

async function callAppsScript(action, payload = {}) {
  if (!appsScriptUrl) throw new Error('Falta APPS_SCRIPT_URL en .env.');
  const response = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: appsScriptToken, ...payload })
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || 'Error de Apps Script.');
  return result.data;
}

async function readAppsScriptDb() {
  if (appsScriptReadMode === 'cache') return readLocalDb();
  const db = await callAppsScript('read');
  Object.keys(TABLES).forEach(table => {
    if (!Array.isArray(db[table])) db[table] = [];
  });
  const sheetHasData = Object.values(db).some(rows => rows.length);
  const localDb = readLocalDb();
  const localHasData = Object.values(localDb).some(rows => rows.length);
  if (!sheetHasData && localHasData) {
    await writeAppsScriptDb(localDb);
    return localDb;
  }
  writeLocalDb(db);
  return db;
}

async function writeAppsScriptDb(db) {
  writeLocalDb(db);
  await callAppsScript('write', { db });
}

async function syncFromAppsScript() {
  const db = await callAppsScript('read');
  Object.keys(TABLES).forEach(table => {
    if (!Array.isArray(db[table])) db[table] = [];
  });
  writeLocalDb(db);
  return db;
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.');
  }
  supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseClient;
}

function rowIdFor(table, row, index) {
  return String(row.ID || row.Clave || `${table}-${index + 1}`);
}

async function readSupabaseDb() {
  const supabase = getSupabaseClient();
  const db = emptyDb();
  const { data, error } = await supabase
    .from('erp_rows')
    .select('table_name,row_id,data')
    .order('table_name', { ascending: true })
    .order('row_id', { ascending: true });
  if (error) throw new Error(`Supabase read: ${error.message}`);
  (data || []).forEach(record => {
    if (!db[record.table_name]) db[record.table_name] = [];
    db[record.table_name].push(record.data || {});
  });
  Object.keys(TABLES).forEach(table => {
    if (!Array.isArray(db[table])) db[table] = [];
  });
  const supabaseHasData = Object.values(db).some(rows => rows.length);
  const localDb = readLocalDb();
  const localHasData = Object.values(localDb).some(rows => rows.length);
  if (!supabaseHasData && localHasData) {
    await writeSupabaseDb(localDb);
    return localDb;
  }
  writeLocalDb(db);
  return db;
}

async function writeSupabaseDb(db) {
  const supabase = getSupabaseClient();
  const rows = [];
  Object.keys(TABLES).forEach(table => {
    (db[table] || []).forEach((row, index) => {
      rows.push({
        table_name: table,
        row_id: rowIdFor(table, row, index),
        data: row
      });
    });
  });
  const { error: deleteError } = await supabase
    .from('erp_rows')
    .delete()
    .neq('table_name', '__never__');
  if (deleteError) throw new Error(`Supabase delete: ${deleteError.message}`);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('erp_rows')
      .upsert(rows.slice(i, i + 500), { onConflict: 'table_name,row_id' });
    if (error) throw new Error(`Supabase write: ${error.message}`);
  }
  writeLocalDb(db);
}

async function syncFromSupabase() {
  const supabase = getSupabaseClient();
  const db = emptyDb();
  const { data, error } = await supabase.from('erp_rows').select('table_name,row_id,data');
  if (error) throw new Error(`Supabase read: ${error.message}`);
  (data || []).forEach(record => {
    if (!db[record.table_name]) db[record.table_name] = [];
    db[record.table_name].push(record.data || {});
  });
  writeLocalDb(db);
  return db;
}

async function readDb() {
  if (dbMode === 'google-sheets') return readSheetsDb();
  if (dbMode === 'apps-script') return readAppsScriptDb();
  if (dbMode === 'supabase') return readSupabaseDb();
  return readLocalDb();
}

async function writeDb(db) {
  if (dbMode === 'google-sheets') await writeSheetsDb(db);
  else if (dbMode === 'apps-script') await writeAppsScriptDb(db);
  else if (dbMode === 'supabase') await writeSupabaseDb(db);
  else writeLocalDb(db);
}

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clean(value) {
  return String(value ?? '').replace(/[<>]/g, '').trim();
}

function num(value) {
  return Number(String(value || 0).replace(/\./g, '').replace(',', '.')) || 0;
}

function parseMoneyAr(value) {
  const cleaned = String(value || '').replace(/[^\d.,-]/g, '');
  if (!cleaned) return 0;
  const comma = cleaned.lastIndexOf(',');
  const dot = cleaned.lastIndexOf('.');
  if (comma > dot) return Number(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  return Number(cleaned.replace(/,/g, '')) || 0;
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function money(value) {
  return '$ ' + Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safeName(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 90).trim() || 'archivo';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function cleanEmailText(value) {
  return String(value ?? '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/alba\?iler\?a/gi, 'albañilería')
    .replace(/plomer\?a/gi, 'plomería')
    .replace(/colocaci\?n/gi, 'colocación')
    .replace(/reparaci\?n/gi, 'reparación')
    .replace(/ejecuci\?n/gi, 'ejecución')
    .replace(/reposici\?n/gi, 'reposición')
    .replace(/confirmacion/gi, 'confirmación')
    .trim();
}

function emailHtmlFromText(value) {
  return cleanEmailText(value)
    .split(/\n{2,}/)
    .map(part => `<p>${esc(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function nextId(db, table) {
  const prefix = PREFIX[table] || table.slice(0, 3).toUpperCase();
  let max = 0;
  (db[table] || []).forEach(row => {
    const match = String(row.ID || '').match(/(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return `${prefix}-${String(max + 1).padStart(6, '0')}`;
}

function pick(table, data) {
  const record = {};
  TABLES[table].forEach(field => {
    if (data[field] !== undefined) record[field] = clean(data[field]);
    else record[field] = '';
  });
  return record;
}

function findById(db, table, id) {
  return (db[table] || []).find(row => String(row.ID) === String(id));
}

function upsert(db, table, data) {
  const record = pick(table, data);
  record.ID = record.ID || nextId(db, table);
  const index = db[table].findIndex(row => row.ID === record.ID);
  if (index >= 0) db[table][index] = { ...db[table][index], ...record };
  else db[table].push(record);
  return record;
}

function append(db, table, data) {
  const record = pick(table, data);
  record.ID = record.ID || nextId(db, table);
  db[table].push(record);
  return record;
}

function remove(db, table, id) {
  const before = db[table].length;
  db[table] = db[table].filter(row => row.ID !== id);
  return { deleted: before - db[table].length };
}

function getDashboard(db) {
  const clientes = db.Clientes || [];
  const presupuestos = db.Presupuestos || [];
  const servicios = db.Servicios || [];
  const trabajos = db.Trabajos || [];
  const trabajosActivos = trabajos.filter(t => t.Estado !== 'Cancelado');
  const serviciosActivos = servicios.filter(s => s.Estado !== 'Cancelado');
  const cobros = db.Cobros || [];
  const gastos = db.Gastos || [];
  const facturas = db.Facturas || [];
  const facturasActivas = facturas.filter(f => f.Estado !== 'Anulada');
  const facturasPendientes = facturasActivas.filter(f => f.Estado !== 'Cobrada');
  return {
    clientes: clientes.length,
    consorcios: clientes.filter(c => c.Tipo === 'Consorcio').length,
    presupuestos: presupuestos.length,
    aceptados: presupuestos.filter(p => p.Estado === 'Aceptado').length,
    serviciosPendientes: serviciosActivos.filter(s => ['Pendiente', 'Programado', 'En curso'].includes(s.Estado)).length,
    saldoServicios: serviciosActivos.reduce((a, s) => a + Math.max(num(s.Importe) - num(s.Cobrado), 0), 0),
    totalPresupuestado: sum(presupuestos, 'Total'),
    trabajos: trabajosActivos.length,
    pendientes: trabajosActivos.filter(t => ['Pendiente', 'Programado', 'En curso'].includes(t.Estado)).length,
    cobrado: sum(cobros, 'Importe'),
    facturado: sum(facturasActivas, 'Importe'),
    facturasPendientes: facturasPendientes.length,
    facturasPendientesImporte: sum(facturasPendientes, 'Importe'),
    gastos: sum(gastos, 'Importe'),
    saldoTrabajos: trabajosActivos.reduce((a, t) => a + Math.max(num(t.Importe) - num(t.Cobrado), 0), 0)
  };
}

function reconcileBillingLinks(db) {
  (db.Servicios || []).forEach(servicio => {
    const facturas = (db.Facturas || []).filter(f => (
      f.Servicio_ID === servicio.ID ||
      (servicio.Presupuesto_ID && f.Presupuesto_ID === servicio.Presupuesto_ID)
    ) && f.Estado !== 'Anulada');
    if (!facturas.length) return;
    if (facturas.every(f => f.Estado === 'Cobrada')) servicio.Estado = 'Cobrado';
    else servicio.Estado = 'Facturado';
  });
  (db.Presupuestos || []).forEach(presupuesto => {
    const facturas = (db.Facturas || []).filter(f => f.Presupuesto_ID === presupuesto.ID && f.Estado !== 'Anulada');
    if (!facturas.length) return;
    if (!['Rechazado', 'Vencido', 'Convertido a trabajo'].includes(presupuesto.Estado)) presupuesto.Estado = 'Facturado';
  });
}

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + num(row[key]), 0);
}

function billedAmount(db, matcher) {
  return (db.Facturas || [])
    .filter(f => f.Estado !== 'Anulada' && matcher(f))
    .reduce((acc, f) => acc + num(f.Importe), 0);
}

function pendingToInvoice(db, type, item) {
  if (!item) return 0;
  if (type === 'servicio') {
    const facturado = billedAmount(db, f => (
      f.Servicio_ID === item.ID ||
      (item.Presupuesto_ID && f.Presupuesto_ID === item.Presupuesto_ID)
    ));
    return Math.max(num(item.Importe) - facturado, 0);
  }
  if (type === 'trabajo') {
    const facturado = billedAmount(db, f => f.Trabajo_ID === item.ID || (item.Presupuesto_ID && f.Presupuesto_ID === item.Presupuesto_ID));
    return Math.max(num(item.Importe) - facturado, 0);
  }
  const facturado = billedAmount(db, f => f.Presupuesto_ID === item.ID);
  return Math.max(num(item.Total) - facturado, 0);
}

function presupuestoForInvoiceSource(db, type, item) {
  if (!item) return null;
  if (type === 'presupuesto') return item;
  return item.Presupuesto_ID ? findById(db, 'Presupuestos', item.Presupuesto_ID) : null;
}

function pendingAdelantoToInvoice(db, presupuesto) {
  if (!presupuesto) return 0;
  const adelanto = num(presupuesto.Adelanto);
  if (adelanto <= 0) return 0;
  const adelantoFacturado = billedAmount(db, f => f.Presupuesto_ID === presupuesto.ID && String(f.Concepto || '').trim().toLowerCase() === 'adelanto');
  return Math.max(Math.min(adelanto - adelantoFacturado, pendingToInvoice(db, 'presupuesto', presupuesto)), 0);
}

function getLookups(db) {
  return {
    clientes: db.Clientes.filter(c => (c.Estado || 'Activo') !== 'Inactivo').map(c => ({
      id: c.ID,
      tipo: c.Tipo,
      nombre: c.Nombre,
      direccion: c.Direccion,
      telefono: c.Telefono,
      whatsapp: c.Whatsapp,
      email: c.Email,
      label: `${c.Tipo === 'Consorcio' ? 'Edificio' : 'Cliente'} ${c.Nombre || ''} · ${c.Direccion || ''}`.trim()
    })),
    unidades: db.Unidades.filter(u => (u.Estado || 'Activo') !== 'Inactivo'),
    administradores: db.Administradores.filter(a => (a.Estado || 'Activo') !== 'Inactivo'),
    formaPago: ['Efectivo', 'Debito', 'Credito', 'Transferencia bancaria'],
    condicionPago: ['Contado', '15 dias', '30 dias', '60 dias', '90 dias'],
    estadosPresupuesto: ['Borrador', 'Enviado', 'Aceptado', 'En curso', 'Finalizado', 'Facturado', 'Rechazado', 'Vencido'],
    estadosTrabajo: ['Pendiente', 'Programado', 'En curso', 'Finalizado', 'Facturado', 'Cerrado', 'Cancelado'],
    estadosFacturacion: ['No facturado', 'Pendiente de facturar', 'Facturado'],
    prioridades: ['Baja', 'Media', 'Alta', 'Urgente']
  };
}

function configObject(db) {
  const config = {};
  (db.Config || []).forEach(row => {
    if (row.Clave) config[row.Clave] = row.Valor || '';
  });
  return config;
}

function defaultQuoteConfig(config) {
  return {
    Empresa_Nombre: config.Empresa_Nombre || 'Pablo Gonzalez Construcciones',
    Empresa_Descripcion: config.Empresa_Descripcion || 'Nuestros servicios estan dimensionados para suplir\nlas necesidades de construccion, refacciones,\nmantenimiento de consorcios, pequenas y medianas\nempresas.',
    Empresa_Telefono: config.Empresa_Telefono || '1151095603',
    Empresa_Whatsapp: config.Empresa_Whatsapp || '1151095603',
    Empresa_Email: config.Empresa_Email || 'pablogonzalez.construcciones@gmail.com.ar',
    Empresa_Direccion: config.Empresa_Direccion || '',
    Empresa_Logo: config.Empresa_Logo || '/assets/pablo-gonzalez-logo.png',
    Presupuesto_Validez_Dias: config.Presupuesto_Validez_Dias || '15'
  };
}

async function initialData() {
  const db = await readDb();
  return {
    clientes: db.Clientes,
    consorcios: db.Consorcios,
    administraciones: db.Administraciones,
    administradores: db.Administradores,
    contactos: db.Contactos,
    unidades: db.Unidades,
    servicios: db.Servicios,
    presupuestos: db.Presupuestos,
    detalle: db.Detalle_Presupuestos,
    trabajos: db.Trabajos,
    fotos: db.Fotos_Trabajos,
    facturas: db.Facturas,
    cobros: db.Cobros,
    correos: db.Correos,
    gastos: db.Gastos,
    proveedores: db.Proveedores,
    config: defaultQuoteConfig(configObject(db)),
    dashboard: getDashboard(db),
    lookups: getLookups(db)
  };
}

function ensureConsorcio(db, cliente) {
  if (cliente.Tipo !== 'Consorcio') return;
  const exists = db.Consorcios.find(c => c.Cliente_ID === cliente.ID);
  if (exists) return;
  append(db, 'Consorcios', {
    Cliente_ID: cliente.ID,
    Nombre_Edificio: cliente.Nombre,
    Direccion: cliente.Direccion,
    Estado: 'Activo'
  });
}

async function saveCliente(data) {
  const db = await readDb();
  if (!data.Nombre) throw new Error('El nombre del cliente es obligatorio.');
  const record = {
    ...data,
    ID: data.ID || nextId(db, 'Clientes'),
    Tipo: data.Tipo || 'Particular',
    Documento_Tipo: data.Documento_Tipo || 'CUIT',
    Whatsapp: normalizePhone(data.Whatsapp || data.Telefono || ''),
    Estado: data.Estado || 'Activo',
    Carpeta_Local: data.Carpeta_Local || path.join('data', 'clientes', safeName(data.Nombre)),
    Fecha_Alta: data.Fecha_Alta || today(),
    Ultima_Modificacion: now()
  };
  const saved = upsert(db, 'Clientes', record);
  ensureConsorcio(db, saved);
  await writeDb(db);
  return { id: saved.ID };
}

async function saveAdministrador(data) {
  const db = await readDb();
  if (!data.Cliente_ID) throw new Error('Selecciona un consorcio.');
  if (data.Administracion_ID) {
    const adminBase = findById(db, 'Administraciones', data.Administracion_ID);
    if (adminBase) {
      data.Administracion = data.Administracion || adminBase.Nombre;
      data.Contacto = data.Contacto || adminBase.Contacto;
      data.Cargo = data.Cargo || adminBase.Cargo;
      data.Telefono = data.Telefono || adminBase.Telefono;
      data.Whatsapp = data.Whatsapp || adminBase.Whatsapp;
      data.Email = data.Email || adminBase.Email;
      data.Direccion = data.Direccion || adminBase.Direccion;
    }
  }
  const saved = upsert(db, 'Administradores', {
    ...data,
    ID: data.ID || nextId(db, 'Administradores'),
    Whatsapp: normalizePhone(data.Whatsapp || data.Telefono || ''),
    Estado: data.Estado || 'Activo'
  });
  await writeDb(db);
  return { id: saved.ID };
}

async function saveAdministracion(data) {
  const db = await readDb();
  if (!data.Nombre) throw new Error('El nombre de la administracion es obligatorio.');
  const saved = upsert(db, 'Administraciones', {
    ...data,
    ID: data.ID || nextId(db, 'Administraciones'),
    Whatsapp: normalizePhone(data.Whatsapp || data.Telefono || ''),
    Estado: data.Estado || 'Activo'
  });
  await writeDb(db);
  return { id: saved.ID };
}

async function saveContacto(data) {
  const db = await readDb();
  if (!data.Cliente_ID) throw new Error('Selecciona un cliente o consorcio.');
  if (!data.Rol) throw new Error('Selecciona el tipo de contacto.');
  if (!data.Nombre) throw new Error('El nombre del contacto es obligatorio.');
  const saved = upsert(db, 'Contactos', {
    ...data,
    ID: data.ID || nextId(db, 'Contactos'),
    Whatsapp: normalizePhone(data.Whatsapp || data.Telefono || ''),
    Estado: data.Estado || 'Activo'
  });
  await writeDb(db);
  return { id: saved.ID };
}

async function saveUnidad(data) {
  const db = await readDb();
  if (!data.Cliente_ID) throw new Error('Selecciona el consorcio.');
  if (!data.Unidad) throw new Error('La unidad es obligatoria.');
  const saved = upsert(db, 'Unidades', {
    ...data,
    ID: data.ID || nextId(db, 'Unidades'),
    Propietario_Whatsapp: normalizePhone(data.Propietario_Whatsapp || data.Propietario_Tel || ''),
    Inquilino_Whatsapp: normalizePhone(data.Inquilino_Whatsapp || data.Inquilino_Tel || ''),
    Encargado_Whatsapp: normalizePhone(data.Encargado_Whatsapp || data.Encargado_Tel || ''),
    Estado: data.Estado || 'Activo'
  });
  await writeDb(db);
  return { id: saved.ID };
}

async function saveServicio(data) {
  const db = await readDb();
  if (!data.Cliente_ID) throw new Error('Selecciona un cliente o consorcio.');
  const cliente = findById(db, 'Clientes', data.Cliente_ID);
  if (!cliente) throw new Error('Cliente no encontrado.');
  const importe = num(data.Importe);
  const cobrado = num(data.Cobrado);
  const saved = upsert(db, 'Servicios', {
    ...data,
    ID: data.ID || nextId(db, 'Servicios'),
    Fecha: data.Fecha || today(),
    Cliente_ID: cliente.ID,
    Cliente_Tipo: cliente.Tipo,
    Cliente_Nombre: cliente.Nombre,
    Direccion: data.Direccion || cliente.Direccion || '',
    Tipo: data.Tipo || 'Visita',
    Titulo: data.Titulo || (data.Tipo === 'Emergencia' ? 'Emergencia' : 'Visita tecnica'),
    Detalle: data.Detalle || '',
    Prioridad: data.Prioridad || (data.Tipo === 'Emergencia' ? 'Urgente' : 'Media'),
    Estado: data.Estado || 'Pendiente',
    Importe: importe,
    Cobrado: cobrado,
    Saldo: Math.max(importe - cobrado, 0)
  });
  await writeDb(db);
  return { id: saved.ID };
}

function resolveContacto(db, clienteId, unidad, tipo) {
  if (tipo === 'Propietario' && unidad) {
    const u = db.Unidades.find(x => x.Cliente_ID === clienteId && String(x.Unidad).toLowerCase() === String(unidad).toLowerCase());
    if (u) return { nombre: u.Propietario, whatsapp: u.Propietario_Whatsapp, email: u.Propietario_Email };
  }
  if (tipo === 'Inquilino' && unidad) {
    const u = db.Unidades.find(x => x.Cliente_ID === clienteId && String(x.Unidad).toLowerCase() === String(unidad).toLowerCase());
    if (u) return { nombre: u.Inquilino, whatsapp: u.Inquilino_Whatsapp, email: u.Inquilino_Email };
  }
  const admin = db.Administradores.find(x => x.Cliente_ID === clienteId);
  if (admin) return { nombre: admin.Contacto || admin.Administracion, whatsapp: admin.Whatsapp, email: admin.Email };
  const cliente = findById(db, 'Clientes', clienteId);
  return cliente ? { nombre: cliente.Nombre, whatsapp: cliente.Whatsapp, email: cliente.Email } : {};
}

async function savePresupuesto(data) {
  const db = await readDb();
  if (!data.Cliente_ID) throw new Error('Selecciona un cliente o consorcio.');
  if (!data.Detalle_Servicio) throw new Error('Agrega el detalle de trabajo.');
  const cliente = findById(db, 'Clientes', data.Cliente_ID);
  if (!cliente) throw new Error('Cliente no encontrado.');

  const id = data.ID || nextId(db, 'Presupuestos');
  const existing = findById(db, 'Presupuestos', id);
  const total = num(data.Total);
  const cobrado = num(data.Cobrado || existing?.Cobrado || 0);
  const cfg = defaultQuoteConfig({ ...configObject(db), ...data });
  saveQuoteConfig(db, cfg);
  const row = {
    ID: id,
    Fecha: data.Fecha || today(),
    Cliente_ID: cliente.ID,
    Cliente_Tipo: cliente.Tipo,
    Cliente_Nombre: cliente.Nombre,
    Direccion: data.Direccion || cliente.Direccion || '',
    Unidad_Trabajo: data.Unidad_Trabajo || '',
    Contacto_Nombre: '',
    Contacto_Whatsapp: '',
    Contacto_Email: '',
    Forma_Pago: data.Forma_Pago || 'Transferencia bancaria',
    Condicion_Pago: data.Condicion_Pago || 'A convenir',
    Detalle_Servicio: data.Detalle_Servicio || '',
    Importe_Servicio: total,
    Materiales: 0,
    Otros: 0,
    Subtotal: total,
    IVA_Porc: 0,
    IVA: 0,
    Descuento: 0,
    Adelanto: num(data.Adelanto),
    Cuotas: 0,
    Total: total,
    Cobrado: cobrado,
    Saldo: Math.max(total - cobrado, 0),
    Estado: data.Estado || 'Borrador',
    Observaciones: data.Observaciones || '',
    Fecha_Creacion: existing?.Fecha_Creacion || now()
  };
  const quoteFile = await createQuoteHtml(row, cfg);
  row.PDF_URL = quoteFile.url;
  row.Archivo_Local = quoteFile.file;
  const driveQuote = await uploadGeneratedQuoteToDrive(row, quoteFile);
  if (driveQuote?.url) {
    row.PDF_URL = driveQuote.url;
    row.Archivo_Local = quoteFile.file;
  }
  upsert(db, 'Presupuestos', row);
  if (data.Servicio_ID) {
    const servicio = findById(db, 'Servicios', data.Servicio_ID);
    if (servicio) servicio.Presupuesto_ID = id;
  }
  await writeDb(db);
  return { id, pdfUrl: row.PDF_URL };
}

function saveQuoteConfig(db, cfg) {
  Object.keys(cfg).forEach(key => {
    upsertConfig(db, key, cfg[key]);
  });
}

function upsertConfig(db, key, value) {
  const existing = (db.Config || []).find(row => row.Clave === key);
  if (existing) existing.Valor = value || '';
  else db.Config.push({ Clave: key, Valor: value || '', Descripcion: '' });
}

function findBrowserForPdf() {
  const candidates = [
    process.env.PDF_BROWSER,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file));
}

function fileUrl(file) {
  return pathToFileURL(path.resolve(file)).href;
}

function renderPdfFromHtml(htmlFile, pdfFile) {
  const browser = findBrowserForPdf();
  if (!browser) return false;
  try {
    execFileSync(browser, [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-pdf-header-footer',
      '--print-to-pdf-no-header',
      `--print-to-pdf=${pdfFile}`,
      fileUrl(htmlFile)
    ], { stdio: 'ignore', timeout: 30000 });
    return fs.existsSync(pdfFile);
  } catch (error) {
    return false;
  }
}

function imageToDataUri(src) {
  if (!src) return '';
  if (/^data:/i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return src;
  const relative = String(src).replace(/^\/+/, '');
  const isDiskPath = path.isAbsolute(src) && !String(src).startsWith('/');
  const file = isDiskPath ? src : path.join(root, 'public', relative);
  if (!fs.existsSync(file)) return '';
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function resolveLocalAsset(src) {
  if (!src || /^data:/i.test(src) || /^https?:\/\//i.test(src)) return '';
  const relative = String(src).replace(/^\/+/, '');
  const file = path.isAbsolute(src) && !String(src).startsWith('/') ? src : path.join(root, 'public', relative);
  return fs.existsSync(file) ? file : '';
}

function addPdfField(doc, label, value, x, y, width) {
  doc.fontSize(7).fillColor('#64748b').font('Helvetica-Bold').text(label.toUpperCase(), x, y, { width });
  doc.fontSize(9).fillColor('#111827').font('Helvetica').text(String(value || '-'), x, y + 11, { width });
}

async function renderQuotePdfNative(presupuesto, cfg, pdfFile) {
  return new Promise(resolve => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: presupuesto.ID || 'Presupuesto' } });
      const stream = fs.createWriteStream(pdfFile);
      stream.on('finish', () => resolve(fs.existsSync(pdfFile)));
      stream.on('error', () => resolve(false));
      doc.on('error', () => resolve(false));
      doc.pipe(stream);

      const pageWidth = doc.page.width;
      const contentWidth = pageWidth - 84;
      const logoFile = resolveLocalAsset(cfg.Empresa_Logo || '/assets/pablo-gonzalez-logo.png');

      doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f172a').text(String(cfg.Empresa_Nombre || 'Pablo Gonzalez Construcciones'), 42, 42, { width: 365 });
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(String(cfg.Empresa_Descripcion || ''), 42, 76, { width: 335, lineGap: 2 });
      const contactLine = [
        cfg.Empresa_Telefono && `Tel: ${cfg.Empresa_Telefono}`,
        cfg.Empresa_Whatsapp && `WhatsApp: ${cfg.Empresa_Whatsapp}`,
        cfg.Empresa_Email && `Email: ${cfg.Empresa_Email}`,
        cfg.Empresa_Direccion && `Direccion: ${cfg.Empresa_Direccion}`
      ].filter(Boolean).join(' - ');
      doc.fontSize(8).fillColor('#334155').text(contactLine, 42, 132, { width: 380 });
      if (logoFile) {
        try { doc.image(logoFile, pageWidth - 142, 48, { fit: [82, 82], align: 'right' }); } catch (error) {}
      }

      doc.moveTo(42, 155).lineTo(pageWidth - 42, 155).lineWidth(2).strokeColor('#0f172a').stroke();
      addPdfField(doc, 'Fecha', presupuesto.Fecha, 42, 176, 120);
      addPdfField(doc, 'Validez', `${cfg.Presupuesto_Validez_Dias || 15} dias`, 176, 176, 120);
      addPdfField(doc, 'Cliente', presupuesto.Cliente_Nombre, 310, 176, 220);
      addPdfField(doc, 'Tipo', presupuesto.Cliente_Tipo, 42, 220, 90);
      addPdfField(doc, 'CUIT / DNI', presupuesto.Cliente_Documento || 'Pendiente', 142, 220, 120);
      addPdfField(doc, 'Direccion', presupuesto.Direccion, 276, 220, 150);
      addPdfField(doc, 'Unidad', presupuesto.Unidad_Trabajo || 'No especificada', 440, 220, 92);

      doc.roundedRect(42, 270, contentWidth, 150, 8).lineWidth(1).strokeColor('#e2e8f0').stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('DETALLE DE TRABAJO', 56, 286);
      doc.font('Helvetica').fontSize(10).fillColor('#111827').text(String(presupuesto.Detalle_Servicio || '-'), 56, 306, {
        width: contentWidth - 28,
        height: 96,
        lineGap: 3
      });

      const summaryX = pageWidth - 250;
      doc.moveTo(summaryX, 450).lineTo(pageWidth - 42, 450).lineWidth(1.5).strokeColor('#0f172a').stroke();
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text('Total', summaryX, 464);
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text(money(presupuesto.Total), summaryX, 464, { width: 208, align: 'right' });
      if (num(presupuesto.Adelanto) > 0) {
        doc.font('Helvetica').fontSize(8).fillColor('#64748b').text('Adelanto para inicio de trabajo', summaryX, 492, { width: 120 });
        doc.font('Helvetica').fontSize(8).fillColor('#475569').text(money(presupuesto.Adelanto), summaryX, 492, { width: 208, align: 'right' });
      }

      doc.roundedRect(42, 540, contentWidth, 80, 8).lineWidth(1).strokeColor('#e2e8f0').stroke();
      addPdfField(doc, 'Forma de pago', presupuesto.Forma_Pago, 56, 556, 210);
      addPdfField(doc, 'Condicion de pago', presupuesto.Condicion_Pago, 286, 556, 210);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('OBSERVACIONES', 56, 594);
      doc.font('Helvetica').fontSize(9).fillColor('#111827').text(String(presupuesto.Observaciones || '-'), 56, 606, { width: contentWidth - 28 });

      doc.moveTo(42, 760).lineTo(pageWidth - 42, 760).lineWidth(1).strokeColor('#e2e8f0').stroke();
      doc.fontSize(7).fillColor('#64748b').text('Documento generado por ERP Mantenimiento.', 42, 772, { width: contentWidth, align: 'center' });
      doc.end();
    } catch (error) {
      resolve(false);
    }
  });
}

async function createQuoteHtml(presupuesto, cfg) {
  ensureDirs();
  const logoSrc = imageToDataUri(cfg.Empresa_Logo);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(presupuesto.ID)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#111827;margin:34px}.top{border-bottom:3px solid #111827;padding-bottom:16px;margin-bottom:22px;display:flex;justify-content:space-between;gap:20px;align-items:flex-start}
    .logo{max-width:150px;max-height:80px;object-fit:contain}.company{max-width:620px}
    h1{margin:0;font-size:28px}.intro{font-size:12px;line-height:1.45;color:#374151;margin-top:10px;white-space:pre-wrap}.contact{font-size:11px;color:#374151;margin-top:8px}.box{border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin:14px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.label{font-size:10px;text-transform:uppercase;color:#6b7280;font-weight:bold}.val{font-size:13px;margin-top:2px}
    table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#111827;color:white;font-size:11px;text-align:left;padding:9px}td{border-bottom:1px solid #e5e7eb;padding:9px;font-size:12px;vertical-align:top}.right{text-align:right}
    .service-detail{white-space:pre-wrap;line-height:1.5;font-size:13px}
    .summary{margin-left:auto;width:330px;margin-top:16px;border-top:2px solid #111827;padding-top:8px}.summary-row{display:flex;justify-content:space-between;gap:18px;padding:5px 0}.summary-row.total{font-size:18px;font-weight:bold;color:#111827}.summary-row.advance{font-size:11px;color:#6b7280}.summary-label{font-weight:bold}.summary-row.advance .summary-label{font-weight:normal}.summary-value{text-align:right;white-space:nowrap}.summary-row.total .summary-value{font-weight:bold}.footer{font-size:10px;color:#6b7280;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:10px}
    @media print{button{display:none}body{margin:24px}}
  </style></head><body>
    <button onclick="window.print()">Imprimir / guardar PDF</button>
    <div class="top">
      <div class="company">
        <h1>${esc(cfg.Empresa_Nombre)}</h1>
        <div class="intro">${esc(cfg.Empresa_Descripcion)}</div>
        <div class="contact">${[cfg.Empresa_Telefono && 'Tel: ' + cfg.Empresa_Telefono, cfg.Empresa_Whatsapp && 'WhatsApp: ' + cfg.Empresa_Whatsapp, cfg.Empresa_Email && 'Email: ' + cfg.Empresa_Email, cfg.Empresa_Direccion && 'Direccion: ' + cfg.Empresa_Direccion].filter(Boolean).map(esc).join(' - ')}</div>
      </div>
      ${logoSrc ? `<img class="logo" src="${esc(logoSrc)}" alt="Logo">` : ''}
    </div>
    <div class="grid"><div class="box"><div class="label">Fecha</div><div class="val">${esc(presupuesto.Fecha)}</div></div><div class="box"><div class="label">Validez</div><div class="val">${esc(cfg.Presupuesto_Validez_Dias)} dias</div></div><div class="box"><div class="label">Cliente</div><div class="val"><b>${esc(presupuesto.Cliente_Nombre)}</b></div></div><div class="box"><div class="label">CUIT / DNI</div><div class="val">${esc(presupuesto.Cliente_Documento || 'Pendiente')}</div></div></div>
    <div class="box"><div class="grid"><div><div class="label">Direccion</div><div class="val">${esc(presupuesto.Direccion)}</div></div><div><div class="label">Unidad</div><div class="val">${esc(presupuesto.Unidad_Trabajo || 'No especificada')}</div></div></div></div>
    <div class="box"><div class="label">Detalle de trabajo</div><div class="service-detail">${esc(presupuesto.Detalle_Servicio)}</div></div>
    <div class="summary">
      <div class="summary-row total">
        <div><div class="summary-label">Total</div></div>
        <div class="summary-value">${money(presupuesto.Total)}</div>
      </div>
      ${num(presupuesto.Adelanto) > 0 ? `<div class="summary-row advance">
        <div><div class="summary-label">Adelanto para inicio de trabajo</div></div>
        <div class="summary-value">${money(presupuesto.Adelanto)}</div>
      </div>` : ''}
    </div>
    <div class="box"><div class="grid"><div><div class="label">Forma de pago</div><div class="val">${esc(presupuesto.Forma_Pago)}</div></div><div><div class="label">Condicion de pago</div><div class="val">${esc(presupuesto.Condicion_Pago)}</div></div></div><p><b>Observaciones:</b> ${esc(presupuesto.Observaciones || '')}</p></div>
    <div class="footer">Documento generado por ERP Mantenimiento Local.</div>
  </body></html>`;
  const filename = `${presupuesto.ID}-${safeName(presupuesto.Cliente_Nombre)}.html`;
  const file = path.join(quoteDir, filename);
  fs.writeFileSync(file, html);
  const pdfFilename = `${presupuesto.ID}-${safeName(presupuesto.Cliente_Nombre)}.pdf`;
  const pdfFile = path.join(quoteDir, pdfFilename);
  let hasPdf = await renderQuotePdfNative(presupuesto, cfg, pdfFile);
  if (!hasPdf) hasPdf = renderPdfFromHtml(file, pdfFile);
  const pdfUrl = isVercel ? `/api/files/presupuestos/${encodeURIComponent(pdfFilename)}` : `/presupuestos/${pdfFilename}`;
  const htmlUrl = isVercel ? `/api/files/presupuestos/${encodeURIComponent(filename)}` : `/presupuestos/${filename}`;
  return hasPdf ? { file: pdfFile, htmlFile: file, url: pdfUrl } : { file, url: htmlUrl };
}

async function uploadGeneratedQuoteToDrive(presupuesto, quoteFile) {
  if (!appsScriptUrl || !quoteFile?.file || !fs.existsSync(quoteFile.file)) return null;
  const ext = path.extname(quoteFile.file).toLowerCase();
  const mimeType = ext === '.pdf' ? 'application/pdf' : 'text/html';
  const base64 = fs.readFileSync(quoteFile.file).toString('base64');
  try {
    return await uploadDriveFile({
      dataUrl: `data:${mimeType};base64,${base64}`,
      filename: path.basename(quoteFile.file),
      clienteNombre: presupuesto.Cliente_Nombre || '',
      presupuestoId: presupuesto.ID || '',
      tipoArchivo: 'Presupuesto'
    });
  } catch (error) {
    console.warn('No se pudo subir el presupuesto a Drive:', error.message);
    return null;
  }
}

async function setDriveFilePublic(url) {
  if (!url || !appsScriptUrl || !/^https?:\/\//i.test(url)) return { url };
  try {
    return await callAppsScript('setFilePublic', { url });
  } catch (error) {
    console.warn('No se pudo hacer publico el archivo de Drive:', error.message);
    return { url };
  }
}

async function saveTrabajo(data) {
  const db = await readDb();
  if (!data.Cliente_ID) throw new Error('Selecciona un cliente.');
  const cliente = findById(db, 'Clientes', data.Cliente_ID);
  if (!cliente) throw new Error('Cliente no encontrado.');
  const importe = num(data.Importe);
  const cobrado = num(data.Cobrado);
  const estado = data.Estado || 'Pendiente';
  const facturacionEstado = data.Facturacion_Estado || (estado === 'Finalizado' ? 'Pendiente de facturar' : 'No facturado');
  const saved = upsert(db, 'Trabajos', {
    ...data,
    ID: data.ID || nextId(db, 'Trabajos'),
    Fecha_Creacion: data.Fecha_Creacion || now(),
    Cliente_ID: cliente.ID,
    Cliente_Tipo: cliente.Tipo,
    Cliente_Nombre: cliente.Nombre,
    Direccion: data.Direccion || cliente.Direccion,
    Prioridad: data.Prioridad || 'Media',
    Estado: estado,
    Importe: importe,
    Cobrado: cobrado,
    Saldo: importe - cobrado,
    Facturacion_Estado: facturacionEstado,
    Factura_Nro: data.Factura_Nro || '',
    Factura_URL: data.Factura_URL || '',
    Carpeta_Local: data.Carpeta_Local || path.join('public', 'uploads', safeName(cliente.Nombre))
  });
  await writeDb(db);
  return { id: saved.ID };
}

async function convertirPresupuesto(presupuestoId) {
  const db = await readDb();
  const p = findById(db, 'Presupuestos', presupuestoId);
  if (!p) throw new Error('Presupuesto no encontrado.');
  if (p.Estado !== 'Aceptado') throw new Error('Primero cambia el presupuesto a Aceptado.');
  const trabajo = upsert(db, 'Trabajos', {
    ID: nextId(db, 'Trabajos'),
    Fecha_Creacion: now(),
    Cliente_ID: p.Cliente_ID,
    Cliente_Tipo: p.Cliente_Tipo,
    Cliente_Nombre: p.Cliente_Nombre,
    Direccion: p.Direccion,
    Unidad_Trabajo: p.Unidad_Trabajo,
    Titulo: `Trabajo generado desde ${p.ID}`,
    Prioridad: 'Media',
    Estado: 'Pendiente',
    Importe: p.Total,
    Cobrado: 0,
    Saldo: p.Total,
    Presupuesto_ID: p.ID,
    Facturacion_Estado: 'No facturado',
    Observaciones: p.Observaciones
  });
  p.Estado = 'Convertido a trabajo';
  await writeDb(db);
  return { id: trabajo.ID };
}

function ensureTrabajoFromPresupuesto(db, presupuesto) {
  let trabajo = (db.Trabajos || []).find(t => t.Presupuesto_ID === presupuesto.ID && t.Estado !== 'Cancelado');
  if (trabajo) return trabajo;
  trabajo = upsert(db, 'Trabajos', {
    ID: nextId(db, 'Trabajos'),
    Fecha_Creacion: now(),
    Cliente_ID: presupuesto.Cliente_ID,
    Cliente_Tipo: presupuesto.Cliente_Tipo,
    Cliente_Nombre: presupuesto.Cliente_Nombre,
    Direccion: presupuesto.Direccion,
    Unidad_Trabajo: presupuesto.Unidad_Trabajo,
    Titulo: `Trabajo generado desde ${presupuesto.ID}`,
    Prioridad: 'Media',
    Estado: 'Pendiente',
    Importe: presupuesto.Total,
    Cobrado: 0,
    Saldo: presupuesto.Total,
    Presupuesto_ID: presupuesto.ID,
    Facturacion_Estado: 'No facturado',
    Observaciones: presupuesto.Observaciones
  });
  return trabajo;
}

async function updatePresupuestoEstado(id, estado) {
  const valid = ['Borrador', 'Enviado', 'Aceptado', 'En curso', 'Finalizado', 'Facturado', 'Rechazado', 'Vencido', 'Convertido a trabajo'];
  if (!valid.includes(estado)) throw new Error('Estado de presupuesto no valido.');
  const db = await readDb();
  const presupuesto = findById(db, 'Presupuestos', id);
  if (!presupuesto) throw new Error('Presupuesto no encontrado.');
  presupuesto.Estado = estado;
  await writeDb(db);
  return { id: presupuesto.ID, estado: presupuesto.Estado };
}

async function schedulePresupuesto(id, data) {
  const db = await readDb();
  const presupuesto = findById(db, 'Presupuestos', id);
  if (!presupuesto) throw new Error('Presupuesto no encontrado.');
  if (['Rechazado', 'Vencido', 'Facturado'].includes(presupuesto.Estado)) {
    throw new Error('Este presupuesto no esta disponible para coordinar en agenda.');
  }
  if (!data.Fecha_Programada) throw new Error('Selecciona la fecha de inicio.');
  const trabajo = ensureTrabajoFromPresupuesto(db, presupuesto);
  trabajo.Fecha_Programada = data.Fecha_Programada;
  trabajo.Hora_Inicio = data.Hora_Inicio || '';
  trabajo.Hora_Fin = data.Hora_Fin || '';
  trabajo.Tecnico = data.Tecnico || trabajo.Tecnico || '';
  trabajo.Estado = data.Estado_Trabajo || data.Estado || 'Programado';
  if (trabajo.Estado === 'Finalizado') {
    presupuesto.Estado = 'Finalizado';
    trabajo.Facturacion_Estado = trabajo.Facturacion_Estado || 'Pendiente de facturar';
  } else if (trabajo.Estado === 'En curso' || ['Borrador', 'Enviado', 'Aceptado', 'Convertido a trabajo'].includes(presupuesto.Estado)) {
    presupuesto.Estado = 'En curso';
  }
  await writeDb(db);
  return { id: trabajo.ID, presupuestoId: presupuesto.ID };
}

async function scheduleTrabajo(id, data) {
  const db = await readDb();
  const trabajo = findById(db, 'Trabajos', id);
  if (!trabajo) throw new Error('Trabajo no encontrado.');
  if (!data.Fecha_Programada) throw new Error('Selecciona la fecha de inicio.');
  trabajo.Fecha_Programada = data.Fecha_Programada;
  trabajo.Hora_Inicio = data.Hora_Inicio || '';
  trabajo.Hora_Fin = data.Hora_Fin || '';
  trabajo.Estado = 'Programado';
  if (data.Tecnico !== undefined) trabajo.Tecnico = data.Tecnico;
  await writeDb(db);
  return { id: trabajo.ID };
}

async function saveCobro(data) {
  const db = await readDb();
  let trabajo = data.Trabajo_ID ? findById(db, 'Trabajos', data.Trabajo_ID) : null;
  if (trabajo && trabajo.Estado === 'Cerrado') throw new Error('El trabajo esta cerrado. No se pueden cargar mas cobros.');
  if (trabajo) {
    data.Cliente_ID = data.Cliente_ID || trabajo.Cliente_ID;
    data.Presupuesto_ID = data.Presupuesto_ID || trabajo.Presupuesto_ID || '';
  }
  const saved = append(db, 'Cobros', {
    ...data,
    Fecha: data.Fecha || today(),
    Tipo_Cobro: data.Tipo_Cobro || 'Pago parcial',
    Importe: num(data.Importe),
    Facturado: data.Facturado || (data.Factura_Nro || data.Factura_URL ? 'Si' : 'No'),
    Factura_Nro: data.Factura_Nro || '',
    Factura_URL: data.Factura_URL || ''
  });
  if (trabajo) {
    trabajo.Cobrado = num(trabajo.Cobrado) + num(data.Importe);
    trabajo.Saldo = Math.max(num(trabajo.Importe) - num(trabajo.Cobrado), 0);
    if (trabajo.Estado === 'Finalizado' && !trabajo.Facturacion_Estado) trabajo.Facturacion_Estado = 'Pendiente de facturar';
  }
  if (data.Servicio_ID) {
    const servicio = findById(db, 'Servicios', data.Servicio_ID);
    if (servicio) {
      servicio.Cobrado = num(servicio.Cobrado) + num(data.Importe);
      servicio.Saldo = Math.max(num(servicio.Importe) - num(servicio.Cobrado), 0);
      if (servicio.Saldo === 0) servicio.Estado = 'Cobrado';
    }
  }
  await writeDb(db);
  return { id: saved.ID };
}

function parseFacturaInfo(filename) {
  const text = String(filename || '');
  const afip = text.match(/(\d{11})[_-](\d{3})[_-](\d{4,5})[_-](\d{8})/);
  if (afip) {
    return {
      Tipo: afip[2] === '011' ? 'C' : afip[2],
      Punto_Venta: afip[3].padStart(5, '0'),
      Numero: afip[4].padStart(8, '0'),
      Factura_Nro: `${afip[3].padStart(5, '0')}-${afip[4].padStart(8, '0')}`
    };
  }
  const pvComp = text.match(/(?:Punto|PV|Pto)[^\d]*(\d{4,5}).{0,25}?(?:Comp|Nro|Numero)[^\d]*(\d{8})/i);
  if (pvComp) {
    return {
      Punto_Venta: pvComp[1].padStart(5, '0'),
      Numero: pvComp[2].padStart(8, '0'),
      Factura_Nro: `${pvComp[1].padStart(5, '0')}-${pvComp[2].padStart(8, '0')}`
    };
  }
  return {};
}

function parseFacturaText(text) {
  const source = String(text || '').replace(/\s+/g, ' ');
  const out = {};
  const pvComp = source.match(/Punto\s+de\s+Venta:\s*(\d{4,5}).{0,80}?Comp\.?\s*Nro:?\s*(\d{8})/i);
  if (pvComp) {
    out.Punto_Venta = pvComp[1].padStart(5, '0');
    out.Numero = pvComp[2].padStart(8, '0');
    out.Factura_Nro = `${out.Punto_Venta}-${out.Numero}`;
  }
  const tipo = source.match(/\bFACTURA\s+([ABC])\b/i) || source.match(/\b([ABC])\s+FACTURA\b/i);
  if (tipo) out.Tipo = tipo[1].toUpperCase();
  const totalMatch = source.match(/Importe\s+Total:?\s*\$?\s*([\d.,]+)/i)
    || source.match(/Total:?\s*\$?\s*([\d.,]+)/i);
  if (totalMatch) out.Importe = parseMoneyAr(totalMatch[1]);
  if (!out.Importe && /Subtotal:/i.test(source)) {
    const beforeSubtotal = source.split(/Subtotal:/i)[0];
    const amounts = beforeSubtotal.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g) || [];
    const relevant = amounts.filter(value => parseMoneyAr(value) > 1);
    if (relevant.length) out.Importe = parseMoneyAr(relevant[relevant.length - 1]);
  }
  return out;
}

async function extractFacturaPdf(data) {
  const match = String(data.dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error('Archivo invalido.');
  const parsedName = parseFacturaInfo(data.filename || '');
  const buffer = Buffer.from(match[2], 'base64');
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy();
  const parsedText = parseFacturaText(parsed.text || '');
  return {
    ...parsedName,
    ...parsedText,
    textPreview: String(parsed.text || '').slice(0, 800)
  };
}

async function saveFactura(data) {
  const db = await readDb();
  const existing = data.ID ? findById(db, 'Facturas', data.ID) : null;
  const trabajo = data.Trabajo_ID ? findById(db, 'Trabajos', data.Trabajo_ID) : null;
  if (trabajo && trabajo.Estado === 'Cerrado') throw new Error('El trabajo esta cerrado. No se pueden cargar mas facturas.');
  const servicio = data.Servicio_ID ? findById(db, 'Servicios', data.Servicio_ID) : null;
  const presupuesto = data.Presupuesto_ID ? findById(db, 'Presupuestos', data.Presupuesto_ID) : null;
  const cliente = data.Cliente_ID ? findById(db, 'Clientes', data.Cliente_ID) : (trabajo ? findById(db, 'Clientes', trabajo.Cliente_ID) : (servicio ? findById(db, 'Clientes', servicio.Cliente_ID) : (presupuesto ? findById(db, 'Clientes', presupuesto.Cliente_ID) : null)));
  const parsed = parseFacturaInfo(data.Archivo_Nombre || data.filename || '');
  let extracted = {};
  const source = servicio ? ['servicio', servicio] : (trabajo ? ['trabajo', trabajo] : (presupuesto ? ['presupuesto', presupuesto] : null));

  if (!existing && data.Estado !== 'Anulada') {
    if (source && pendingToInvoice(db, source[0], source[1]) <= 0) {
      throw new Error('Este origen ya esta facturado completo. Si falta cobrar, marca la factura existente como cobrada.');
    }
  }

  let drive = {};
  if (data.dataUrl) {
    try {
      extracted = await extractFacturaPdf({ dataUrl: data.dataUrl, filename: data.filename || data.Archivo_Nombre || '' });
    } catch (error) {
      extracted = {};
    }
    drive = await uploadDriveFile({
      dataUrl: data.dataUrl,
      filename: data.filename || data.Archivo_Nombre || 'factura.pdf',
      clienteNombre: cliente?.Nombre || trabajo?.Cliente_Nombre || servicio?.Cliente_Nombre || presupuesto?.Cliente_Nombre || '',
      servicioId: data.Servicio_ID || '',
      trabajoId: data.Trabajo_ID || '',
      presupuestoId: data.Presupuesto_ID || '',
      facturaNro: data.Factura_Nro || parsed.Factura_Nro || ''
    });
  }

  const concepto = data.Concepto || existing?.Concepto || 'Pago parcial';
  const sourcePresupuesto = source ? presupuestoForInvoiceSource(db, source[0], source[1]) : presupuesto;
  const defaultAdelanto = String(concepto || '').trim().toLowerCase() === 'adelanto' ? pendingAdelantoToInvoice(db, sourcePresupuesto) : 0;
  const importe = num(data.Importe || extracted.Importe || defaultAdelanto || trabajo?.Saldo || servicio?.Saldo || trabajo?.Importe || servicio?.Importe || presupuesto?.Total || 0);
  if (!existing && source && data.Estado !== 'Anulada') {
    const pendiente = pendingToInvoice(db, source[0], source[1]);
    if (importe > pendiente) throw new Error(`El importe supera el saldo pendiente de facturar (${money(pendiente)}).`);
  }

  const record = upsert(db, 'Facturas', {
    ...data,
    ...parsed,
    ...extracted,
    ID: data.ID || nextId(db, 'Facturas'),
    Fecha: data.Fecha || today(),
    Cliente_ID: data.Cliente_ID || trabajo?.Cliente_ID || servicio?.Cliente_ID || presupuesto?.Cliente_ID || '',
    Cliente_Nombre: data.Cliente_Nombre || cliente?.Nombre || trabajo?.Cliente_Nombre || servicio?.Cliente_Nombre || presupuesto?.Cliente_Nombre || '',
    Servicio_ID: data.Servicio_ID || '',
    Trabajo_ID: data.Trabajo_ID || '',
    Presupuesto_ID: data.Presupuesto_ID || trabajo?.Presupuesto_ID || '',
    Concepto: concepto,
    Tipo: data.Tipo || extracted.Tipo || parsed.Tipo || 'C',
    Punto_Venta: data.Punto_Venta || extracted.Punto_Venta || parsed.Punto_Venta || '',
    Numero: data.Numero || extracted.Numero || parsed.Numero || '',
    Factura_Nro: data.Factura_Nro || extracted.Factura_Nro || parsed.Factura_Nro || '',
    Importe: importe,
    Estado: data.Estado || existing?.Estado || 'Pendiente de cobro',
    Fecha_Cobro: data.Fecha_Cobro || '',
    Medio_Pago: data.Medio_Pago || 'Transferencia bancaria',
    Archivo_Nombre: data.Archivo_Nombre || data.filename || drive.name || '',
    Drive_URL: data.Drive_URL || drive.url || '',
    Fecha_Carga: data.Fecha_Carga || now()
  });

  if (trabajo && record.Factura_Nro) {
    trabajo.Factura_Nro = record.Factura_Nro;
    trabajo.Factura_URL = record.Drive_URL || trabajo.Factura_URL || '';
    trabajo.Facturacion_Estado = record.Estado === 'Cobrada' ? 'Facturado' : 'Pendiente de facturar';
  }
  if (servicio && record.Estado !== 'Anulada') {
    servicio.Estado = record.Estado === 'Cobrada' ? 'Cobrado' : 'Facturado';
  }
  if (presupuesto && record.Estado !== 'Anulada' && !['Rechazado', 'Vencido', 'Convertido a trabajo'].includes(presupuesto.Estado)) {
    presupuesto.Estado = 'Facturado';
  }

  if (record.Estado === 'Cobrada' && !record.Cobro_ID) {
    const cobro = append(db, 'Cobros', {
      Fecha: record.Fecha_Cobro || today(),
      Cliente_ID: record.Cliente_ID,
      Trabajo_ID: record.Trabajo_ID,
      Presupuesto_ID: record.Presupuesto_ID,
      Servicio_ID: record.Servicio_ID || '',
      Tipo_Cobro: record.Concepto || 'Factura',
      Concepto: `${record.Concepto || 'Factura'} - ${record.Factura_Nro || record.ID}`,
      Medio_Pago: record.Medio_Pago || 'Transferencia bancaria',
      Importe: num(record.Importe),
      Facturado: 'Si',
      Factura_Nro: record.Factura_Nro,
      Factura_URL: record.Drive_URL,
      Observaciones: record.Observaciones || ''
    });
    record.Cobro_ID = cobro.ID;
    const savedFactura = findById(db, 'Facturas', record.ID);
    if (savedFactura) savedFactura.Cobro_ID = cobro.ID;
    if (trabajo) {
      trabajo.Cobrado = num(trabajo.Cobrado) + num(record.Importe);
      trabajo.Saldo = Math.max(num(trabajo.Importe) - num(trabajo.Cobrado), 0);
      if (trabajo.Saldo === 0) trabajo.Estado = 'Facturado';
    }
    if (servicio) {
      servicio.Cobrado = num(servicio.Cobrado) + num(record.Importe);
      servicio.Saldo = Math.max(num(servicio.Importe) - num(servicio.Cobrado), 0);
      if (servicio.Saldo === 0) servicio.Estado = 'Cobrado';
    }
    const presupuestoCobrado = record.Presupuesto_ID ? findById(db, 'Presupuestos', record.Presupuesto_ID) : null;
    if (presupuestoCobrado) {
      presupuestoCobrado.Cobrado = num(presupuestoCobrado.Cobrado) + num(record.Importe);
      presupuestoCobrado.Saldo = Math.max(num(presupuestoCobrado.Total) - num(presupuestoCobrado.Cobrado), 0);
      if (presupuestoCobrado.Saldo === 0 && !['Rechazado', 'Vencido'].includes(presupuestoCobrado.Estado)) presupuestoCobrado.Estado = 'Facturado';
    }
  }

  await writeDb(db);
  return { id: record.ID, facturaNro: record.Factura_Nro, driveUrl: record.Drive_URL };
}

async function cerrarTrabajo(id) {
  const db = await readDb();
  const trabajo = findById(db, 'Trabajos', id);
  if (!trabajo) throw new Error('Trabajo no encontrado.');
  const facturado = (db.Facturas || [])
    .filter(f => f.Trabajo_ID === id && f.Estado !== 'Anulada')
    .reduce((acc, f) => acc + num(f.Importe), 0);
  const pendienteFacturar = Math.max(num(trabajo.Importe) - facturado, 0);
  const pendienteCobrar = Math.max(num(trabajo.Importe) - num(trabajo.Cobrado), 0);
  if (pendienteFacturar > 0 || pendienteCobrar > 0) {
    throw new Error('No se puede cerrar: todavia queda pendiente de facturar o cobrar.');
  }
  trabajo.Estado = 'Cerrado';
  trabajo.Facturacion_Estado = 'Facturado';
  await writeDb(db);
  return { id: trabajo.ID, estado: trabajo.Estado };
}

async function updateTrabajoFacturacion(id, data) {
  const db = await readDb();
  const trabajo = findById(db, 'Trabajos', id);
  if (!trabajo) throw new Error('Trabajo no encontrado.');
  trabajo.Facturacion_Estado = data.Facturacion_Estado || 'Facturado';
  trabajo.Factura_Nro = data.Factura_Nro || trabajo.Factura_Nro || '';
  trabajo.Factura_URL = data.Factura_URL || trabajo.Factura_URL || '';
  if (trabajo.Facturacion_Estado === 'Facturado') trabajo.Estado = 'Facturado';
  await writeDb(db);
  return { id: trabajo.ID };
}

async function uploadTrabajoFile(payload) {
  const db = await readDb();
  const trabajo = findById(db, 'Trabajos', payload.trabajoId);
  if (!trabajo) throw new Error('Trabajo no encontrado.');
  if (trabajo.Estado === 'Cerrado') throw new Error('El trabajo esta cerrado. No se pueden cargar mas adjuntos.');
  const match = String(payload.dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error('Archivo invalido.');
  const ext = (payload.filename || 'archivo').split('.').pop();
  const filename = `${payload.tipo || 'Adjunto'}_${trabajo.ID}_${Date.now()}.${safeName(ext)}`;
  const file = path.join(uploadDir, filename);
  fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
  const saved = append(db, 'Fotos_Trabajos', {
    Trabajo_ID: trabajo.ID,
    Tipo_Foto: payload.tipo || 'Adjunto',
    Descripcion: payload.descripcion || '',
    Archivo_Local: file,
    URL: `/uploads/${filename}`,
    Fecha: now()
  });
  await writeDb(db);
  return { id: saved.ID, url: saved.URL };
}

async function uploadDriveFile(payload) {
  const match = String(payload.dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error('Archivo invalido.');
  const file = {
    filename: safeName(payload.filename || 'factura'),
    mimeType: match[1],
    base64: match[2],
    tipoArchivo: payload.tipoArchivo || 'Factura',
    clienteNombre: payload.clienteNombre || '',
    servicioId: payload.servicioId || '',
    trabajoId: payload.trabajoId || '',
    presupuestoId: payload.presupuestoId || '',
    cobroId: payload.cobroId || '',
    facturaNro: payload.facturaNro || ''
  };
  if (appsScriptUrl) return callAppsScript('uploadFile', { file });

  const filename = `${safeName(file.tipoArchivo)}_${file.servicioId || file.trabajoId || file.presupuestoId || file.cobroId || Date.now()}_${Date.now()}_${file.filename}`;
  const localFile = path.join(uploadDir, filename);
  fs.writeFileSync(localFile, Buffer.from(file.base64, 'base64'));
  return { id: filename, name: filename, url: isVercel ? `/api/files/uploads/${encodeURIComponent(filename)}` : `/uploads/${filename}` };
}

function localAttachment(file, filename, mimeType) {
  if (!file || !fs.existsSync(file)) return null;
  return {
    filename: filename || path.basename(file),
    mimeType: mimeType || 'application/octet-stream',
    base64: fs.readFileSync(file).toString('base64')
  };
}

async function ensurePresupuestoPdf(db, presupuesto, persistDrive = false) {
  if (!presupuesto) return null;
  const cfg = defaultQuoteConfig(configObject(db));
  const quoteData = presupuestoWithClientDocument(db, presupuesto);
  const quoteFile = await createQuoteHtml(quoteData, cfg);
  presupuesto.Archivo_Local = quoteFile.file;
  presupuesto.PDF_URL = quoteFile.url;
  if (persistDrive) {
    const driveQuote = await uploadGeneratedQuoteToDrive(presupuesto, quoteFile);
    if (driveQuote?.url) presupuesto.PDF_URL = driveQuote.url;
  }
  return quoteFile;
}

function presupuestoWithClientDocument(db, presupuesto) {
  const cliente = findById(db, 'Clientes', presupuesto.Cliente_ID);
  const tipo = cliente?.Documento_Tipo || presupuesto.Cliente_Documento_Tipo || 'CUIT/DNI';
  const numero = cliente?.CUIT_DNI || presupuesto.Cliente_CUIT_DNI || '';
  return {
    ...presupuesto,
    Cliente_Documento: numero ? `${tipo}: ${numero}` : `${tipo}: pendiente`
  };
}

async function presupuestoPdfAttachment(db, presupuesto) {
  const quoteFile = await ensurePresupuestoPdf(db, presupuesto, true);
  if (!quoteFile?.file || !fs.existsSync(quoteFile.file)) return null;
  if (presupuesto?.PDF_URL && /^https?:\/\//i.test(presupuesto.PDF_URL)) {
    return { driveUrl: presupuesto.PDF_URL };
  }
  return localAttachment(quoteFile.file, `${presupuesto.ID}.pdf`, 'application/pdf');
}

function emailRecipient(db, cliente, presupuesto) {
  const admin = (db.Administradores || []).find(a => a.Cliente_ID === presupuesto?.Cliente_ID && a.Email);
  if (admin) return { email: admin.Email, name: admin.Contacto || admin.Administracion || 'Administracion' };
  if (presupuesto?.Contacto_Email) return { email: presupuesto.Contacto_Email, name: presupuesto.Contacto_Nombre || cliente?.Nombre || '' };
  return { email: cliente?.Email || '', name: cliente?.Nombre || '' };
}

function presupuestoBillingServer(db, presupuesto) {
  if (!presupuesto) return { total: 0, facturado: 0, saldo: 0 };
  const total = num(presupuesto.Total);
  const facturado = (db.Facturas || [])
    .filter(f => f.Presupuesto_ID === presupuesto.ID && f.Estado !== 'Anulada')
    .reduce((acc, f) => acc + num(f.Importe), 0);
  return { total, facturado, saldo: Math.max(total - facturado, 0) };
}

function isGenericInvoiceConcept(value) {
  return ['pago parcial', 'factura', ''].includes(String(value || '').trim().toLowerCase());
}

function facturaWorkDetail(db, factura, presupuesto) {
  if (!factura) return '';
  const servicio = factura.Servicio_ID ? findById(db, 'Servicios', factura.Servicio_ID) : null;
  const trabajo = factura.Trabajo_ID ? findById(db, 'Trabajos', factura.Trabajo_ID) : null;
  const linkedPresupuesto = presupuesto || (factura.Presupuesto_ID ? findById(db, 'Presupuestos', factura.Presupuesto_ID) : null);
  if (servicio) {
    return [servicio.Tipo, servicio.Titulo, servicio.Detalle].filter(Boolean).join(' - ');
  }
  if (linkedPresupuesto?.Detalle_Servicio) return linkedPresupuesto.Detalle_Servicio;
  if (trabajo) {
    return [trabajo.Titulo, trabajo.Observaciones].filter(Boolean).join(' - ');
  }
  return isGenericInvoiceConcept(factura.Concepto) ? '' : factura.Concepto || '';
}

function emailBody(tipo, item, cliente, extra = {}) {
  const saludo = 'Estimado/a:';
  const firma = 'Saludos.\nPablo Gonzalez Construcciones';
  if (tipo === 'Presupuesto') {
    const detalle = cleanEmailText(item.Detalle_Servicio || '');
    return `${saludo}\n\nAdjuntamos el presupuesto ${item.ID} correspondiente al trabajo solicitado.\n\nDetalle: ${detalle}\nTotal: ${money(item.Total || 0)}\n\nQuedamos atentos a su confirmación.\n\n${firma}`;
  }
  const label = tipo === 'Factura adelanto' ? 'factura de adelanto para inicio de trabajo'
    : tipo === 'Factura cuota' ? 'factura correspondiente a cuota/pago parcial'
    : tipo === 'Factura saldo final' ? 'factura de saldo final'
    : tipo === 'Factura final de trabajo' || tipo === 'Factura final de presupuesto' ? 'factura final por presupuesto realizado'
    : 'factura';
  const detalle = cleanEmailText(extra.facturaDetalle || (!isGenericInvoiceConcept(item.Concepto) ? item.Concepto : '') || extra.detalle || '');
  return `${saludo}\n\nAdjuntamos ${label} ${item.Factura_Nro || item.ID} correspondiente al trabajo realizado.\n\nDetalle de trabajo/factura: ${detalle}\nTotal de la factura: ${money(item.Importe || 0)}\n\n${firma}`;
}

function emailSubject(tipo, item, cliente) {
  const name = cliente?.Nombre || item.Cliente_Nombre || '';
  if (tipo === 'Presupuesto') return `Presupuesto ${item.ID} - ${name}`;
  if (tipo === 'Factura adelanto') return `Factura de adelanto ${item.Factura_Nro || item.ID} - ${name}`;
  if (tipo === 'Factura cuota') return `Factura de cuota ${item.Factura_Nro || item.ID} - ${name}`;
  if (tipo === 'Factura saldo final') return `Factura saldo final ${item.Factura_Nro || item.ID} - ${name}`;
  if (tipo === 'Factura final de trabajo') return `Factura final de trabajo ${item.Factura_Nro || item.ID} - ${name}`;
  if (tipo === 'Factura final de presupuesto') return `Factura final de presupuesto ${item.Factura_Nro || item.ID} - ${name}`;
  return `Factura ${item.Factura_Nro || item.ID} - ${name}`;
}

async function sendBusinessEmail(data) {
  const db = await readDb();
  const tipo = data.Tipo || 'Presupuesto';
  const factura = data.Factura_ID ? findById(db, 'Facturas', data.Factura_ID) : null;
  const presupuesto = data.Presupuesto_ID ? findById(db, 'Presupuestos', data.Presupuesto_ID) : (factura?.Presupuesto_ID ? findById(db, 'Presupuestos', factura.Presupuesto_ID) : null);
  const item = tipo === 'Presupuesto' ? presupuesto : factura;
  if (!item) throw new Error('Selecciona el presupuesto o factura a enviar.');
  const clienteId = item.Cliente_ID || presupuesto?.Cliente_ID || factura?.Cliente_ID || '';
  const cliente = clienteId ? findById(db, 'Clientes', clienteId) : null;
  const recipient = emailRecipient(db, cliente, presupuesto);
  const attachments = [];

  if ((tipo === 'Presupuesto' || data.Incluir_Presupuesto) && presupuesto) {
    const att = await presupuestoPdfAttachment(db, presupuesto);
    if (att) attachments.push(att);
  }
  if (tipo !== 'Presupuesto' && factura?.Drive_URL) {
    attachments.push({ driveUrl: factura.Drive_URL });
  }

  const facturaDetalle = facturaWorkDetail(db, factura, presupuesto);
  const body = cleanEmailText(data.Detalle || emailBody(tipo, item, cliente, { detalle: presupuesto?.Detalle_Servicio, facturaDetalle, destinatario: recipient.name }));
  const email = {
    to: data.Para || recipient.email || '',
    cc: data.CC || '',
    bcc: data.BCC || '',
    subject: data.Asunto || emailSubject(tipo, item, cliente),
    body,
    htmlBody: emailHtmlFromText(body),
    attachments
  };
  if (!email.to) throw new Error('Falta el email del destinatario.');
  if (!appsScriptUrl) throw new Error('El envio real de correos requiere APPS_SCRIPT_URL configurado.');
  await callAppsScript('sendEmail', { email });
  const saved = append(db, 'Correos', {
    Fecha: now(),
    Para: email.to,
    Asunto: email.subject,
    Tipo: tipo,
    Presupuesto_ID: presupuesto?.ID || factura?.Presupuesto_ID || '',
    Factura_ID: factura?.ID || '',
    Cliente_ID: clienteId,
    Estado: 'Enviado',
    Detalle: email.body
  });
  if (tipo === 'Presupuesto' && presupuesto && presupuesto.Estado === 'Borrador') presupuesto.Estado = 'Enviado';
  if (factura) {
    const stamp = `Correo enviado ${today()} a ${email.to}`;
    factura.Observaciones = [factura.Observaciones, stamp].filter(Boolean).join(' | ');
  }
  await writeDb(db);
  return { id: saved.ID };
}

async function searchGlobal(q) {
  const db = await readDb();
  const needle = String(q || '').toLowerCase().trim();
  if (!needle) return [];
  const buckets = [
    { tipo: 'Cliente', rows: db.Clientes, fields: ['ID', 'Tipo', 'Nombre', 'Direccion', 'CUIT_DNI', 'Telefono', 'Whatsapp', 'Email'] },
    { tipo: 'Administrador', rows: db.Administradores, fields: ['ID', 'Administracion', 'Contacto', 'Telefono', 'Whatsapp', 'Email'] },
    { tipo: 'Unidad', rows: db.Unidades, fields: ['ID', 'Unidad', 'Propietario', 'Inquilino', 'Propietario_Whatsapp', 'Inquilino_Whatsapp'] },
    { tipo: 'Servicio', rows: db.Servicios, fields: ['ID', 'Cliente_Nombre', 'Direccion', 'Unidad_Trabajo', 'Tipo', 'Titulo', 'Estado'] },
    { tipo: 'Presupuesto', rows: db.Presupuestos, fields: ['ID', 'Cliente_Nombre', 'Direccion', 'Unidad_Trabajo', 'Total', 'Estado'] },
    { tipo: 'Trabajo', rows: db.Trabajos, fields: ['ID', 'Cliente_Nombre', 'Direccion', 'Unidad_Trabajo', 'Titulo', 'Estado'] },
    { tipo: 'Factura', rows: db.Facturas, fields: ['ID', 'Cliente_Nombre', 'Servicio_ID', 'Trabajo_ID', 'Presupuesto_ID', 'Factura_Nro', 'Importe', 'Estado'] }
  ];
  const out = [];
  buckets.forEach(bucket => {
    bucket.rows.forEach(row => {
      const text = bucket.fields.map(field => row[field] || '').join(' · ');
      if (text.toLowerCase().includes(needle)) out.push({ tipo: bucket.tipo, id: row.ID || '', texto: text });
    });
  });
  return out.slice(0, 30);
}

function ok(data) {
  return { ok: true, data };
}

function fail(res, error) {
  res.status(500).json({ ok: false, message: error.message || String(error) });
}

app.get('/api/auth/session', (req, res) => {
  const session = currentSession(req);
  res.json(ok({ authenticated: Boolean(session), user: session?.user || '' }));
});

app.post('/api/auth/login', (req, res) => {
  try {
    if (!adminUser || !adminPassword || !sessionSecret) throw new Error('Falta configurar el usuario administrador.');
    const user = String(req.body.user || '').trim();
    const password = String(req.body.password || '');
    const userOk = safeCompare(user, adminUser);
    const passOk = safeCompare(password, adminPassword);
    if (!userOk || !passOk) return res.status(401).json({ ok: false, message: 'Usuario o clave incorrectos.' });
    const token = signSession({ user: adminUser, exp: Date.now() + (60 * 60 * 12 * 1000) });
    setSessionCookie(res, token);
    res.json(ok({ user: adminUser }));
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json(ok({ loggedOut: true }));
});

app.get('/api/files/:kind/:filename', (req, res) => {
  const dirs = { uploads: uploadDir, presupuestos: quoteDir };
  const dir = dirs[req.params.kind];
  if (!dir) return res.status(404).send('Archivo no encontrado.');
  const file = path.join(dir, safeName(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).send('Archivo no encontrado.');
  res.sendFile(file);
});

app.post('/api/setup', async (req, res) => {
  try {
    const db = await readDb();
    reconcileBillingLinks(db);
    await writeDb(db);
    res.json(ok({ tables: Object.keys(TABLES), mode: dbMode }));
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/sync-from-sheets', async (req, res) => {
  try {
    if (dbMode !== 'apps-script') throw new Error('La sincronizacion desde Sheets requiere DB_MODE=apps-script.');
    res.json(ok(await syncFromAppsScript()));
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/sync-from-supabase', async (req, res) => {
  try {
    if (dbMode !== 'supabase') throw new Error('La sincronizacion desde Supabase requiere DB_MODE=supabase.');
    res.json(ok(await syncFromSupabase()));
  } catch (error) {
    fail(res, error);
  }
});

app.get('/api/initial-data', async (req, res) => {
  try { res.json(ok(await initialData())); } catch (error) { fail(res, error); }
});

app.get('/api/search', async (req, res) => {
  try { res.json(ok(await searchGlobal(req.query.q))); } catch (error) { fail(res, error); }
});

app.post('/api/clientes', async (req, res) => {
  try { res.json(ok(await saveCliente(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/administradores', async (req, res) => {
  try { res.json(ok(await saveAdministrador(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/administraciones', async (req, res) => {
  try { res.json(ok(await saveAdministracion(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/contactos', async (req, res) => {
  try { res.json(ok(await saveContacto(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/unidades', async (req, res) => {
  try { res.json(ok(await saveUnidad(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/servicios', async (req, res) => {
  try { res.json(ok(await saveServicio(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/presupuestos', async (req, res) => {
  try { res.json(ok(await savePresupuesto(req.body))); } catch (error) { fail(res, error); }
});

app.get('/api/presupuestos/:id/pdf', async (req, res) => {
  try {
    const db = await readDb();
    const presupuesto = findById(db, 'Presupuestos', req.params.id);
    if (!presupuesto) throw new Error('Presupuesto no encontrado.');
    const quoteFile = await ensurePresupuestoPdf(db, presupuesto, false);
    await writeDb(db);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${presupuesto.ID}.pdf"`);
    res.sendFile(path.resolve(quoteFile.file));
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/presupuestos/:id/public-link', async (req, res) => {
  try {
    const db = await readDb();
    const presupuesto = findById(db, 'Presupuestos', req.params.id);
    if (!presupuesto) throw new Error('Presupuesto no encontrado.');
    await ensurePresupuestoPdf(db, presupuesto, true);
    if (presupuesto.PDF_URL && /^https?:\/\//i.test(presupuesto.PDF_URL)) {
      const publicFile = await setDriveFilePublic(presupuesto.PDF_URL);
      presupuesto.PDF_URL = publicFile?.url || presupuesto.PDF_URL;
    }
    await writeDb(db);
    if (!presupuesto.PDF_URL) throw new Error('No se pudo generar el link del presupuesto.');
    res.json(ok({ url: presupuesto.PDF_URL }));
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/trabajos', async (req, res) => {
  try { res.json(ok(await saveTrabajo(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/cobros', async (req, res) => {
  try { res.json(ok(await saveCobro(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/facturas', async (req, res) => {
  try { res.json(ok(await saveFactura(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/facturas/extract', async (req, res) => {
  try { res.json(ok(await extractFacturaPdf(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/facturas/:id/public-link', async (req, res) => {
  try {
    const db = await readDb();
    const factura = findById(db, 'Facturas', req.params.id);
    if (!factura) throw new Error('Factura no encontrada.');
    if (!factura.Drive_URL) throw new Error('La factura no tiene PDF adjunto en Drive.');
    const publicFile = await setDriveFilePublic(factura.Drive_URL);
    factura.Drive_URL = publicFile?.url || factura.Drive_URL;
    await writeDb(db);
    res.json(ok({ url: factura.Drive_URL }));
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/gastos', async (req, res) => {
  try {
    const db = await readDb();
    const saved = append(db, 'Gastos', { ...req.body, Fecha: req.body.Fecha || today(), Importe: num(req.body.Importe) });
    await writeDb(db);
    res.json(ok({ id: saved.ID }));
  } catch (error) { fail(res, error); }
});

app.post('/api/proveedores', async (req, res) => {
  try {
    const db = await readDb();
    const saved = upsert(db, 'Proveedores', { ...req.body, ID: req.body.ID || nextId(db, 'Proveedores'), Estado: req.body.Estado || 'Activo' });
    await writeDb(db);
    res.json(ok({ id: saved.ID }));
  } catch (error) { fail(res, error); }
});

app.post('/api/convertir-presupuesto/:id', async (req, res) => {
  try { res.json(ok(await convertirPresupuesto(req.params.id))); } catch (error) { fail(res, error); }
});

app.post('/api/presupuestos/:id/estado', async (req, res) => {
  try { res.json(ok(await updatePresupuestoEstado(req.params.id, req.body.Estado))); } catch (error) { fail(res, error); }
});

app.post('/api/presupuestos/:id/agenda', async (req, res) => {
  try { res.json(ok(await schedulePresupuesto(req.params.id, req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/trabajos/:id/agenda', async (req, res) => {
  try { res.json(ok(await scheduleTrabajo(req.params.id, req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/trabajos/:id/facturacion', async (req, res) => {
  try { res.json(ok(await updateTrabajoFacturacion(req.params.id, req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/trabajos/:id/cerrar', async (req, res) => {
  try { res.json(ok(await cerrarTrabajo(req.params.id))); } catch (error) { fail(res, error); }
});

app.post('/api/upload-trabajo', async (req, res) => {
  try { res.json(ok(await uploadTrabajoFile(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/upload-drive', async (req, res) => {
  try { res.json(ok(await uploadDriveFile(req.body))); } catch (error) { fail(res, error); }
});

app.post('/api/correos/enviar', async (req, res) => {
  try { res.json(ok(await sendBusinessEmail(req.body))); } catch (error) { fail(res, error); }
});

app.delete('/api/:table/:id', async (req, res) => {
  try {
    const table = req.params.table;
    if (!TABLES[table]) throw new Error('Tabla no permitida.');
    const db = await readDb();
    const result = remove(db, table, req.params.id);
    await writeDb(db);
    res.json(ok(result));
  } catch (error) { fail(res, error); }
});

function bootMessage() {
  ensureDirs();
  readLocalDb();
  console.log(`ERP Mantenimiento Local en http://localhost:${port}`);
  console.log(`Modo base: ${dbMode}`);
  console.log(dbMode === 'google-sheets' ? `Google Sheet: ${spreadsheetId}` : dbMode === 'supabase' ? `Supabase: ${supabaseUrl}` : `Base local: ${dataFile}`);
  if (dbMode === 'apps-script') console.log(`Apps Script: ${appsScriptUrl}`);
}

if (require.main === module) {
  app.listen(port, bootMessage);
}

module.exports = app;
