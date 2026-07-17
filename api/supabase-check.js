const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const url = String(process.env.SUPABASE_URL || '').trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
    if (!url || !key) {
      return res.status(500).json({
        ok: false,
        message: 'Faltan SUPABASE_URL o SUPABASE_SECRET_KEY.'
      });
    }
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { count, error } = await supabase
      .from('erp_rows')
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    res.status(200).json({ ok: true, host: new URL(url).hostname, count });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message || String(error),
      cause: error.cause?.message || error.cause?.code || ''
    });
  }
};
