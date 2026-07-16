# ERP Mantenimiento Local

Esta version puede funcionar de dos maneras:

- Gratis y 100% local con archivo JSON en tu PC.
- Local con Google Sheets como base, si luego configurás credenciales.

## Modo gratis local

Ya viene configurado con:

```text
DB_MODE=local-json
```

La base se guarda en:

```text
data/db.json
```

Para usarlo:

```bash
npm install
npm start
```

Abrir:

```text
http://localhost:3000
```

Tambien podes abrir `iniciar-erp.bat`. Ese archivo inicia el servidor y abre el navegador.

## Modulos locales incluidos

- Dashboard
- Clientes particulares, empresas y consorcios
- Administradores de consorcios
- Unidades con propietario e inquilino
- Presupuestos con items libres
- Presupuesto imprimible / guardar como PDF desde el navegador
- Trabajos con tablero Kanban
- Agenda semanal
- Adjuntos locales por trabajo
- Cobros
- Gastos
- Historial por cliente
- Buscador global

## Arquitectura

La documentacion tecnica inicial esta en `docs/architecture.md`.

## Modo Google Sheets

Hay dos formas de usar Google Sheets.

### Opcion simple: Apps Script

Esta es la recomendada si no queres configurar Google Cloud.

1. Abri tu Google Sheet.
2. Entra en **Extensiones > Apps Script**.
3. Borra el contenido de `Code.gs`.
4. Copia y pega el contenido de:

```text
docs/Code.gs
```

5. Guarda el proyecto.
6. Toca **Implementar > Nueva implementacion**.
7. Elegi tipo **Aplicacion web**.
8. Ejecutar como: **Yo**.
9. Quien tiene acceso: **Cualquier usuario**.
10. Autoriza los permisos.
11. Copia la URL que termina en `/exec`.
12. En `.env`, usa:

```text
DB_MODE=apps-script
APPS_SCRIPT_URL=pega_aqui_la_url_de_apps_script
```

13. Reinicia la app local.

Cuando la app se conecte por primera vez, crea todas las hojas y columnas. Si la hoja esta vacia, sube automaticamente la base local actual.

### Opcion avanzada: cuenta de servicio

Si querés usar Google Sheets con credenciales de Google Cloud, cambiá `.env`:

```text
DB_MODE=google-sheets
```

## Como funciona

- La app web abre en `http://localhost:3000`.
- El servidor local lee y escribe en Google Sheets usando una cuenta de servicio de Google.
- No usa Apps Script.

## Instalacion

1. Crear una planilla de Google Sheets.
2. Copiar el ID de la planilla desde la URL.
3. Crear una cuenta de servicio en Google Cloud.
4. Descargar el JSON de credenciales y guardarlo como `service-account.json`.
5. Compartir la planilla con el email de la cuenta de servicio.
6. Copiar `.env.example` como `.env`.
7. Pegar el ID de la planilla en `SPREADSHEET_ID`.
8. Instalar dependencias:

```bash
npm install
```

9. Iniciar:

```bash
npm start
```

10. Abrir:

```text
http://localhost:3000
```

## Primer uso

En la app, tocar **Preparar base**. Eso crea las hojas necesarias:

- Clientes
- Consorcios
- Trabajos
- Presupuestos
- Pagos
- Agenda
- Proveedores
- Logs
