import type { ValidatedPurchaseOcrResult } from './purchaseOcrValidator';

export interface StagedPurchaseScanPayload {
  validatedOcr: ValidatedPurchaseOcrResult | null;
  rawText?: string;
  ocrEngine?: string;
  pageCount?: number;
  attachmentFile: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    base64Data: string;
    pageCount?: number;
  };
  createdAt: number;
}

let memoryStagedScan: StagedPurchaseScanPayload | null = null;

export function setStagedPurchaseScan(payload: StagedPurchaseScanPayload | null): void {
  memoryStagedScan = payload;
}

export function getStagedPurchaseScan(): StagedPurchaseScanPayload | null {
  return memoryStagedScan;
}

export function clearStagedPurchaseScan(): void {
  memoryStagedScan = null;
}
