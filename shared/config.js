
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
    googleMapsApiKey: localStorage.getItem('GOOGLE_MAPS_API_KEY'),
  };

  const supabaseUrl = fromEnv.supabaseUrl || fromStorage.supabaseUrl || '';
  const supabaseAnonKey = fromEnv.supabaseAnonKey || fromStorage.supabaseAnonKey || '';
  const orgId = fromEnv.orgId || fromStorage.orgId || '';

  const googleMapsApiKey = fromEnv.googleMapsApiKey || fromStorage.googleMapsApiKey || '';
  return {
    supabaseUrl,
    supabaseAnonKey,
    orgId,
    googleMapsApiKey,
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
