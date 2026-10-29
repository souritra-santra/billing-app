import { getDatabase, generateId } from '../db';
import {
  AiDraftSize,
  AiDraftStatus,
  AiExtractionResult,
  AiImportMode,
  AiImportSession,
  AiProductDraft,
} from '../../types/models';

type SessionRow = Omit<AiImportSession, 'warnings'> & {
  warnings_json: string;
};

export interface AiDraftInput {
  name: string | null;
  brand: string | null;
  type_id: string | null;
  type_hint: string | null;
  cost_price: number | null;
  mrp: number | null;
  quantity: number | null;
  size: string | null;
  sizes?: AiDraftSize[] | null;
  colour: string | null;
  barcode: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  confidence: number | null;
}

export type AiDraftUpdate = Partial<AiDraftInput>;

const UPDATABLE_DRAFT_COLUMNS: (keyof AiDraftUpdate)[] = [
  'name',
  'brand',
  'type_id',
  'type_hint',
  'cost_price',
  'mrp',
  'quantity',
  'size',
  'colour',
  'barcode',
  'supplier_name',
  'invoice_number',
  'confidence',
];

function parseWarnings(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseSizes(json: string | null | undefined): AiDraftSize[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        size: String((entry as { size?: unknown })?.size ?? '').trim(),
        quantity: Math.floor(Number((entry as { quantity?: unknown })?.quantity)),
      }))
      .filter(
        (entry) => entry.size.length > 0 && Number.isFinite(entry.quantity) && entry.quantity > 0
      );
  } catch {
    return [];
  }
}

function mapDraft(row: AiProductDraft & { sizes_json?: string | null }): AiProductDraft {
  const { sizes_json, ...draft } = row;
  return { ...draft, sizes: parseSizes(sizes_json) };
}

function mapSession(row: SessionRow & { draft_count?: number }): AiImportSession {
  return {
    ...row,
    warnings: parseWarnings(row.warnings_json),
    draft_count: row.draft_count ?? 0,
  };
}

export async function createAiImportSession(
  mode: AiImportMode,
  imageUri: string | null
): Promise<string> {
  const db = await getDatabase();
  const id = generateId();
  await db.runAsync(
    `INSERT INTO ai_import_sessions (id, mode, status, image_uri)
     VALUES (?, ?, 'processing', ?)`,
    [id, mode, imageUri]
  );
  return id;
}

export async function completeAiImportSession(
  id: string,
  result: AiExtractionResult,
  rawResponse: string | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ai_import_sessions
     SET status = 'completed',
         supplier_name = ?,
         invoice_number = ?,
         image_quality = ?,
         warnings_json = ?,
         raw_response = ?,
         error_code = NULL,
         error_message = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      result.supplier_name,
      result.invoice_number,
      result.image_quality,
      JSON.stringify(result.warnings),
      rawResponse,
      id,
    ]
  );
}

export async function failAiImportSession(
  id: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ai_import_sessions
     SET status = 'failed',
         error_code = ?,
         error_message = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [errorCode, errorMessage, id]
  );
}

export async function saveAiDrafts(
  sessionId: string,
  drafts: AiDraftInput[]
): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const draft of drafts) {
      await db.runAsync(
        `INSERT INTO ai_product_drafts (
           id, session_id, name, brand, type_id, type_hint, cost_price, mrp,
           quantity, size, colour, barcode, supplier_name, invoice_number,
           confidence, sizes_json, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          generateId(),
          sessionId,
          draft.name,
          draft.brand,
          draft.type_id,
          draft.type_hint,
          draft.cost_price,
          draft.mrp,
          draft.quantity,
          draft.size,
          draft.colour,
          draft.barcode,
          draft.supplier_name,
          draft.invoice_number,
          draft.confidence,
          JSON.stringify(draft.sizes ?? []),
        ]
      );
    }
  });
}

export async function getAiImportSession(id: string): Promise<AiImportSession | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<SessionRow>(
    'SELECT * FROM ai_import_sessions WHERE id = ?',
    [id]
  );
  return row ? mapSession(row) : null;
}

export async function getRecentAiImportSessions(
  limit: number = 25
): Promise<AiImportSession[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<SessionRow & { draft_count: number }>(
    `SELECT s.*, (
       SELECT COUNT(*) FROM ai_product_drafts d WHERE d.session_id = s.id
     ) AS draft_count
     FROM ai_import_sessions s
     ORDER BY s.created_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(mapSession);
}

export async function getAiDraftsForSession(
  sessionId: string
): Promise<AiProductDraft[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<AiProductDraft & { sizes_json?: string | null }>(
    `SELECT * FROM ai_product_drafts
     WHERE session_id = ?
     ORDER BY created_at ASC, rowid ASC`,
    [sessionId]
  );
  return rows.map(mapDraft);
}

export async function updateAiDraft(
  id: string,
  patch: AiDraftUpdate
): Promise<void> {
  const columns: string[] = UPDATABLE_DRAFT_COLUMNS.filter(
    (column) => patch[column] !== undefined
  );
  const values: (string | number | null)[] = columns.map((column) => {
    const value = patch[column as keyof AiDraftInput];
    return value === undefined || value === null ? null : (value as string | number);
  });
  if (patch.sizes !== undefined) {
    columns.push('sizes_json');
    values.push(JSON.stringify(patch.sizes ?? []));
  }
  if (columns.length === 0) return;

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ai_product_drafts
     SET ${columns.map((column) => `${column} = ?`).join(', ')},
         updated_at = datetime('now')
     WHERE id = ?`,
    [...values, id]
  );
}

export async function setAiDraftStatus(
  id: string,
  status: AiDraftStatus,
  productId: string | null = null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ai_product_drafts
     SET status = ?, product_id = COALESCE(?, product_id), updated_at = datetime('now')
     WHERE id = ?`,
    [status, productId, id]
  );
}

export async function deleteAiImportSession(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM ai_import_sessions WHERE id = ?', [id]);
}
