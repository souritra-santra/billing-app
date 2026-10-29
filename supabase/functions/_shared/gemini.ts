/**
 * Shared Gemini extraction logic for the Supabase Edge Function.
 *
 * Keep this file dependency-free except for the runtime `fetch`. The Gemini API
 * key is read from the Edge Function secret store and never leaves the server.
 */

export type ExtractMode = "invoice" | "label";

export type ExtractRequest = {
  mode: ExtractMode;
  mimeType: string;
  data: string;
};

const GEMINI_MODEL = (Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash").trim();
const GEMINI_THINKING_LEVEL = (
  Deno.env.get("GEMINI_THINKING_LEVEL") || "low"
)
  .trim()
  .toLowerCase();
const THINKING_LEVELS = new Set(["minimal", "low", "medium", "high"]);

const THINKING_CONFIG =
  GEMINI_THINKING_LEVEL === "off"
    ? { thinkingBudget: 0 }
    : THINKING_LEVELS.has(GEMINI_THINKING_LEVEL)
      ? { thinkingLevel: GEMINI_THINKING_LEVEL.toUpperCase() }
      : null;

const GEMINI_TIMEOUT_MS = 55_000;

const PRODUCT_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", nullable: true },
    brand: { type: "STRING", nullable: true },
    purchase_cost: { type: "NUMBER", nullable: true },
    mrp: { type: "NUMBER", nullable: true },
    quantity: { type: "INTEGER", nullable: true },
    size: { type: "STRING", nullable: true },
    colour: { type: "STRING", nullable: true },
    barcode: { type: "STRING", nullable: true },
    product_type_hint: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER", nullable: true },
  },
  required: [
    "name",
    "brand",
    "purchase_cost",
    "mrp",
    "quantity",
    "size",
    "colour",
    "barcode",
    "product_type_hint",
    "confidence",
  ],
  propertyOrdering: [
    "name",
    "brand",
    "purchase_cost",
    "mrp",
    "quantity",
    "size",
    "colour",
    "barcode",
    "product_type_hint",
    "confidence",
  ],
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    document_type: {
      type: "STRING",
      enum: ["purchase_invoice", "product_label", "unknown"],
    },
    supplier_name: { type: "STRING", nullable: true },
    invoice_number: { type: "STRING", nullable: true },
    invoice_date: { type: "STRING", nullable: true },
    image_quality: {
      type: "STRING",
      enum: ["good", "blurry", "unreadable"],
    },
    warnings: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    products: {
      type: "ARRAY",
      items: PRODUCT_SCHEMA,
    },
  },
  required: [
    "document_type",
    "supplier_name",
    "invoice_number",
    "invoice_date",
    "image_quality",
    "warnings",
    "products",
  ],
  propertyOrdering: [
    "document_type",
    "supplier_name",
    "invoice_number",
    "invoice_date",
    "image_quality",
    "warnings",
    "products",
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

function allowedMimeTypes(): string[] {
  return [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ];
}

export function validateRequest(body: unknown): ExtractRequest {
  if (!body || typeof body !== "object") {
    throw Object.assign(new Error("Request body is required"), {
      status: 400,
      code: "invalid_request",
    });
  }

  const value = body as Record<string, unknown>;
  if (value.mode !== "invoice" && value.mode !== "label") {
    throw Object.assign(new Error('mode must be "invoice" or "label"'), {
      status: 400,
      code: "invalid_request",
    });
  }

  const image = value.image;
  if (!image || typeof image !== "object") {
    throw Object.assign(new Error("image is required"), {
      status: 400,
      code: "invalid_request",
    });
  }

  const imageValue = image as Record<string, unknown>;
  const mimeType = String(imageValue.mimeType || "").toLowerCase();
  const data = String(imageValue.data || "");

  if (!allowedMimeTypes().includes(mimeType)) {
    throw Object.assign(new Error("Unsupported image type"), {
      status: 415,
      code: "invalid_request",
    });
  }
  if (data.length < 100) {
    throw Object.assign(new Error("Image data is empty"), {
      status: 400,
      code: "invalid_request",
    });
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) {
    throw Object.assign(new Error("Image data must be base64"), {
      status: 400,
      code: "invalid_request",
    });
  }

  return {
    mode: value.mode,
    mimeType,
    data: data.replace(/[\r\n]/g, ""),
  };
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractGeminiJson(payload: any): any {
  if (payload?.promptFeedback?.blockReason) {
    throw Object.assign(
      new Error(
        `Gemini blocked the request (${payload.promptFeedback.blockReason})`,
      ),
      { status: 422, code: "api_error" },
    );
  }

  const candidate = payload?.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((part: any) => part?.text)
    .filter((part: any) => typeof part === "string")
    .join("");

  if (!text) {
    const finishReason = candidate?.finishReason || "no content";
    throw Object.assign(
      new Error(`Gemini returned no text (${finishReason})`),
      { status: 502, code: "api_error" },
    );
  }

  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    throw Object.assign(new Error("Gemini returned invalid JSON"), {
      status: 502,
      code: "invalid_json",
    });
  }
}

async function callGemini(
  mode: ExtractMode,
  mimeType: string,
  data: string,
): Promise<{ parsed: unknown; usage: unknown }> {
  const apiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  if (!apiKey) {
    throw Object.assign(
      new Error("GEMINI_API_KEY is not configured on the Edge Function"),
      { status: 503, code: "not_configured" },
    );
  }

  const prompt = mode === "invoice" ? INVOICE_PROMPT : LABEL_PROMPT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${
        encodeURIComponent(GEMINI_MODEL)
      }:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inline_data: { mime_type: mimeType, data } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            ...(THINKING_CONFIG ? { thinkingConfig: THINKING_CONFIG } : {}),
          },
        }),
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw Object.assign(new Error("Gemini request timed out"), {
        status: 504,
        code: "api_error",
      });
    }
    throw Object.assign(new Error("Could not reach Gemini"), {
      status: 502,
      code: "api_error",
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error?.message || `Gemini returned HTTP ${response.status}`;
    throw Object.assign(new Error(message), {
      status: response.status === 429 ? 429 : 502,
      code: "api_error",
    });
  }

  return {
    parsed: extractGeminiJson(payload),
    usage: payload?.usageMetadata || null,
  };
}

export async function extractProducts(
  body: unknown,
): Promise<{ data: unknown; model: string; usage: unknown }> {
  const request = validateRequest(body);
  const result = await callGemini(request.mode, request.mimeType, request.data);
  return {
    data: result.parsed,
    model: GEMINI_MODEL,
    usage: result.usage,
  };
}

export function geminiHealth() {
  return {
    ok: true,
    configured: Boolean((Deno.env.get("GEMINI_API_KEY") || "").trim()),
    model: GEMINI_MODEL,
    thinking: GEMINI_THINKING_LEVEL,
  };
}
