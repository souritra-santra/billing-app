export interface ProductType {
  id: string;
  name: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  type_id: string;
  size: string;
  type_name?: string;
  /** Brand printed on the label / invoice, when known. */
  brand?: string | null;
  /** Garment colour, when known. */
  colour?: string | null;
  /** Buying / cost price — what the shop paid for the item. */
  cost_price: number;
  /** Selling price shown on bills, labels and in the catalogue. */
  price: number;
  barcode: string;
  created_at: string;
}

/**
 * A product to print labels for. `qty` repeats the label once per unit of
 * stock (e.g. qty 5 prints five identical labels); when omitted, one label is
 * printed as before.
 */
export type LabelProduct = Product & { qty?: number };

export interface InventoryItem {
  id: string;
  product_id: string;
  size: string;
  quantity: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  total_purchase: number;
  due_amount: number;
  created_at: string;
}

export interface Order {
  id: string;
  date: string;
  customer_id: string | null;
  customer_name?: string;
  total_amount: number;
  discount: number;
  tax: number;
  final_amount: number;
  payment_mode: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name?: string;
  size: string;
  quantity: number;
  price: number;
}

export interface CartItem {
  product: Product;
  size: string;
  quantity: number;
  available_qty: number;
}

export type PaperWidth = 58 | 80;

/** How the app talks to the printer. */
export type PrintTarget = 'system' | 'bluetooth';

export interface PrintSettings {
  /** Paper roll width in millimetres: 58 (2") or 80 (3"). */
  paperWidth: PaperWidth;
  /** 'system' = OS print dialog, 'bluetooth' = direct ESC/POS over Bluetooth. */
  printTarget: PrintTarget;
  /** Bluetooth device address (as returned by the driver's scan). */
  printerAddress: string | null;
  /** Friendly name of the saved printer. */
  printerName: string | null;
  /** Feed + cut after each job (receipt printers with an auto-cutter). */
  autoCut: boolean;
  /** Optional store name printed at the top of bills and labels. */
  storeName: string;
  /** Optional store phone printed under the store name. */
  storePhone: string;
  /**
   * The cost price is never printed as a number on labels — it is hidden in a
   * mnemonic letter code. Letters map to digits 1..9,0 in order, e.g. the
   * default `GROUNDSALE` encodes 480 as UAE (G=1 R=2 O=3 U=4 N=5 D=6 S=7 A=8 L=9 E=0).
   */
  costCode: string;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paperWidth: 80,
  printTarget: 'system',
  printerAddress: null,
  printerName: null,
  autoCut: true,
  storeName: '',
  storePhone: '',
  costCode: 'GROUNDSALE',
};

export interface SalesSummary {
  total_sales: number;
  total_orders: number;
  total_items: number;
}

// ---------------------------------------------------------------------------
// AI product import
// ---------------------------------------------------------------------------

/** What the user photographed. */
export type AiImportMode = 'invoice' | 'label';

export type AiImportStatus = 'processing' | 'completed' | 'failed';

export type AiImageQuality = 'good' | 'blurry' | 'unreadable';

/**
 * One product extracted by Gemini. Every field is nullable because the model
 * is instructed to return `null` rather than guess when a value is not visible.
 */
export interface AiExtractedProduct {
  name: string | null;
  brand: string | null;
  /** Cost paid per unit, if printed on the invoice. */
  purchase_cost: number | null;
  /** MRP / selling price per unit. */
  mrp: number | null;
  quantity: number | null;
  size: string | null;
  colour: string | null;
  barcode: string | null;
  /** Free-text category hint observed on the document (not a DB id). */
  product_type_hint: string | null;
  /** Model confidence for this row, 0..1, when provided. */
  confidence: number | null;
}

/** Validated structured output from the AI proxy. */
export interface AiExtractionResult {
  document_type: 'purchase_invoice' | 'product_label' | 'unknown';
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  image_quality: AiImageQuality;
  warnings: string[];
  products: AiExtractedProduct[];
}

export type AiDraftStatus = 'pending' | 'created' | 'stock_added' | 'discarded';

/** A locally persisted, editable product draft. */
export interface AiProductDraft {
  id: string;
  session_id: string;
  name: string | null;
  brand: string | null;
  type_id: string | null;
  type_hint: string | null;
  cost_price: number | null;
  mrp: number | null;
  quantity: number | null;
  size: string | null;
  colour: string | null;
  barcode: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  confidence: number | null;
  status: AiDraftStatus;
  /** Set when the draft was linked to / created as a real product. */
  product_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Extraction history row shown on the import screen. */
export interface AiImportSession {
  id: string;
  mode: AiImportMode;
  status: AiImportStatus;
  image_uri: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  image_quality: AiImageQuality | null;
  warnings: string[];
  error_code: string | null;
  error_message: string | null;
  raw_response: string | null;
  /** Derived in list queries; not stored. */
  draft_count?: number;
  created_at: string;
  updated_at: string;
}

/** A possible inventory match found while reviewing a draft. */
export interface AiDuplicateMatch {
  product: Pick<Product, 'id' | 'name' | 'type_id' | 'price' | 'barcode'>;
  reason: 'barcode' | 'name';
}

export type AiErrorCode =
  | 'not_configured'
  | 'offline'
  | 'timeout'
  | 'api_error'
  | 'invalid_json'
  | 'invalid_response'
  | 'blurry_image'
  | 'no_products'
  | 'cancelled';

export interface AiImportErrorShape {
  code: AiErrorCode;
  message: string;
  /** HTTP status from the proxy, when available. */
  status?: number;
  /** True when retrying may succeed (network/timeout/API hiccup). */
  retryable: boolean;
}

export interface TopProduct {
  product_id: string;
  product_name: string;
  total_sold: number;
  total_revenue: number;
}
