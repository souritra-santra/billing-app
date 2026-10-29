/**
 * AI import configuration.
 *
 * Only the proxy URL/token live in the Expo bundle — the Gemini API key stays
 * on the proxy server. `EXPO_PUBLIC_*` values are bundled, so never put a
 * provider secret in one of these variables.
 */
const rawProxyUrl = (process.env.EXPO_PUBLIC_AI_PROXY_URL ?? '').trim();
const rawProxyToken = (process.env.EXPO_PUBLIC_AI_PROXY_TOKEN ?? '').trim();

export const AI_PROXY_URL = rawProxyUrl.replace(/\/+$/, '');
export const AI_PROXY_TOKEN = rawProxyToken;
export const AI_REQUEST_TIMEOUT_MS = 60_000;

const cloudConfigured = Boolean(
  (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim() &&
    (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
);

export function isAiProxyConfigured(): boolean {
  // Cloud AI is selected at request time when the user is signed in and a shop
  // is active. A blank local proxy URL is fine in that setup.
  return AI_PROXY_URL.length > 0 || cloudConfigured;
}
