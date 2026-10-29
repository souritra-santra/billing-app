/**
 * Public Supabase configuration.
 *
 * These values are safe to ship in the bundle (the anon key is protected by
 * Row Level Security). The Gemini API key is never part of this file.
 */

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;

export const CLOUD_SYNC_ENABLED = Boolean(url && anonKey);
export const AI_EDGE_FUNCTION = 'ai-extract';
