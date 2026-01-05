
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const SUPABASE_URL = "https://inwrnzkzseuymfzrpocn.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_81elBWnKMo2ouw53vYQVUQ_Iyo3HHg1";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
