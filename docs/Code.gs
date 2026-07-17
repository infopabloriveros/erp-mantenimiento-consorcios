const TABLES = {
  Config: ['Clave', 'Valor', 'Descripcion'],
  Clientes: ['ID', 'Tipo', 'Nombre', 'Documento_Tipo', 'CUIT_DNI', 'Direccion', 'Localidad', 'Provincia', 'CP', 'Telefono', 'Whatsapp', 'Email', 'Estado', 'Observaciones', 'Carpeta_Local', 'Fecha_Alta', 'Ultima_Modificacion'],
  Consorcios: ['ID', 'Cliente_ID', 'Nombre_Edificio', 'Direccion', 'Pisos', 'Unidades', 'Codigo_Interno', 'Observaciones', 'Estado'],
  Administraciones: ['ID', 'Nombre', 'Contacto', 'Cargo', 'Telefono', 'Whatsapp', 'Email', 'Direccion', 'Observaciones', 'Estado'],
  Administradores: ['ID', 'Cliente_ID', 'Consorcio_ID', 'Administracion_ID', 'Administracion', 'Contacto', 'Cargo', 'Telefono', 'Whatsapp', 'Email', 'Direccion', 'Observaciones', 'Estado'],
  Contactos: ['ID', 'Cliente_ID', 'Consorcio_ID', 'Rol', 'Nombre', 'Telefono', 'Whatsapp', 'Email', 'Unidad', 'Piso', 'Depto', 'Observaciones', 'Estado'],
  Unidades: ['ID', 'Cliente_ID', 'Consorcio_ID', 'Unidad', 'Piso', 'Depto', 'Propietario', 'Propietario_Tel', 'Propietario_Whatsapp', 'Propietario_Email', 'Inquilino', 'Inquilino_Tel', 'Inquilino_Whatsapp', 'Inquilino_Email', 'Encargado', 'Encargado_Tel', 'Encargado_Whatsapp', 'Observaciones', 'Estado'],
  Servicios: ['ID', 'Fecha', 'Cliente_ID', 'Cliente_Tipo', 'Cliente_Nombre', 'Direccion', 'Unidad_Trabajo', 'Tipo', 'Titulo', 'Detalle', 'Prioridad', 'Estado', 'Tecnico', 'Importe', 'Cobrado', 'Saldo', 'Presupuesto_ID', 'Trabajo_ID', 'Observaciones'],
  Presupuestos: ['ID', 'Fecha', 'Cliente_ID', 'Cliente_Tipo', 'Cliente_Nombre', 'Direccion', 'Unidad_Trabajo', 'Contacto_Nombre', 'Contacto_Whatsapp', 'Contacto_Email', 'Forma_Pago', 'Condicion_Pago', 'Detalle_Servicio', 'Importe_Servicio', 'Materiales', 'Otros', 'Subtotal', 'IVA_Porc', 'IVA', 'Descuento', 'Adelanto', 'Cuotas', 'Total', 'Estado', 'PDF_URL', 'Archivo_Local', 'Observaciones', 'Fecha_Creacion'],
  Detalle_Presupuestos: ['ID', 'Presupuesto_ID', 'Cantidad', 'Descripcion', 'Precio_Unitario', 'Subtotal'],
  Trabajos: ['ID', 'Fecha_Creacion', 'Cliente_ID', 'Cliente_Tipo', 'Cliente_Nombre', 'Direccion', 'Unidad_Trabajo', 'Titulo', 'Prioridad', 'Estado', 'Tecnico', 'Fecha_Programada', 'Hora_Inicio', 'Hora_Fin', 'Importe', 'Cobrado', 'Saldo', 'Presupuesto_ID', 'Facturacion_Estado', 'Factura_Nro', 'Factura_URL', 'Carpeta_Local', 'Observaciones'],
  Fotos_Trabajos: ['ID', 'Trabajo_ID', 'Tipo_Foto', 'Descripcion', 'Archivo_Local', 'URL', 'Fecha'],
  Facturas: ['ID', 'Fecha', 'Cliente_ID', 'Cliente_Nombre', 'Servicio_ID', 'Trabajo_ID', 'Presupuesto_ID', 'Cobro_ID', 'Concepto', 'Tipo', 'Punto_Venta', 'Numero', 'Factura_Nro', 'Importe', 'Estado', 'Fecha_Cobro', 'Medio_Pago', 'Archivo_Nombre', 'Drive_URL', 'Observaciones', 'Fecha_Carga'],
  Cobros: ['ID', 'Fecha', 'Cliente_ID', 'Trabajo_ID', 'Presupuesto_ID', 'Servicio_ID', 'Tipo_Cobro', 'Concepto', 'Medio_Pago', 'Importe', 'Facturado', 'Factura_Nro', 'Factura_URL', 'Observaciones'],
  Correos: ['ID', 'Fecha', 'Para', 'Asunto', 'Tipo', 'Presupuesto_ID', 'Factura_ID', 'Cliente_ID', 'Estado', 'Detalle'],
  Gastos: ['ID', 'Fecha', 'Categoria', 'Proveedor', 'Concepto', 'Medio_Pago', 'Importe', 'Comprobante_URL', 'Observaciones'],
  Proveedores: ['ID', 'Nombre', 'Rubro', 'CUIT', 'Telefono', 'Email', 'Documentacion', 'Estado', 'Observaciones']
};

