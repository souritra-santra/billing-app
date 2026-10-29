#!/usr/bin/env node
/**
 * Minimal, dependency-free Gemini proxy for the BillingApp AI import feature.
 *
 * The Gemini API key stays on this machine / server. The mobile app only talks
 * to this proxy, so the key is never embedded in the Expo bundle.
 *
 * Run:
 *   GEMINI_API_KEY=... npm run ai-proxy
 *
 * Optional env:
 *   PORT=8787
 *   GEMINI_MODEL=gemini-3.5-flash
 *   GEMINI_THINKING_LEVEL=low     (off|minimal|low|medium|high)
 *   PROXY_SHARED_SECRET=...       (require Authorization: Bearer <secret>)
 *   RATE_LIMIT_PER_MINUTE=20
 *   ALLOWED_ORIGIN=*              (CORS origin)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tiny .env loader so `npm run ai-proxy` works with the same `.env` file as
 * Expo. Existing shell variables always win.
 */
function loadDotEnv(file = path.resolve(process.cwd(), '.env')) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // No .env file: rely on the shell environment.
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT || 8787);
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-3.5-flash').trim();
const GEMINI_THINKING_LEVEL = (
  process.env.GEMINI_THINKING_LEVEL || 'low'
).trim().toLowerCase();
const THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high']);
// Newer Gemini models can spend hundreds of "thinking" tokens before emitting
// the JSON. Extraction is a visual transcription task, so a low budget keeps
// latency and cost down without changing the prompt or schema.
const THINKING_CONFIG =
  GEMINI_THINKING_LEVEL === 'off'
    ? { thinkingBudget: 0 }
    : THINKING_LEVELS.has(GEMINI_THINKING_LEVEL)
      ? { thinkingLevel: GEMINI_THINKING_LEVEL.toUpperCase() }
      : null;
const PROXY_SHARED_SECRET = (process.env.PROXY_SHARED_SECRET || '').trim();
const RATE_LIMIT_PER_MINUTE = Number(
  process.env.RATE_LIMIT_PER_MINUTE || 20
);
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '*').trim();
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const GEMINI_TIMEOUT_MS = 55_000;

const PRODUCT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', nullable: true },
    brand: { type: 'STRING', nullable: true },
    purchase_cost: { type: 'NUMBER', nullable: true },
    mrp: { type: 'NUMBER', nullable: true },
    quantity: { type: 'INTEGER', nullable: true },
    size: { type: 'STRING', nullable: true },
    colour: { type: 'STRING', nullable: true },
    barcode: { type: 'STRING', nullable: true },
    product_type_hint: { type: 'STRING', nullable: true },
    confidence: { type: 'NUMBER', nullable: true },
  },
  required: [
    'name',
    'brand',
    'purchase_cost',
    'mrp',
    'quantity',
    'size',
    'colour',
    'barcode',
    'product_type_hint',
    'confidence',
  ],
  propertyOrdering: [
    'name',
    'brand',
    'purchase_cost',
    'mrp',
    'quantity',
    'size',
    'colour',
    'barcode',
    'product_type_hint',
    'confidence',
  ],
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    document_type: {
      type: 'STRING',
      enum: ['purchase_invoice', 'product_label', 'unknown'],
    },
    supplier_name: { type: 'STRING', nullable: true },
    invoice_number: { type: 'STRING', nullable: true },
    invoice_date: { type: 'STRING', nullable: true },
    image_quality: {
      type: 'STRING',
      enum: ['good', 'blurry', 'unreadable'],
    },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    products: {
      type: 'ARRAY',
      items: PRODUCT_SCHEMA,
    },
  },
  required: [
    'document_type',
    'supplier_name',
    'invoice_number',
    'invoice_date',
    'image_quality',
    'warnings',
    'products',
  ],
  propertyOrdering: [
    'document_type',
    'supplier_name',
    'invoice_number',
    'invoice_date',
    'image_quality',
    'warnings',
    'products',
  ],
};

const COMMON_RULES = `You extract product data for a cloth shop's local inventory app.
Return only JSON that matches the provided schema.

CRITICAL RULES:
- Never invent, infer, complete or guess a value. If a value is not clearly legible, return null.
- Do not use world knowledge to fill in brands, categories, prices or barcodes.
- Keep text in the language printed on the document; do not translate product names.
- purchase_cost means the unit cost paid to the supplier (per piece), not a line total.
- mrp means the unit MRP / selling price on the document. If only a line total is visible and quantity is greater than 1, return null for mrp.
- quantity is the number of pieces for that exact product row. Split size/colour variants into separate products only when the quantity for each variant is clear. If one line lists several sizes or colours but the per-variant quantity is not clear, return one row with size/colour null and add a warning — never invent a split.
- barcode must only be copied when digits/letters are printed and clearly readable; otherwise null. Never combine fragments from a cut-off or low-contrast barcode.
- product_type_hint must be a word actually visible on the document (e.g. Shirt, Jeans). Otherwise null.
- confidence is 0..1 for that row, based only on legibility.
- Set image_quality to "blurry" or "unreadable" when text cannot be read reliably, and explain why in warnings.
- Use an empty products array when no product can be read. Never return placeholder products.`;

const INVOICE_PROMPT = `${COMMON_RULES}

This image is a purchase invoice from a supplier. Extract:
- supplier_name and invoice_number from the header, when visible.
- invoice_date from the header, when visible (use the printed format).
- Every distinct product line, including products with no barcode.
- Each size/colour/price variant as its own product row.
- Ignore subtotals, discounts, taxes, totals and payment details.`;

