const TABLES = {
  Config: ['Clave', 'Valor', 'Descripcion'],
  Clientes: ['ID', 'Tipo', 'Nombre', 'Documento_Tipo', 'CUIT_DNI', 'Direccion', 'Localidad', 'Provincia', 'CP', 'Telefono', 'Whatsapp', 'Email', 'Estado', 'Observaciones', 'Carpeta_Local', 'Fecha_Alta', 'Ultima_Modificacion'],
  Consorcios: ['ID', 'Cliente_ID', 'Nombre_Edificio', 'Direccion', 'Pisos', 'Unidades', 'Codigo_Interno', 'Observaciones', 'Estado'],
  Administraciones: ['ID', 'Nombre', 'Contacto', 'Cargo', 'Telefono', 'Whatsapp', 'Email', 'Direccion', 'Observaciones', 'Estado'],
  Administradores: ['ID', 'Cliente_ID', 'Consorcio_ID', 'Administracion_ID', 'Administracion', 'Contacto', 'Cargo', 'Telefono', 'Whatsapp', 'Email', 'Direccion', 'Observaciones', 'Estado'],
  Contactos: ['ID', 'Cliente_ID', 'Consorcio_ID', 'Rol', 'Nombre', 'Telefono', 'Whatsapp', 'Email', 'Unidad', 'Piso', 'Depto', 'Observaciones', 'Estado'],
  Unidades: ['ID', 'Cliente_ID', 'Consorcio_ID', 'Unidad', 'Piso', 'Depto', 'Propietario', 'Propietario_Tel', 'Propietario_Whatsapp', 'Propietario_Email', 'Inquilino', 'Inquilino_Tel', 'Inquilino_Whatsapp', 'Inquilino_Email', 'Encargado', 'Encargado_Tel', 'Encargado_Whatsapp', 'Observaciones', 'Estado'],
  Servicios: ['ID', 'Fecha', 'Cliente_ID', 'Cliente_Tipo', 'Cliente_Nombre', 'Direccion', 'Unidad_Trabajo', 'Tipo', 'Titulo', 'Detalle', 'Prioridad', 'Estado', 'Tecnico', 'Importe', 'Cobrado', 'Saldo', 'Presupuesto_ID', 'Trabajo_ID', 'Observaciones'],
  Presupuestos: ['ID', 'Fecha', 'Cliente_ID', 'Cliente_Tipo', 'Cliente_Nombre', 'Direccion', 'Unidad_Trabajo', 'Contacto_Nombre', 'Contacto_Whatsapp', 'Contacto_Email', 'Forma_Pago', 'Condicion_Pago', 'Detalle_Servicio', 'Importe_Servicio', 'Materiales', 'Otros', 'Subtotal', 'IVA_Porc', 'IVA', 'Descuento', 'Adelanto', 'Cuotas', 'Total', 'Cobrado', 'Saldo', 'Estado', 'PDF_URL', 'Archivo_Local', 'Observaciones', 'Fecha_Creacion'],
  Detalle_Presupuestos: ['ID', 'Presupuesto_ID', 'Cantidad', 'Descripcion', 'Precio_Unitario', 'Subtotal'],
  Trabajos: ['ID', 'Fecha_Creacion', 'Cliente_ID', 'Cliente_Tipo', 'Cliente_Nombre', 'Direccion', 'Unidad_Trabajo', 'Titulo', 'Prioridad', 'Estado', 'Tecnico', 'Fecha_Programada', 'Hora_Inicio', 'Hora_Fin', 'Importe', 'Cobrado', 'Saldo', 'Presupuesto_ID', 'Facturacion_Estado', 'Factura_Nro', 'Factura_URL', 'Carpeta_Local', 'Observaciones'],
  Fotos_Trabajos: ['ID', 'Trabajo_ID', 'Tipo_Foto', 'Descripcion', 'Archivo_Local', 'URL', 'Fecha'],
  Facturas: ['ID', 'Fecha', 'Cliente_ID', 'Cliente_Nombre', 'Servicio_ID', 'Trabajo_ID', 'Presupuesto_ID', 'Cobro_ID', 'Concepto', 'Tipo', 'Punto_Venta', 'Numero', 'Factura_Nro', 'Importe', 'Estado', 'Fecha_Cobro', 'Medio_Pago', 'Archivo_Nombre', 'Drive_URL', 'Observaciones', 'Fecha_Carga'],
  Cobros: ['ID', 'Fecha', 'Cliente_ID', 'Trabajo_ID', 'Presupuesto_ID', 'Servicio_ID', 'Tipo_Cobro', 'Concepto', 'Medio_Pago', 'Importe', 'Facturado', 'Factura_Nro', 'Factura_URL', 'Observaciones'],
  Correos: ['ID', 'Fecha', 'Para', 'Asunto', 'Tipo', 'Presupuesto_ID', 'Factura_ID', 'Cliente_ID', 'Estado', 'Detalle'],
  Correos: ['ID', 'Fecha', 'Para', 'Asunto', 'Tipo', 'Presupuesto_ID', 'Factura_ID', 'Cliente_ID', 'Estado', 'Detalle'],
  Gastos: ['ID', 'Fecha', 'Categoria', 'Proveedor', 'Concepto', 'Medio_Pago', 'Importe', 'Comprobante_URL', 'Observaciones'],
  Proveedores: ['ID', 'Nombre', 'Rubro', 'CUIT', 'Telefono', 'Email', 'Documentacion', 'Estado', 'Observaciones']
};

const PREFIX = {
  Clientes: 'CLI',
  Consorcios: 'CON',
  Administraciones: 'ADS',
  Administradores: 'ADM',
  Contactos: 'CTO',
  Unidades: 'UNI',
  Servicios: 'SER',
  Presupuestos: 'PRE',
  Detalle_Presupuestos: 'DPR',
  Trabajos: 'TRA',
  Fotos_Trabajos: 'FOT',
  Facturas: 'FAC',
  Cobros: 'COB',
  Correos: 'EMA',
  Correos: 'EMA',
  Gastos: 'GAS',
  Proveedores: 'PRO'
};

module.exports = { TABLES, PREFIX };
