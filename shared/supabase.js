
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const SUPABASE_URL = "PASTE_PROJECT_URL_HERE";
export const SUPABASE_ANON_KEY = "PASTE_ANON_PUBLIC_KEY_HERE";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