const LABEL_PROMPT = `${COMMON_RULES}

This image is an individual garment label or price tag. Extract exactly one product.
- Read the product name, brand, size, colour, MRP and barcode where printed.
- purchase_cost is usually not printed: return null unless it is explicitly visible.
- quantity is usually not printed: return null unless explicitly visible.
- If the label is readable but contains no product name, put the most specific visible garment description in name.
- If no product information is readable, return an empty products array.`;

const rateBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (rateBuckets.get(ip) || []).filter((time) => time > windowStart);
  if (hits.length >= RATE_LIMIT_PER_MINUTE) {
    rateBuckets.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(ip, hits);
  return false;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Token',
    'Cache-Control': 'no-store',
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON request body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function isAuthorised(req) {
  if (!PROXY_SHARED_SECRET) return true;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : req.headers['x-proxy-token'];
  return token === PROXY_SHARED_SECRET;
}

function stripCodeFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractGeminiJson(payload) {
  if (payload?.promptFeedback?.blockReason) {
    throw Object.assign(
      new Error(`Gemini blocked the request (${payload.promptFeedback.blockReason})`),
      { status: 422 }
    );
  }

  const candidate = payload?.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((part) => part?.text)
    .filter((part) => typeof part === 'string')
    .join('');

  if (!text) {
    const finishReason = candidate?.finishReason || 'no content';
    throw Object.assign(new Error(`Gemini returned no text (${finishReason})`), {
      status: 502,
    });
  }

  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    throw Object.assign(new Error('Gemini returned invalid JSON'), {
      status: 502,
      code: 'invalid_json',
    });
  }
}

function validateRequest(body) {
  if (!body || typeof body !== 'object') {
    throw Object.assign(new Error('Request body is required'), { status: 400 });
  }
  if (body.mode !== 'invoice' && body.mode !== 'label') {
    throw Object.assign(new Error('mode must be "invoice" or "label"'), {
      status: 400,
    });
  }
  const image = body.image;
  if (!image || typeof image !== 'object') {
    throw Object.assign(new Error('image is required'), { status: 400 });
  }
  const mimeType = String(image.mimeType || '').toLowerCase();
  const data = String(image.data || '');
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

  if (!allowed.includes(mimeType)) {
    throw Object.assign(new Error('Unsupported image type'), { status: 415 });
  }
  if (data.length < 100) {
    throw Object.assign(new Error('Image data is empty'), { status: 400 });
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) {
    throw Object.assign(new Error('Image data must be base64'), { status: 400 });
  }

  return { mode: body.mode, mimeType, data: data.replace(/[\r\n]/g, '') };
}

async function callGemini(mode, mimeType, data) {
  const prompt = mode === 'invoice' ? INVOICE_PROMPT : LABEL_PROMPT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        GEMINI_MODEL
      )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { inline_data: { mime_type: mimeType, data } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            ...(THINKING_CONFIG ? { thinkingConfig: THINKING_CONFIG } : {}),
          },
        }),
        signal: controller.signal,
      }
    );
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('Gemini request timed out'), {
        status: 504,
        code: 'api_error',
      });
    }
    throw Object.assign(new Error('Could not reach Gemini'), {
      status: 502,
      code: 'api_error',
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error?.message || `Gemini returned HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status === 429 ? 429 : 502;
    error.code = 'api_error';
    throw error;
  }

  const parsed = extractGeminiJson(payload);
  return { parsed, usage: payload?.usageMetadata };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      ok: true,
      configured: Boolean(GEMINI_API_KEY),
      model: GEMINI_MODEL,
      thinking: GEMINI_THINKING_LEVEL,
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/api/ai/extract') {
    sendJson(res, 404, { code: 'not_found', message: 'Not found' });
    return;
  }

  if (!isAuthorised(req)) {
    sendJson(res, 401, { code: 'unauthorized', message: 'Unauthorized' });
    return;
  }

  const ip = req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    sendJson(res, 429, {
      code: 'api_error',
      message: 'Too many requests. Please wait a minute and try again.',
    });
    return;
  }

  if (!GEMINI_API_KEY) {
    sendJson(res, 503, {
      code: 'not_configured',
      message: 'GEMINI_API_KEY is not set on the proxy',
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const image = validateRequest(body);
    const { parsed, usage } = await callGemini(
      image.mode,
      image.mimeType,
      image.data
    );

    sendJson(res, 200, {
      data: parsed,
      model: GEMINI_MODEL,
      usage: usage || null,
    });
  } catch (error) {
    const status = error?.status || 500;
    const code = error?.code || (status === 413 ? 'invalid_request' : 'api_error');
    // Never log image data or the API key.
    console.error(`[ai-proxy] ${status} ${code}: ${error?.message || error}`);
    sendJson(res, status, {
      code,
      message: error?.message || 'AI extraction failed',
    });
  }
});

server.listen(PORT, () => {
  console.log(`[ai-proxy] listening on http://localhost:${PORT}`);
  console.log(
    `[ai-proxy] model=${GEMINI_MODEL} thinking=${GEMINI_THINKING_LEVEL} key=${
      GEMINI_API_KEY ? 'set' : 'MISSING'
    } auth=${PROXY_SHARED_SECRET ? 'shared-secret' : 'open'}`
  );
});
