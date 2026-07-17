module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    runtime: 'vercel',
    dbMode: process.env.DB_MODE || '',
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseSecretKey: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasAppsScriptUrl: Boolean(process.env.APPS_SCRIPT_URL),
    nodeEnv: process.env.NODE_ENV || '',
    vercel: Boolean(process.env.VERCEL)
  });
};
