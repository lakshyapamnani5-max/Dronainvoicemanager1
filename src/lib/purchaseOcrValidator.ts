import { GSTIN_REGEX, getStateFromGstin, isValidGstinChecksum } from '../shared/indianStates';
import { formatINR } from '../shared/gstCalculator';
import type {
  OcrConfidenceLevel,
  OcrFieldValidation,
  PurchaseLineItemInput,
  PurchaseOcrRawResponse,
  PurchaseType,
} from '../shared/types';

export interface ValidatedPurchaseOcrResult {
  supplier: {
    businessName: string;
    gstin: string;
    address: string;
    state: string;
    phone: string;
    email: string;
  };
  invoice: {
    billNumber: string;
    billDate: string;
    dueDate: string;
    referenceNumber: string;
  };
  purchaseType: PurchaseType;
  items: PurchaseLineItemInput[];
  summary: {
    additionalCharges: number;
    invoiceDiscountValue: number;
    roundOff: number;
    extractedGrandTotal: number;
  };
  fieldValidation: Record<string, OcrFieldValidation>;
  warnings: string[];
}

export function confidenceToLevel(
  conf: number | null | undefined,
  hasValue: boolean,
  required = false
): OcrConfidenceLevel {
  if (!hasValue) return required ? 'invalid' : 'review';
  if (conf === null || conf === undefined) return 'review';
  if (conf >= 0.85) return 'high';
  if (conf >= 0.6) return 'review';
  return 'invalid';
}