function doGet() {
  setupSheets_();
  return json_({ ok: true, data: { status: 'ERP Mantenimiento Apps Script activo', tables: Object.keys(TABLES) } });
}

function probarDrive() {
  const folder = getOrCreateFolder_('ERP Mantenimiento Facturas');
  const file = folder.createFile('prueba-autorizacion.txt', 'Drive conectado con ERP Mantenimiento.');
  return file.getUrl();
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');
    checkToken_(body.token);
    setupSheets_();

    if (body.action === 'read') return json_({ ok: true, data: readDb_() });
    if (body.action === 'write') {
      writeDb_(body.db || {});
      return json_({ ok: true, data: { saved: true } });
    }
    if (body.action === 'uploadFile') return json_({ ok: true, data: uploadFile_(body.file || {}) });
    if (body.action === 'sendEmail') return json_({ ok: true, data: sendEmail_(body.email || {}) });
    if (body.action === 'setup') return json_({ ok: true, data: { tables: Object.keys(TABLES) } });

    throw new Error('Accion no permitida.');
  } catch (error) {
    return json_({ ok: false, message: error.message || String(error) });
  }
}

function checkToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('APP_TOKEN');
  if (expected && token !== expected) throw new Error('Token invalido.');
}

function setupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABLES).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = TABLES[name];
    const currentWidth = Math.max(sheet.getLastColumn(), headers.length);
    const current = sheet.getRange(1, 1, 1, currentWidth).getValues()[0];
    const hasHeaders = current.some(Boolean);
    if (!hasHeaders) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, headers.length);
      return;
    }
    const missing = headers.filter(header => current.indexOf(header) === -1);
    if (missing.length) {
      sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, current.length + missing.length);
    }
  });
}

function readDb_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const db = {};
  Object.keys(TABLES).forEach(name => {
    const sheet = ss.getSheetByName(name);
    const headers = TABLES[name];
    db[name] = [];
    if (!sheet || sheet.getLastRow() < 2) return;
    const values = sheet.getRange(1, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), headers.length)).getValues();
    const sheetHeaders = values[0];
    db[name] = values.slice(1).map(rowValues => {
      const row = {};
      headers.forEach(field => {
        const index = sheetHeaders.indexOf(field);
        row[field] = index >= 0 ? String(rowValues[index] || '').trim() : '';
      });
      return row;
    }).filter(row => Object.values(row).some(Boolean));
  });
  return db;
}

function writeDb_(db) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABLES).forEach(name => {
    const headers = TABLES[name];
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    sheet.clearContents();
    const rows = Array.isArray(db[name]) ? db[name] : [];
    const values = [headers].concat(rows.map(row => headers.map(field => row[field] || '')));
    sheet.getRange(1, 1, values.length, headers.length).setValues(values);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  });
}

function uploadFile_(file) {
  if (!file.base64) throw new Error('Falta el archivo.');
  const root = getOrCreateFolder_('ERP Mantenimiento');
  const folder = getOrCreateChildFolder_(root, file.tipoArchivo || 'Facturas');
  const context = [
    file.clienteNombre,
    file.tipoArchivo,
    file.servicioId,
    file.trabajoId,
    file.presupuestoId,
    file.cobroId,
    file.facturaNro
  ].filter(Boolean).join(' - ');
  const name = sanitizeFileName_([context, file.filename || 'factura'].filter(Boolean).join(' - '));
  const blob = Utilities.newBlob(Utilities.base64Decode(file.base64), file.mimeType || 'application/octet-stream', name);
  const created = folder.createFile(blob);
  return {
    id: created.getId(),
    name: created.getName(),
    url: created.getUrl()
  };
}

function sendEmail_(email) {
  if (!email.to) throw new Error('Falta el destinatario.');
  if (!email.subject) throw new Error('Falta el asunto.');
  const attachments = (email.attachments || []).map(function(att) {
    if (att.base64) {
      return Utilities.newBlob(Utilities.base64Decode(att.base64), att.mimeType || 'application/octet-stream', att.filename || 'archivo');
    }
    if (att.driveUrl) {
      const id = extractDriveId_(att.driveUrl);
      if (!id) throw new Error('No se pudo leer el archivo de Drive.');
      return DriveApp.getFileById(id).getBlob();
    }
    throw new Error('Adjunto invalido.');
  });
  MailApp.sendEmail({
    to: email.to,
    cc: email.cc || '',
    bcc: email.bcc || '',
    subject: email.subject,
    body: email.body || '',
    htmlBody: email.htmlBody || String(email.body || '').replace(/\n/g, '<br>'),
    attachments: attachments
  });
  return { sent: true };
}

function extractDriveId_(url) {
  const text = String(url || '');
  const match = text.match(/\/d\/([a-zA-Z0-9_-]+)/) || text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : '';
}

function getOrCreateFolder_(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function getOrCreateChildFolder_(parent, name) {
  const safe = sanitizeFileName_(name || 'Archivos');
  const folders = parent.getFoldersByName(safe);
  return folders.hasNext() ? folders.next() : parent.createFolder(safe);
}

function sanitizeFileName_(name) {
  return String(name || 'archivo').replace(/[\\/:*?"<>|#%{}~&]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
