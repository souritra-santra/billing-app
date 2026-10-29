import { AiDraftSize, AiProductDraft } from '../types/models';
import { parseQuantity } from './parse';

/** A size row while it is being edited (quantity is still a text input). */
export interface EditableSize {
  size: string;
  qty: string;
}

/**
 * Choose the size rows to show when a draft is opened. New drafts carry a
 * `sizes` array; older drafts fall back to their single size + quantity.
 */
export function editableSizesFromDraft(
  draft: Pick<AiProductDraft, 'sizes' | 'size' | 'quantity'>
): EditableSize[] {
  const stored = normalizeDraftSizes(draft.sizes);
  if (stored.length > 0) {
    return stored.map((entry) => ({
      size: entry.size,
      qty: String(entry.quantity),
    }));
  }

  const size = draft.size?.trim() ?? '';
  const quantity = draft.quantity && draft.quantity > 0
    ? Math.floor(draft.quantity)
    : null;
  if (!size && !quantity) return [];
  return [{ size, qty: quantity ? String(quantity) : '' }];
}

/** Keep only complete, positive size rows. */
export function normalizeDraftSizes(
  entries: AiDraftSize[] | null | undefined
): AiDraftSize[] {
  if (!Array.isArray(entries)) return [];

  const merged = new Map<string, { size: string; quantity: number }>();
  for (const entry of entries) {
    const size = String(entry?.size ?? '').trim();
    const quantity = Math.floor(Number(entry?.quantity));
    if (!size || !Number.isFinite(quantity) || quantity <= 0) continue;

    const key = size.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      merged.set(key, { size, quantity });
    }
  }
  return Array.from(merged.values());
}

/** Convert editable text rows into validated stock entries. */
export function sizeRowsToDraftSizes(rows: EditableSize[]): AiDraftSize[] {
  const entries: AiDraftSize[] = [];
  for (const row of rows) {
    const size = row.size.trim();
    if (!size) continue;
    const quantity = parseQuantity(row.qty);
    if (quantity === null || quantity <= 0) continue;
    entries.push({ size, quantity });
  }
  return normalizeDraftSizes(entries);
}

/**
 * Size-grid quantities allow zero so a size can be listed without receiving
 * stock, matching the Add Product screen. Empty or malformed input is invalid.
 */
function parseGridQuantity(value: string): number | null {
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (!/^\d+$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Return the first validation problem with the size grid. `required` is false
 * when the user chose to create a product without receiving stock.
 */
export function sizeRowsIssue(
  rows: EditableSize[],
  required: boolean
): 'quantity' | 'size' | null {
  const nonEmpty = rows.filter(
    (row) => row.size.trim().length > 0 || row.qty.trim().length > 0
  );

  if (nonEmpty.length === 0) return required ? 'quantity' : null;

  for (const row of nonEmpty) {
    if (!row.size.trim()) return 'size';
    const quantity = parseGridQuantity(row.qty);
    if (quantity === null) return 'quantity';
  }

  if (required && sizeRowsToDraftSizes(nonEmpty).length === 0) {
    return 'quantity';
  }
  return null;
}

export function totalSizeQuantity(sizes: AiDraftSize[]): number {
  return sizes.reduce((total, entry) => total + entry.quantity, 0);
}

export function primarySize(sizes: AiDraftSize[]): string | null {
  return sizes[0]?.size?.trim() || null;
}

/**
 * Resolve the size rows that should be applied for a confirmation. Explicit
 * rows from the review screen win; persisted draft sizes are the fallback.
 */
export function effectiveDraftSizes(
  draft: Pick<AiProductDraft, 'sizes' | 'size' | 'quantity'>,
  entries?: AiDraftSize[] | null
): AiDraftSize[] {
  const explicit = normalizeDraftSizes(entries);
  if (explicit.length > 0) return explicit;

  const stored = normalizeDraftSizes(draft.sizes);
  if (stored.length > 0) return stored;

  const size = draft.size?.trim() ?? '';
  const quantity = draft.quantity && draft.quantity > 0
    ? Math.floor(draft.quantity)
    : null;
  return size && quantity ? [{ size, quantity }] : [];
}