function isValidIsoDate(val: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const dt = new Date(`${val}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === val;
}

export function validatePurchaseOcrResponse(
  raw: PurchaseOcrRawResponse,
  recipientState: string
): ValidatedPurchaseOcrResult {
  const warnings: string[] = [];
  const fieldValidation: Record<string, OcrFieldValidation> = {};

  const sName = String(raw.supplier?.businessName?.value || '').trim();
  const sGstin = String(raw.supplier?.gstin?.value || '').trim().toUpperCase().replace(/\s+/g, '');
  const sAddr = String(raw.supplier?.address?.value || '').trim();
  let sState = String(raw.supplier?.state?.value || '').trim();
  const sPhone = String(raw.supplier?.phone?.value || '').trim();
  const sEmail = String(raw.supplier?.email?.value || '').trim();

  fieldValidation['supplier.businessName'] = {
    confidence: raw.supplier?.businessName?.confidence ?? null,
    level: confidenceToLevel(raw.supplier?.businessName?.confidence, Boolean(sName), true),
    message: sName ? undefined : 'Supplier business name was not detected',
  };
  if (!sName) warnings.push('Supplier business name missing — please enter or pick a supplier.');

  let gstinLevel = confidenceToLevel(raw.supplier?.gstin?.confidence, Boolean(sGstin), false);
  let gstinMsg: string | undefined;
  if (sGstin) {
    if (!GSTIN_REGEX.test(sGstin)) {
      gstinLevel = 'invalid';
      gstinMsg = 'Extracted GSTIN does not match the 15-character Indian GSTIN pattern.';
      warnings.push(`Extracted GSTIN "${sGstin}" failed format validation.`);
    } else if (!isValidGstinChecksum(sGstin)) {
      gstinLevel = 'invalid';
      gstinMsg = 'Extracted GSTIN checksum digit failed verification.';
      warnings.push(`Extracted GSTIN "${sGstin}" failed checksum validation.`);
    } else if (!sState) {
      sState = getStateFromGstin(sGstin) || '';
    }
  }
  fieldValidation['supplier.gstin'] = {
    confidence: raw.supplier?.gstin?.confidence ?? null,
    level: gstinLevel,
    message: gstinMsg,
  };

  fieldValidation['supplier.address'] = {
    confidence: raw.supplier?.address?.confidence ?? null,
    level: confidenceToLevel(raw.supplier?.address?.confidence, Boolean(sAddr)),
  };
  fieldValidation['supplier.state'] = {
    confidence: raw.supplier?.state?.confidence ?? null,
    level: confidenceToLevel(raw.supplier?.state?.confidence, Boolean(sState)),
  };
  fieldValidation['supplier.phone'] = {
    confidence: raw.supplier?.phone?.confidence ?? null,
    level: confidenceToLevel(raw.supplier?.phone?.confidence, Boolean(sPhone)),
  };
  fieldValidation['supplier.email'] = {
    confidence: raw.supplier?.email?.confidence ?? null,
    level: confidenceToLevel(raw.supplier?.email?.confidence, Boolean(sEmail)),
  };

  const billNumber = String(raw.invoice?.invoiceNumber?.value || '').trim();
  const billDate = String(raw.invoice?.invoiceDate?.value || '').trim();
  const dueDate = String(raw.invoice?.dueDate?.value || '').trim();
  const referenceNumber = String(raw.invoice?.poNumber?.value || '').trim();

  fieldValidation['invoice.billNumber'] = {
    confidence: raw.invoice?.invoiceNumber?.confidence ?? null,
    level: confidenceToLevel(raw.invoice?.invoiceNumber?.confidence, Boolean(billNumber), true),
    message: billNumber ? undefined : 'Invoice / Bill number missing',
  };
  if (!billNumber) warnings.push('Purchase Bill Number missing — please verify from document.');

  const validBillDate = isValidIsoDate(billDate);
  fieldValidation['invoice.billDate'] = {
    confidence: raw.invoice?.invoiceDate?.confidence ?? null,
    level: validBillDate
      ? confidenceToLevel(raw.invoice?.invoiceDate?.confidence, true, true)
      : 'invalid',
    message: validBillDate ? undefined : 'Invoice date missing or unreadable',
  };
  if (!validBillDate) warnings.push('Invoice date missing or unclear — verify date before saving.');

  const validDueDate = dueDate ? isValidIsoDate(dueDate) : false;
  fieldValidation['invoice.dueDate'] = {
    confidence: raw.invoice?.dueDate?.confidence ?? null,
    level: dueDate
      ? validDueDate
        ? confidenceToLevel(raw.invoice?.dueDate?.confidence, true)
        : 'invalid'
      : 'review',
  };

  fieldValidation['invoice.referenceNumber'] = {
    confidence: raw.invoice?.poNumber?.confidence ?? null,
    level: confidenceToLevel(raw.invoice?.poNumber?.confidence, Boolean(referenceNumber)),
  };

  // Validate line items without silently overwriting extracted values
  const extractedItems = Array.isArray(raw.items) ? raw.items : [];
  let sumExtractedLineTotals = 0;
  let hasAnyTax = Number(raw.summary?.totalGst?.value || 0) > 0;

  const items: PurchaseLineItemInput[] = extractedItems.map((it, idx) => {
    const name = String(it.name?.value || '').trim() || `Extracted Item #${idx + 1}`;
    const qty = Number(it.quantity?.value ?? 1);
    const rate = Number(it.rate?.value ?? 0);
    const discount = Math.max(0, Number(it.discount?.value ?? 0));
    const taxable = Number(it.taxableValue?.value ?? 0);
    const gstRate = Math.max(0, Number(it.gstRate?.value ?? 0));
    const cgst = Math.max(0, Number(it.cgst?.value ?? 0));
    const sgst = Math.max(0, Number(it.sgst?.value ?? 0));
    const igst = Math.max(0, Number(it.igst?.value ?? 0));
    const lineTotal = Number(it.lineTotal?.value ?? 0);

    if (gstRate > 0 || cgst > 0 || sgst > 0 || igst > 0) hasAnyTax = true;
    sumExtractedLineTotals += lineTotal > 0 ? lineTotal : taxable + cgst + sgst + igst;

    const itemIssues: string[] = [];
    if (!it.name?.value) itemIssues.push('Missing item name');
    if (!Number.isFinite(qty) || qty <= 0) itemIssues.push('Quantity <= 0');
    if (!Number.isFinite(rate) || rate < 0) itemIssues.push('Invalid rate');

    const expectedGrossAfterDisc = Math.max(0, qty * rate - discount);
    if (taxable > 0 && Math.abs(expectedGrossAfterDisc - taxable) > 2) {
      itemIssues.push(
        `Qty×Rate (${formatINR(expectedGrossAfterDisc)}) ≠ OCR Taxable (${formatINR(taxable)})`
      );
    }
    if ((cgst > 0 || sgst > 0) && igst > 0) {
      itemIssues.push('Both CGST/SGST and IGST detected on same line');
    }
    if (taxable > 0 && lineTotal > 0) {
      const taxSum = cgst + sgst + igst;
      if (Math.abs(taxable + taxSum - lineTotal) > 2) {
        itemIssues.push(
          `Taxable + GST (${formatINR(taxable + taxSum)}) ≠ Line Total (${formatINR(lineTotal)})`
        );
      }
    }

    const confValues = [
      it.name?.confidence,
      it.quantity?.confidence,
      it.rate?.confidence,
      it.lineTotal?.confidence,
    ].filter((c): c is number => typeof c === 'number');
    const minConf = confValues.length > 0 ? Math.min(...confValues) : null;

    let ocrStatus: OcrConfidenceLevel = confidenceToLevel(minConf, Boolean(it.name?.value), true);
    if (itemIssues.length > 0) {
      ocrStatus = itemIssues.some((m) => m.includes('≠') || m.includes('Both'))
        ? 'invalid'
        : 'review';
      warnings.push(`Row #${idx + 1} (${name}): ${itemIssues.join('; ')}`);
    }

    let derivedGstRate = gstRate;
    if (derivedGstRate === 0 && taxable > 0 && cgst + sgst + igst > 0) {
      const approxPct = Math.round(((cgst + sgst + igst) / taxable) * 100);
      if ([5, 12, 18, 28].includes(approxPct)) {
        derivedGstRate = approxPct;
      }
    }

    return {
      name,
      description: String(it.description?.value || '').trim(),
      hsnSac: String(it.hsnSac?.value || '').trim(),
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unit: String(it.unit?.value || 'Nos').trim() || 'Nos',
      rate: Number.isFinite(rate) && rate >= 0 ? rate : 0,
      discountType: 'fixed',
      discountValue: discount,
      taxRate: derivedGstRate,
      ocrConfidence: minConf,
      ocrStatus,
      ocrMessage: itemIssues.length > 0 ? itemIssues.join(' · ') : undefined,
    };
  });

  if (items.length === 0) {
    warnings.push('No itemized table rows detected by PP-StructureV3 — please add items manually.');
  }

  const extractedGrand = Number(raw.summary?.grandTotal?.value ?? 0);
  const additionalCharges = Math.max(0, Number(raw.summary?.additionalCharges?.value ?? 0));
  const invoiceDiscountValue = Math.max(0, Number(raw.summary?.totalDiscount?.value ?? 0));
  const roundOff = Number(raw.summary?.roundOff?.value ?? 0);

  if (
    extractedGrand > 0 &&
    sumExtractedLineTotals > 0 &&
    Math.abs(sumExtractedLineTotals + additionalCharges + roundOff - extractedGrand) > 3
  ) {
    warnings.push(
      `Extracted line items sum (${formatINR(sumExtractedLineTotals)}) differs from extracted Grand Total (${formatINR(extractedGrand)}). Review quantities, discounts, and GST.`
    );
  }

  // Check state consistency with CGST/SGST vs IGST
  const cgstSummary = Number(raw.summary?.cgstTotal?.value ?? 0);
  const sgstSummary = Number(raw.summary?.sgstTotal?.value ?? 0);
  const igstSummary = Number(raw.summary?.igstTotal?.value ?? 0);
  if (sState && recipientState) {
    const sameState = sState.toLowerCase() === recipientState.toLowerCase();
    if (sameState && igstSummary > 0) {
      warnings.push(
        `Supplier state (${sState}) matches your business state, yet IGST (${formatINR(igstSummary)}) was detected. Verify Place of Supply.`
      );
    } else if (!sameState && (cgstSummary > 0 || sgstSummary > 0)) {
      warnings.push(
        `Supplier state (${sState}) differs from your business state (${recipientState}), yet CGST/SGST was detected. Verify tax regime.`
      );
    }
  }

  const purchaseType: PurchaseType = hasAnyTax || Boolean(sGstin) ? 'gst' : 'non_gst';

  return {
    supplier: {
      businessName: sName,
      gstin: sGstin,
      address: sAddr,
      state: sState || recipientState || 'Maharashtra',
      phone: sPhone,
      email: sEmail,
    },
    invoice: {
      billNumber,
      billDate: validBillDate ? billDate : new Date().toISOString().slice(0, 10),
      dueDate: validDueDate ? dueDate : '',
      referenceNumber,
    },
    purchaseType,
    items:
      items.length > 0
        ? items
        : [
            {
              name: '',
              description: '',
              hsnSac: '',
              quantity: 1,
              unit: 'Nos',
              rate: 0,
              discountType: 'percent',
              discountValue: 0,
              taxRate: purchaseType === 'gst' ? 18 : 0,
              ocrStatus: 'invalid',
              ocrMessage: 'Not detected in scan',
            },
          ],
    summary: {
      additionalCharges,
      invoiceDiscountValue,
      roundOff,
      extractedGrandTotal: extractedGrand,
    },
    fieldValidation,
    warnings,
  };
}
