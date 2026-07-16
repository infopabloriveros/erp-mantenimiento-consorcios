# Despliegue Vercel + Supabase

## 1. Crear Supabase

1. Crear un proyecto en Supabase.
2. Abrir SQL Editor.
3. Pegar y ejecutar `docs/supabase-schema.sql`.
4. Copiar:
   - Project URL
   - Service role key

La service role key es privada. No va en el frontend ni en GitHub publico.

## 2. Variables necesarias

Para probar local con Supabase:

```env
DB_MODE=supabase
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
APPS_SCRIPT_TOKEN=
APPS_SCRIPT_READ_MODE=cache
```

En Vercel cargar las mismas variables en Project Settings > Environment Variables.

## 3. Migrar datos actuales a Supabase

Con la app local levantada y `DB_MODE=supabase`, entrar a:

```txt
http://localhost:3000/
```

Luego ejecutar setup desde la app o llamar:

```txt
POST http://localhost:3000/api/setup
```

Si Supabase esta vacio, la app sube la base local actual.

## 4. Vercel

El proyecto ya incluye:

- `api/index.js`
- `vercel.json`

Vercel ejecuta la API con Node y sirve los archivos de `public`.

## 5. Pendiente importante

La base ya queda preparada para Supabase. Los archivos PDF, facturas y adjuntos todavia usan:

- Apps Script / Drive si `APPS_SCRIPT_URL` esta configurado.
- Archivo temporal/local como respaldo.

Para produccion conviene mover todos los adjuntos a Drive o Supabase Storage.
