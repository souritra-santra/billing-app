import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CLOUD_SYNC_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

/**
 * Supabase client for auth and sync.
 *
 * The app still runs entirely locally when these env vars are absent.
 */
export const supabase: SupabaseClient | null = CLOUD_SYNC_ENABLED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      global: {
        headers: { 'X-Client-Info': 'billingapp-mobile' },
      },
    })
  : null;
