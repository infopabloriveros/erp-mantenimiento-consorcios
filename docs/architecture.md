# Arquitectura del ERP Mantenimiento Local

## Objetivo

Evolucionar el ERP por capas sin romper la aplicacion existente.

## Capas previstas

- `src/backend/models`: contratos de datos, tablas y prefijos de IDs.
- `src/backend/repositories`: persistencia intercambiable entre JSON local y Google Sheets.
- `src/backend/services`: reglas de negocio.
- `src/backend/controllers`: entrada/salida de la API.
- `src/backend/routes`: definicion REST.
- `src/backend/middlewares`: seguridad, auditoria y validacion.
- `src/backend/utils`: utilidades compartidas.
- `public`: frontend HTML/CSS/JavaScript actual.

## Primer paso aplicado

Se extrajo el schema de tablas y prefijos desde `server.js` hacia `src/backend/models/schema.js`.

Esto mantiene compatibilidad total y prepara el siguiente paso: mover la persistencia a un repositorio dedicado.
