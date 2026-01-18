const HARDCODED_CONFIG ={
  supabaseUrl: 'https://evdjfpzxirsuryawjtql.supabase.co',
  supabaseAnonKey: 'sb_publishable_DM1LTYa35ycFbloXyDofSw_PDDGKdrm',
  orgId: '11111111-1111-1111-1111-111111111111',
}
export function getConfig() {
  const fromEnv = {
    supabaseUrl: window.SUPABASE_URL,
    supabaseAnonKey: window.SUPABASE_ANON_KEY,
    orgId: window.SUPABASE_ORG_ID,
    googleMapsApiKey: window.GOOGLE_MAPS_API_KEY,
  };

  const fromStorage = {
    supabaseUrl: localStorage.getItem('SUPABASE_URL'),
    supabaseAnonKey: localStorage.getItem('SUPABASE_ANON_KEY'),
    orgId: localStorage.getItem('ORG_ID'),
  };

 const supabaseUrl =
    fromEnv.supabaseUrl || fromStorage.supabaseUrl || HARDCODED_CONFIG.supabaseUrl || '';
  const supabaseAnonKey =
    fromEnv.supabaseAnonKey || fromStorage.supabaseAnonKey || HARDCODED_CONFIG.supabaseAnonKey || '';
  const orgId = fromEnv.orgId || fromStorage.orgId || HARDCODED_CONFIG.orgId || '';

  return {
    supabaseUrl,
    supabaseAnonKey,
    orgId,
  };
}

export function saveConfig({ supabaseUrl, supabaseAnonKey, orgId, googleMapsApiKey }) {
  if (supabaseUrl) {
    localStorage.setItem('SUPABASE_URL', supabaseUrl);
  }
  if (supabaseAnonKey) {
    localStorage.setItem('SUPABASE_ANON_KEY', supabaseAnonKey);
  }
  if (orgId) {
    localStorage.setItem('ORG_ID', orgId);
  }
   if (googleMapsApiKey) {
    localStorage.setItem('GOOGLE_MAPS_API_KEY', googleMapsApiKey);
  }
}
