import { AI_PROXY_TOKEN, AI_PROXY_URL, AI_REQUEST_TIMEOUT_MS } from '../ai/config';
import { AiImportError } from '../ai/errors';
import { parseLooseJson } from '../ai/parse';
import { AiImportMode } from '../types/models';
import { PreparedAiImage } from './imageService';
import {
  AI_EDGE_FUNCTION,
  CLOUD_SYNC_ENABLED,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from '../sync/config';
import { supabase } from '../sync/client';

interface ProxySuccessBody {
  data?: unknown;
  result?: unknown;
  model?: string;
}

function readProxyError(body: unknown): { code?: string; message?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const record = body as Record<string, unknown>;
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}

function statusToError(
  status: number,
  message?: string,
  proxyCode?: string
): AiImportError {
  const mappedCode =
    proxyCode === 'not_configured' ||
    proxyCode === 'invalid_json' ||
    proxyCode === 'invalid_response' ||
    proxyCode === 'offline' ||
    proxyCode === 'timeout'
      ? proxyCode
      : 'api_error';

  const retryable =
    mappedCode === 'not_configured'
      ? false
      : status === 408 || status === 429 || status >= 500;
  return new AiImportError(mappedCode, message || `AI proxy returned HTTP ${status}`, {
    status,
    retryable,
  });
}

const RETRY_DELAY_MS = 800;
const MAX_ATTEMPTS = 3;

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1))
  );
}

async function postCloudExtraction(
  mode: AiImportMode,
  image: PreparedAiImage,
  shopId: string,
  signal: AbortSignal
): Promise<Response> {
  if (!supabase) throw new Error('Cloud sync is not configured');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in to use cloud AI');

  return fetch(`${SUPABASE_URL}/functions/v1/${AI_EDGE_FUNCTION}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mode,
      shopId,
      image: {
        mimeType: image.mimeType,
        data: image.base64,
      },
    }),
    signal,
  });
}

async function postExtraction(
  mode: AiImportMode,
  image: PreparedAiImage,
  shopId?: string | null
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    if (CLOUD_SYNC_ENABLED && supabase && shopId) {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        return await postCloudExtraction(mode, image, shopId, controller.signal);
      }
    }

    if (!AI_PROXY_URL) {
      throw new AiImportError(
        'not_configured',
        'Set EXPO_PUBLIC_AI_PROXY_URL or sign in to use the cloud AI function.'
      );
    }

    return await fetch(`${AI_PROXY_URL}/api/ai/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(AI_PROXY_TOKEN ? { Authorization: `Bearer ${AI_PROXY_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        mode,
        image: {
          mimeType: image.mimeType,
          data: image.base64,
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a prepared image to the secure proxy. The Gemini API key lives only on
 * the proxy; this client never sees or stores it.
 */
export async function requestAiExtraction(
  mode: AiImportMode,
  image: PreparedAiImage,
  shopId?: string | null
): Promise<unknown> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await postExtraction(mode, image, shopId);
    } catch (error: any) {
      if (error instanceof AiImportError) throw error;
      if (error?.name === 'AbortError') {
        throw new AiImportError('timeout', 'The AI request timed out');
      }
      // React Native reports DNS / connection failures as a TypeError.
      if (attempt < MAX_ATTEMPTS - 1) {
        await retryDelay(attempt);
        continue;
      }
      throw new AiImportError(
        'offline',
        error?.message || 'Could not reach the AI service'
      );
    }

    // Automatic retries for transient proxy/provider failures. Do not retry
    // 429: the proxy rate limiter needs the user to wait.
    if (response.status >= 500 && attempt < MAX_ATTEMPTS - 1) {
      await retryDelay(attempt);
      continue;
    }
    break;
  }

  if (!response) {
    throw new AiImportError('offline', 'Could not reach the AI service');
  }

  const rawBody = await response.text();
  let body: unknown = null;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const parsedError = readProxyError(body);
    throw statusToError(response.status, parsedError.message, parsedError.code);
  }

  const proxyBody = (body ?? {}) as ProxySuccessBody;
  const data = proxyBody.data ?? proxyBody.result;
  if (data === undefined || data === null) {
    throw new AiImportError(
      'invalid_response',
      'The AI proxy returned an empty response'
    );
  }

  if (typeof data === 'string') {
    try {
      return parseLooseJson(data);
    } catch {
      throw new AiImportError('invalid_json', 'The AI response was not valid JSON');
    }
  }

  return data;
}
