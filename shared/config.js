export const DEFAULT_CONFIG = {
  supabaseUrl: 'https://evdjfpzxirsuryawjtql.supabase.co',
  supabaseAnonKey: 'sb_publishable_DM1LTYa35ycFbloXyDofSw_PDDGKdrm',
  orgId: '11111111-1111-1111-1111-111111111111',
};

function normalizeConfigValue(value) {
  if (value === undefined || value === null) return '';
  if (value === 'null' || value === 'undefined') return '';
  return value;
}

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('Config storage read failed', error);
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('Config storage write failed', error);
  }
}

export function getConfig() {
  const fromEnv = {
    supabaseUrl: window.SUPABASE_URL,
    supabaseAnonKey: window.SUPABASE_ANON_KEY,
    orgId: window.SUPABASE_ORG_ID,
    googleMapsApiKey: window.GOOGLE_MAPS_API_KEY,
  };

  const fromStorage = {
    supabaseUrl: safeGetItem('SUPABASE_URL'),
    supabaseAnonKey: safeGetItem('SUPABASE_ANON_KEY'),
    orgId: safeGetItem('ORG_ID'),
    googleMapsApiKey: safeGetItem('GOOGLE_MAPS_API_KEY'),
  };

  let supabaseUrl = normalizeConfigValue(fromEnv.supabaseUrl)
    || normalizeConfigValue(fromStorage.supabaseUrl)
    || DEFAULT_CONFIG.supabaseUrl
    || '';
  let supabaseAnonKey = normalizeConfigValue(fromEnv.supabaseAnonKey)
    || normalizeConfigValue(fromStorage.supabaseAnonKey)
    || DEFAULT_CONFIG.supabaseAnonKey
    || '';
  let orgId = normalizeConfigValue(fromEnv.orgId)
    || normalizeConfigValue(fromStorage.orgId)
    || DEFAULT_CONFIG.orgId
    || '';
  let googleMapsApiKey = normalizeConfigValue(fromEnv.googleMapsApiKey)
    || normalizeConfigValue(fromStorage.googleMapsApiKey)
    || '';

  if (supabaseUrl) {
    safeSetItem('SUPABASE_URL', supabaseUrl);
  }
  if (supabaseAnonKey) {
    safeSetItem('SUPABASE_ANON_KEY', supabaseAnonKey);
  }
  if (orgId) {
    safeSetItem('ORG_ID', orgId);
  }
  if (googleMapsApiKey) {
    safeSetItem('GOOGLE_MAPS_API_KEY', googleMapsApiKey);
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    orgId,
    googleMapsApiKey,
  };
}

export function saveConfig({ supabaseUrl, supabaseAnonKey, orgId, googleMapsApiKey }) {
  if (supabaseUrl) {
    safeSetItem('SUPABASE_URL', supabaseUrl);
  }
  if (supabaseAnonKey) {
   safeSetItem('SUPABASE_ANON_KEY', supabaseAnonKey);
  }
  if (orgId) {
    safeSetItem('ORG_ID', orgId);
  }
  if (googleMapsApiKey !== undefined) {
    safeSetItem('GOOGLE_MAPS_API_KEY', googleMapsApiKey);
  }
}
