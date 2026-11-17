import { formatINR } from '../../shared/gstCalculator';
import { formatDate } from '../../lib/utils';
import type { Invoice, Quotation } from '../../shared/types';
import type { InvoiceTemplateProps } from './invoiceThemeTypes';

export function useInvoiceData({ docType, record }: InvoiceTemplateProps) {
  const biz = record.businessSnapshot;
  const cust = record.customerSnapshot;
  const isInvoice = docType === 'invoice';
  const inv = isInvoice ? (record as Invoice) : null;
  const quo = !isInvoice ? (record as Quotation) : null;

  const docNumber = inv ? inv.invoiceNumber : quo ? quo.quotationNumber : 'INV-0001';
  const docDate = inv ? inv.invoiceDate : quo ? quo.quotationDate : '';
  const dueDate = inv ? inv.dueDate : quo ? quo.validUntil : '';
  const docTitle = isInvoice
    ? record.isGst
      ? 'TAX INVOICE'
      : 'BILL OF SUPPLY'
    : 'QUOTATION';

  const amountPaid = inv ? inv.amountPaid || 0 : 0;
  const balanceDue = inv ? (inv.balanceDue !== undefined ? inv.balanceDue : record.grandTotal) : record.grandTotal;

  const hasInterState = Boolean(record.isInterState);
  const isGst = Boolean(record.isGst);

  return {
    biz,
    cust,
    isInvoice,
    inv,
    quo,
    docNumber,
    docDate: docDate ? formatDate(docDate) : '',
    rawDocDate: docDate,
    dueDate: dueDate ? formatDate(dueDate) : '',
    rawDueDate: dueDate,
    docTitle,
    amountPaid,
    balanceDue,
    hasInterState,
    isGst,
    formatINR,
    items: record.items || [],
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
    notes: record.notes || '',
    terms: record.terms || '',
    signatureLabel: biz.signatureLabel || 'Authorized Signatory',
  };
}
