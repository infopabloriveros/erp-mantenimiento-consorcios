module.exports = (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  let supabaseHost = '';
  let supabaseUrlLooksValid = false;
  try {
    const parsed = new URL(supabaseUrl);
    supabaseHost = parsed.hostname;
    supabaseUrlLooksValid = parsed.protocol === 'https:' && parsed.hostname.endsWith('.supabase.co');
  } catch (error) {
    supabaseHost = 'URL invalida';
  }
  res.status(200).json({
    ok: true,
    runtime: 'vercel',
    dbMode: process.env.DB_MODE || '',
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    supabaseHost,
    supabaseUrlLooksValid,
    hasSupabaseSecretKey: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasAppsScriptUrl: Boolean(process.env.APPS_SCRIPT_URL),
    nodeEnv: process.env.NODE_ENV || '',
    vercel: Boolean(process.env.VERCEL)
  });
};
