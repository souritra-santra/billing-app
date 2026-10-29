import { getDatabase } from '../database/db';
import {
  AiDraftInput,
  completeAiImportSession,
  createAiImportSession,
  failAiImportSession,
  saveAiDrafts,
  setAiDraftStatus,
  updateAiDraft,
} from '../database/queries/aiImportQueries';
import {
  addProduct,
  getProductByBarcode,
  getProductById,
  getProductTypes,
} from '../database/queries/productQueries';
import { increaseStock } from '../database/queries/inventoryQueries';
import {
  AiProductDraft,
  AiDraftStatus,
  AiExtractionResult,
  AiImportMode,
} from '../types/models';
import { matchProductType, validateDraftForCreate, validateDraftForStock } from '../ai/drafts';
import { AiDraftError, AiImportError, isAiImportError } from '../ai/errors';
import { AiResultValidationError, parseAiExtraction } from '../ai/parse';
import { generateBarcode } from '../utils/helpers';
import { prepareImageForAi } from './imageService';
import { requestAiExtraction } from './geminiService';
import { getActiveShopId } from '../sync/activeShop';

export interface RunAiImportResult {
  sessionId: string;
  result: AiExtractionResult;
}

export interface ConfirmDraftOptions {
  /** Selected existing product type (required when creating). */
  typeId?: string | null;
  /** Add the draft quantity to inventory. */
  receiveStock: boolean;
  /** Link the draft to an existing product instead of creating one. */
  existingProductId?: string | null;
}

export interface ConfirmDraftResult {
  status: AiDraftStatus;
  productId: string;
  stockAdded: boolean;
  created: boolean;
}

function toDraftInput(
  result: AiExtractionResult,
  types: { id: string; name: string }[]
): AiDraftInput[] {
  return result.products.map((product) => ({
    name: product.name,
    brand: product.brand,
    type_id: matchProductType(product.product_type_hint, types),
    type_hint: product.product_type_hint,
    cost_price: product.purchase_cost,
    mrp: product.mrp,
    quantity: product.quantity,
    size: product.size,
    colour: product.colour,
    barcode: product.barcode,
    supplier_name: result.supplier_name,
    invoice_number: result.invoice_number,
    confidence: product.confidence,
  }));
}

function buildDraftFields(draft: AiProductDraft): AiDraftInput {
  return {
    name: draft.name,
    brand: draft.brand,
    type_id: draft.type_id,
    type_hint: draft.type_hint,
    cost_price: draft.cost_price,
    mrp: draft.mrp,
    quantity: draft.quantity,
    size: draft.size,
    colour: draft.colour,
    barcode: draft.barcode,
    supplier_name: draft.supplier_name,
    invoice_number: draft.invoice_number,
    confidence: draft.confidence,
  };
}

/**
 * Analyse an image, validate the model output, and persist a failed or
 * completed history entry plus editable drafts. No product or stock changes
 * happen here.
 */
export async function runAiImport(
  uri: string,
  mode: AiImportMode,
  knownSize?: { width?: number; height?: number }
): Promise<RunAiImportResult> {
  const sessionId = await createAiImportSession(mode, uri);
  let rawResponse: string | null = null;

  try {
    const image = await prepareImageForAi(uri, knownSize);
    const shopId = await getActiveShopId();
    const raw = await requestAiExtraction(mode, image, shopId);
    rawResponse = typeof raw === 'string' ? raw : JSON.stringify(raw);

    let result: AiExtractionResult;
    try {
      result = parseAiExtraction(raw);
    } catch (error) {
      if (error instanceof AiResultValidationError) {
        const isJsonError = /json/i.test(error.message);
        throw new AiImportError(
          isJsonError ? 'invalid_json' : 'invalid_response',
          error.message,
          { issues: error.issues }
        );
      }
      throw error;
    }

    if (result.products.length === 0) {
      throw new AiImportError(
        result.image_quality === 'blurry' || result.image_quality === 'unreadable'
          ? 'blurry_image'
          : 'no_products',
        'No products could be read from the image'
      );
    }

    const types = await getProductTypes();
    await saveAiDrafts(sessionId, toDraftInput(result, types));
    await completeAiImportSession(sessionId, result, rawResponse);

    return { sessionId, result };
  } catch (error) {
    const importError = isAiImportError(error)
      ? error
      : new AiImportError('api_error', error instanceof Error ? error.message : 'AI import failed');

    try {
      await failAiImportSession(sessionId, importError.code, importError.message);
    } catch {
      // History persistence is best-effort; the original error is more useful.
    }
    throw importError;
  }
}

/**
 * Confirm one draft. Product creation and stock receipt are always explicit;
 * this is the only place the AI flow writes to products or inventory.
 */
export async function confirmAiDraft(
  draft: AiProductDraft,
  options: ConfirmDraftOptions
): Promise<ConfirmDraftResult> {
  const db = await getDatabase();
  const existingProductId = options.existingProductId?.trim() || null;

  if (existingProductId) {
    const existing = await getProductById(existingProductId);
    if (!existing) throw new AiDraftError('not_found');

    const issues = validateDraftForStock(draft);
    if (issues.length > 0) throw new AiDraftError(issues[0]);

    const size = draft.size!.trim();
    const quantity = Math.floor(draft.quantity!);

    await db.withTransactionAsync(async () => {
      await updateAiDraft(draft.id, buildDraftFields(draft));
      await increaseStock(existingProductId, size, quantity);
      await setAiDraftStatus(draft.id, 'stock_added', existingProductId);
    });

    return {
      status: 'stock_added',
      productId: existingProductId,
      stockAdded: true,
      created: false,
    };
  }

  const types = await getProductTypes();
  const typeId = options.typeId?.trim() || draft.type_id?.trim() || null;
  if (!typeId || !types.some((type) => type.id === typeId)) {
    throw new AiDraftError('type');
  }

  const issues = validateDraftForCreate(
    { ...draft, type_id: typeId },
    options.receiveStock
  );
  if (issues.length > 0) throw new AiDraftError(issues[0]);

  const barcode = draft.barcode?.trim() || null;
  if (barcode) {
    const duplicate = await getProductByBarcode(barcode);
    if (duplicate) throw new AiDraftError('barcode_exists');
  }

  const name = draft.name!.trim();
  const mrp = draft.mrp!;
  const cost = draft.cost_price ?? 0;
  const quantity = draft.quantity ? Math.floor(draft.quantity) : 0;
  const size = draft.size?.trim() || '';
  let productId = '';

  try {
    await db.withTransactionAsync(async () => {
      await updateAiDraft(draft.id, { ...buildDraftFields(draft), type_id: typeId });
      productId = await addProduct(
        name,
        typeId,
        cost,
        mrp,
        barcode ?? generateBarcode(),
        draft.brand,
        draft.colour
      );

      if (options.receiveStock && quantity > 0) {
        await increaseStock(productId, size, quantity);
      }

      await setAiDraftStatus(
        draft.id,
        options.receiveStock && quantity > 0 ? 'stock_added' : 'created',
        productId
      );
    });
  } catch (error: any) {
    if (String(error?.message ?? '').toUpperCase().includes('UNIQUE')) {
      throw new AiDraftError('barcode_exists');
    }
    throw new AiDraftError(
      'save_failed',
      error instanceof Error ? error.message : 'Could not save the draft'
    );
  }

  const stockAdded = options.receiveStock && quantity > 0;
  return {
    status: stockAdded ? 'stock_added' : 'created',
    productId,
    stockAdded,
    created: true,
  };
}
