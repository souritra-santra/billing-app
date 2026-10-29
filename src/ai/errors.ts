import { AiErrorCode } from '../types/models';

const RETRYABLE: Record<AiErrorCode, boolean> = {
  not_configured: false,
  offline: true,
  timeout: true,
  api_error: true,
  invalid_json: true,
  invalid_response: true,
  blurry_image: false,
  no_products: false,
  cancelled: false,
};

export class AiImportError extends Error {
  readonly code: AiErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly issues: string[];

  constructor(
    code: AiErrorCode,
    message?: string,
    options: { status?: number; retryable?: boolean; issues?: string[] } = {}
  ) {
    super(message ?? code);
    this.name = 'AiImportError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? RETRYABLE[code];
    this.issues = options.issues ?? [];
  }
}

export function isAiImportError(error: unknown): error is AiImportError {
  return error instanceof AiImportError;
}

export function aiErrorMessageKey(code: AiErrorCode): string {
  return `ai.error.${code}`;
}

export type AiDraftErrorCode =
  | 'name'
  | 'type'
  | 'price'
  | 'quantity'
  | 'size'
  | 'barcode_exists'
  | 'not_found'
  | 'save_failed';

/** Validation / persistence errors raised while confirming a draft. */
export class AiDraftError extends Error {
  readonly code: AiDraftErrorCode;

  constructor(code: AiDraftErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AiDraftError';
    this.code = code;
  }
}

export function aiDraftErrorMessageKey(code: AiDraftErrorCode): string {
  return `ai.error.${code}`;
}

