import {
  AiDuplicateMatch,
  AiProductDraft,
  Product,
  ProductType,
} from '../types/models';

export type DraftValidationIssue = 'name' | 'type' | 'price' | 'quantity' | 'size';

export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Find the closest existing product type for the AI's free-text hint. Returns
 * null when there is no confident match so the user must choose manually.
 */
export function matchProductType(
  hint: string | null | undefined,
  types: Pick<ProductType, 'id' | 'name'>[]
): string | null {
  const normalizedHint = normalizeText(hint);
  if (!normalizedHint) return null;

  let best: { id: string; score: number } | null = null;

  for (const type of types) {
    const normalizedType = normalizeText(type.name);
    if (!normalizedType) continue;

    let score = 0;
    if (normalizedHint === normalizedType) {
      score = 100;
    } else if (normalizedHint.length >= 3) {
      const short = normalizedHint.length <= normalizedType.length
        ? normalizedHint
        : normalizedType;
      const long = normalizedHint.length <= normalizedType.length
        ? normalizedType
        : normalizedHint;
      if (long.includes(short)) {
        score = 60 + Math.round((short.length / long.length) * 20);
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { id: type.id, score };
    }
  }

  return best && best.score >= 60 ? best.id : null;
}

/**
 * Detect an existing product for a draft. Barcode matches win over name
 * matches; matching is intentionally conservative to avoid false positives.
 */
export function findDuplicateProduct(
  draft: Pick<AiProductDraft, 'name' | 'brand' | 'barcode'>,
  products: Pick<Product, 'id' | 'name' | 'barcode' | 'type_id' | 'price'>[]
): AiDuplicateMatch | null {
  const barcode = draft.barcode?.trim();
  if (barcode) {
    const byBarcode = products.find(
      (product) => product.barcode?.trim() === barcode
    );
    if (byBarcode) {
      return { product: byBarcode, reason: 'barcode' };
    }
  }

  const names = [
    normalizeText(draft.name),
    normalizeText(`${draft.brand ?? ''} ${draft.name ?? ''}`),
    normalizeText(`${draft.name ?? ''} ${draft.brand ?? ''}`),
  ].filter((name) => name.length > 0);

  if (names.length === 0) return null;

  for (const product of products) {
    const productName = normalizeText(product.name);
    if (!productName) continue;

    const exact = names.some((name) => name === productName);
    const contains = names.some(
      (name) =>
        name.length >= 5 &&
        productName.length >= 5 &&
        (name.includes(productName) || productName.includes(name))
    );

    if (exact || contains) {
      return { product, reason: 'name' };
    }
  }

  return null;
}

export function validateDraftForCreate(
  draft: Pick<AiProductDraft, 'name' | 'type_id' | 'mrp'> & {
    quantity?: number | null;
    size?: string | null;
  },
  receiveStock: boolean
): DraftValidationIssue[] {
  const issues: DraftValidationIssue[] = [];
  if (!draft.name?.trim()) issues.push('name');
  if (!draft.type_id?.trim()) issues.push('type');
  if (draft.mrp === null || draft.mrp === undefined || draft.mrp < 0) {
    issues.push('price');
  }
  if (receiveStock) {
    if (!draft.quantity || draft.quantity <= 0) issues.push('quantity');
    if (!draft.size?.trim()) issues.push('size');
  }
  return issues;
}

export function validateDraftForStock(
  draft: Pick<AiProductDraft, 'quantity' | 'size'>
): DraftValidationIssue[] {
  const issues: DraftValidationIssue[] = [];
  if (!draft.quantity || draft.quantity <= 0) issues.push('quantity');
  if (!draft.size?.trim()) issues.push('size');
  return issues;
}
