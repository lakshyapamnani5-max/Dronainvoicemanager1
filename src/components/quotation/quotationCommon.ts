import { formatINR } from '../../shared/gstCalculator';
import { formatDate } from '../../lib/utils';
import type { Quotation } from '../../shared/types';

/**
 * Quotation-only data extractor.
 * Intentionally omits invoice numbers, payment statuses, amounts received,
 * balance due, automatic bank details, and automatic UPI QR codes.
 */
export function useQuotationData(record: Quotation) {
  const biz = record.businessSnapshot;
  const cust = record.customerSnapshot;

  const quotationTitle = (record.quotationTitle || '').trim() || 'QUOTATION';
  const quotationNumber = record.quotationNumber || 'QTN-0001';
  const quotationDate = record.quotationDate ? formatDate(record.quotationDate) : '';
  const validUntil = record.validUntil ? formatDate(record.validUntil) : '';
  const hasInterState = Boolean(record.isInterState);
  const isGst = Boolean(record.isGst);
  const items = record.items || [];
  const totalQuantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  const showPaymentInstructions = Boolean(
    record.showPaymentInstructions && (record.paymentInstructions || '').trim()
  );

  return {
    biz,
    cust,
    quotationTitle,
    quotationNumber,
    quotationDate,
    validUntil,
    referenceNumber: (record.referenceNumber || '').trim(),
    placeOfSupply: (record.placeOfSupply || cust.state || '').trim(),
    projectDescription: (record.projectDescription || '').trim(),
    deliveryTimeline: (record.deliveryTimeline || '').trim(),
    paymentTerms: (record.paymentTerms || '').trim(),
    preparedBy: (record.preparedBy || '').trim() || biz.ownerName || '',
    showPaymentInstructions,
    paymentInstructions: showPaymentInstructions ? (record.paymentInstructions || '').trim() : '',
    hasInterState,
    isGst,
    formatINR,
    items,
    totalQuantity,
    subtotal: record.subtotal || 0,
    totalDiscount: record.totalDiscount || 0,
    taxableAmount: record.taxableAmount || 0,
    cgstTotal: record.cgstTotal || 0,
    sgstTotal: record.sgstTotal || 0,
    igstTotal: record.igstTotal || 0,
    totalTax: record.totalTax || 0,
    roundOff: record.roundOff || 0,
    grandTotal: record.grandTotal || 0,
    amountInWords: record.amountInWords || '',
    notes: (record.notes || '').trim(),
    terms: (record.terms || '').trim(),
    signatureLabel: biz.signatureLabel || 'Authorized Signatory',
  };
}
