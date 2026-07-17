require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { TABLES } = require('../src/backend/models/schema');

const root = path.resolve(__dirname, '..');
const dbFile = path.join(root, 'data', 'db.json');
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();

function rowIdFor(table, row, index) {
  return String(row.ID || row.Clave || `${table}-${index + 1}`);
}

async function main() {
  if (!supabaseUrl || !supabaseKey) throw new Error('Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en .env');
  if (!fs.existsSync(dbFile)) throw new Error(`No existe ${dbFile}`);

  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
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

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error: deleteError } = await supabase
    .from('erp_rows')
    .delete()
    .neq('table_name', '__never__');
  if (deleteError) throw deleteError;

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('erp_rows')
      .upsert(rows.slice(i, i + 500), { onConflict: 'table_name,row_id' });
    if (error) throw error;
  }

  console.log(JSON.stringify({ ok: true, rows: rows.length, host: new URL(supabaseUrl).hostname }));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, message: error.message || String(error) }));
  process.exit(1);
});
