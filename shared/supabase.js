
export function getConfig() {
  const fromEnv = {
    supabaseUrl: "https://evdjfpzxirsuryawjtql.supabase.co",
    supabaseAnonKey: "sb_publishable_DM1LTYa35ycFbloXyDofSw_PDDGKdrm",
    orgId: window.SUPABASE_ORG_ID,
  };

  const fromStorage = {
    supabaseUrl: localStorage.getItem('SUPABASE_URL'),
    supabaseAnonKey: localStorage.getItem('SUPABASE_ANON_KEY'),
    orgId: localStorage.getItem('ORG_ID'),
  };

  const supabaseUrl = fromEnv.supabaseUrl || fromStorage.supabaseUrl || '';
  const supabaseAnonKey = fromEnv.supabaseAnonKey || fromStorage.supabaseAnonKey || '';
  const orgId = fromEnv.orgId || fromStorage.orgId || '';

  return {
    supabaseUrl,
    supabaseAnonKey,
    orgId,
  };
}

export function saveConfig({ supabaseUrl, supabaseAnonKey, orgId }) {
  if (supabaseUrl) {
    localStorage.setItem('SUPABASE_URL', supabaseUrl);
  }
  if (supabaseAnonKey) {
    localStorage.setItem('SUPABASE_ANON_KEY', supabaseAnonKey);
  }
  if (orgId) {
    localStorage.setItem('ORG_ID', orgId);
  }
}
