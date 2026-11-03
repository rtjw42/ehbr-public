import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { authStorage, purgeIfIdleExpired } from './auth-storage';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Drop any token idle for >14 days BEFORE the client can rehydrate from it.
purgeIfIdleExpired();

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Local (persistent, default) or session storage via the "Keep me signed
    // in" toggle — see auth-storage.ts for the owner-approved exception.
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
