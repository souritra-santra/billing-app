import {
  AiExtractedProduct,
  AiExtractionResult,
  AiImageQuality,
} from '../types/models';

export class AiResultValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'AiResultValidationError';
    this.issues = issues;
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Remove markdown fences / prose that some models wrap around JSON. */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new AiResultValidationError('Empty AI response');

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to the more forgiving extraction below.
  }

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    // Fall through to brace matching.
  }

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = withoutFence.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Handled by the caller.
    }
  }

  throw new AiResultValidationError('AI response was not valid JSON');
}

function cleanString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Parse money-like values without guessing: accepts numbers and strings such
 * as "₹1,299.00", "Rs. 499" or "1299/-". Invalid / negative values become null.
 */
export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0
      ? Math.round(value * 100) / 100
      : null;
  }
  if (typeof value !== 'string') return null;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

/** Quantity must be a positive whole number; anything else is left blank. */
export function parseQuantity(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value);
  }
  if (typeof value !== 'string') return null;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

/** Confidence is normalised to 0..1; percentages such as "90%" become 0.9. */
export function parseConfidence(value: unknown): number | null {
  let parsed: number | null = null;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    const match = value.match(/\d+(?:\.\d+)?/);
    if (match) {
      parsed = Number(match[0]);
      if (value.includes('%')) parsed /= 100;
    }
  }
  if (parsed === null || !Number.isFinite(parsed)) return null;
  if (parsed >= 2 && parsed <= 100) parsed /= 100;
  return Math.min(1, Math.max(0, Math.round(parsed * 100) / 100));
}

function cleanBarcode(value: unknown): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  return cleaned.replace(/\s+/g, '');
}

function readImageQuality(value: unknown, warnings: string[]): AiImageQuality {
  if (value === 'good' || value === 'blurry' || value === 'unreadable') {
    return value;
  }
  warnings.push('Image quality was not reported by the AI service.');
  return 'good';
}

function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item))
    .filter((item): item is string => item !== null);
}

function readProduct(value: unknown): AiExtractedProduct | null {
  if (!isRecord(value)) return null;
  return {
    name: cleanString(value.name),
    brand: cleanString(value.brand),
    purchase_cost: parseMoney(value.purchase_cost),
    mrp: parseMoney(value.mrp),
    quantity: parseQuantity(value.quantity),
    size: cleanString(value.size),
    colour: cleanString(value.colour ?? value.color),
    barcode: cleanBarcode(value.barcode),
    product_type_hint: cleanString(
      value.product_type_hint ?? value.type_hint ?? value.category
    ),
    confidence: parseConfidence(value.confidence),
  };
}

/**
 * Validate and normalise the proxy's structured output. Missing fields stay
 * null — this function only coerces values the model actually returned.
 */
export function parseAiExtraction(raw: unknown): AiExtractionResult {
  const value = typeof raw === 'string' ? parseLooseJson(raw) : raw;
  if (!isRecord(value)) {
    throw new AiResultValidationError('AI response must be a JSON object');
  }

  const warnings = readWarnings(value.warnings);
  const imageQuality = readImageQuality(value.image_quality, warnings);

  const documentType =
    value.document_type === 'purchase_invoice' ||
    value.document_type === 'product_label'
      ? value.document_type
      : 'unknown';

  if (!Array.isArray(value.products)) {
    throw new AiResultValidationError(
      'AI response is missing the products array',
      ['products']
    );
  }

  const products: AiExtractedProduct[] = [];
  value.products.forEach((item, index) => {
    const product = readProduct(item);
    if (product) {
      products.push(product);
    } else {
      warnings.push(`Product row ${index + 1} could not be read.`);
    }
  });

  if (imageQuality === 'blurry' || imageQuality === 'unreadable') {
    const note =
      imageQuality === 'blurry'
        ? 'The photo looks blurry. Retake it in better light for more reliable results.'
        : 'The image could not be read. Retake the photo and make sure the text is visible.';
    if (!warnings.includes(note)) warnings.push(note);
  }

  if (products.length === 0) {
    warnings.push('No products were found in this image.');
  }

  return {
    document_type: documentType,
    supplier_name: cleanString(value.supplier_name),
    invoice_number: cleanString(value.invoice_number),
    invoice_date: cleanString(value.invoice_date),
    image_quality: imageQuality,
    warnings,
    products,
  };
}
