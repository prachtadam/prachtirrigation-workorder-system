import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://inwrnzkzseuymfzrpocn.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_81elBWnKMo2ouw53vYQVUQ_Iyo3HHg1";

// Single org for now (keep consistent across Office + Tech)
export const ORG_ID = "pracht";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true }
});

// Make available to non-module code (your big inline <script>)
window.sb = supabase;
window.ORG_ID = ORG_ID;
