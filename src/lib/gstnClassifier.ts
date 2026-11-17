/**
 * GSTN GSTR-1 Classification Engine for DronaInvoice
 * Analyzes tenant invoices according to official GST rules and aggregates into GSTN tables.
 */

import { getStateCode, isValidGstin } from '../shared/indianStates';
import type { Invoice, LineItemInput } from '../shared/types';
import {
  type ClassifiedLineSummary,
  type ClassifiedTransaction,
  type GstPeriodOption,
  type GstReturnConfig,
  type GstReturnPeriodType,
  type GstTransactionCategory,
  type Gstr1ComprehensiveSummary,
  type Gstr1DocCategory,
  type Gstr1HsnItem,
  type Gstr1SummarySection,
} from '../shared/gstnTypes';
import { getHsnSacDescription, mapUnitToUqc } from './hsnSacService';

/**
 * Generate monthly and quarterly periods for a given Financial Year (e.g. "2026-27")
 */
export function generatePeriodOptions(
  fy: string,
  frequency: GstReturnPeriodType = 'monthly'
): GstPeriodOption[] {
  const [startYearStr] = fy.split('-');
  const startYear = parseInt(startYearStr, 10) || new Date().getFullYear();
  const endYear = startYear + 1;

  if (frequency === 'quarterly') {
    return [
      {
        code: `06${startYear}`,
        label: `Q1: Apr – Jun ${startYear}`,
        startDate: `${startYear}-04-01`,
        endDate: `${startYear}-06-30`,
        month: 6,
        year: startYear,
        quarter: 'Q1',
      },
      {
        code: `09${startYear}`,
        label: `Q2: Jul – Sep ${startYear}`,
        startDate: `${startYear}-07-01`,
        endDate: `${startYear}-09-30`,
        month: 9,
        year: startYear,
        quarter: 'Q2',
      },
      {
        code: `12${startYear}`,
        label: `Q3: Oct – Dec ${startYear}`,
        startDate: `${startYear}-10-01`,
        endDate: `${startYear}-12-31`,
        month: 12,
        year: startYear,
        quarter: 'Q3',
      },
      {
        code: `03${endYear}`,
        label: `Q4: Jan – Mar ${endYear}`,
        startDate: `${endYear}-01-01`,
        endDate: `${endYear}-03-31`,
        month: 3,
        year: endYear,
        quarter: 'Q4',
      },
    ];
  }

  // Monthly
  const months = [
    { m: 4, name: 'April', yr: startYear },
    { m: 5, name: 'May', yr: startYear },
    { m: 6, name: 'June', yr: startYear },
    { m: 7, name: 'July', yr: startYear },
    { m: 8, name: 'August', yr: startYear },
    { m: 9, name: 'September', yr: startYear },
    { m: 10, name: 'October', yr: startYear },
    { m: 11, name: 'November', yr: startYear },
    { m: 12, name: 'December', yr: startYear },
    { m: 1, name: 'January', yr: endYear },
    { m: 2, name: 'February', yr: endYear },
    { m: 3, name: 'March', yr: endYear },
  ];

  return months.map(({ m, name, yr }) => {
    const mmStr = String(m).padStart(2, '0');
    const code = `${mmStr}${yr}`;
    const lastDay = new Date(yr, m, 0).getDate();
    return {
      code,
      label: `${name} ${yr}`,
      startDate: `${yr}-${mmStr}-01`,
      endDate: `${yr}-${mmStr}-${String(lastDay).padStart(2, '0')}`,
      month: m,
      year: yr,
    };
  });
}

/**
 * Normalizes Place of Supply string into official 2-digit GST state code
 */
export function normalizePlaceOfSupplyCode(
  placeOfSupply: string | undefined,
  customerGstin?: string
): string {
  if (customerGstin && customerGstin.trim().length >= 2) {
    const prefix = customerGstin.trim().slice(0, 2);
    if (/^\d{2}$/.test(prefix)) return prefix;
  }

  if (!placeOfSupply) return '';
  const trimmed = placeOfSupply.trim();

  // If already 2 numeric digits
  if (/^\d{2}$/.test(trimmed)) return trimmed;

  // Export / Other Territory
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('other territory') ||
    lower.includes('outside india') ||
    lower.includes('export') ||
    lower.includes('foreign')
  ) {
    return '96';
  }

  const code = getStateCode(trimmed);
  return code ? code.padStart(2, '0') : '';
}

/**
 * Determines whether an invoice qualifies as an Export
 */
export function isExportTransaction(inv: Invoice, posCode: string): boolean {
  if (posCode === '96') return true;
  const custState = (inv.customerSnapshot?.state || '').toLowerCase();
  if (
    custState.includes('outside india') ||
    custState.includes('export') ||
    custState.includes('foreign')
  ) {
    return true;
  }
  const notesRef = `${inv.notes || ''} ${inv.referenceNumber || ''} ${inv.paymentTerms || ''}`.toUpperCase();
  if (notesRef.includes('EXPORT') || notesRef.includes('LUT') || notesRef.includes('SEZ')) {
    const custGstin = (inv.customerSnapshot?.gstin || '').trim();
    if (!custGstin || custGstin === 'URP') return true;
  }
  return false;
}

/**
 * Determines if an invoice is a Credit Note or Debit Note
 */
export function detectCreditDebitNote(inv: Invoice): {
  isNote: boolean;
  type: 'C' | 'D' | null;
} {
  const numUpper = inv.invoiceNumber.toUpperCase();
  const refUpper = (inv.referenceNumber || '').toUpperCase();

  if (numUpper.startsWith('CRN') || numUpper.startsWith('CN-') || refUpper.includes('CREDIT NOTE') || inv.grandTotal < 0) {
    return { isNote: true, type: 'C' };
  }
  if (numUpper.startsWith('DBN') || numUpper.startsWith('DN-') || refUpper.includes('DEBIT NOTE')) {
    return { isNote: true, type: 'D' };
  }
  return { isNote: false, type: null };
}

/**
 * Classifies an individual invoice into GSTN GSTR-1 category
 */
export function classifyInvoice(
  inv: Invoice,
  sellerState: string
): ClassifiedTransaction {
  const sellerStateCode = getStateCode(sellerState) || '27';
  const rawGstin = (inv.customerSnapshot?.gstin || '').trim().toUpperCase();
  const hasValidCustomerGstin = Boolean(rawGstin && isValidGstin(rawGstin) && rawGstin !== 'URP');
  const posCode = normalizePlaceOfSupplyCode(inv.placeOfSupply, rawGstin) || sellerStateCode;

  const isInterState =
    inv.isInterState !== undefined
      ? inv.isInterState
      : posCode !== sellerStateCode;

  const noteInfo = detectCreditDebitNote(inv);
  const isExport = isExportTransaction(inv, posCode);
  const isCancelled = inv.status === 'cancelled';
  const isDraft = inv.status === 'draft';

  // Group line items by rate
  const rateGroups = new Map<number, ClassifiedLineSummary>();
  let totalCess = 0;

  for (const it of inv.items || []) {
    const rate = Number(it.taxRate) || 0;
    const existing = rateGroups.get(rate) || {
      rate,
      taxableAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      cessAmount: 0,
    };

    existing.taxableAmount += it.taxableAmount || 0;
    existing.cgstAmount += it.cgstAmount || 0;
    existing.sgstAmount += it.sgstAmount || 0;
    existing.igstAmount += it.igstAmount || 0;
    rateGroups.set(rate, existing);
  }

  const lineSummaries = Array.from(rateGroups.values());

  // Determine Category
  let category: GstTransactionCategory;
  let subType: string | undefined;

  if (noteInfo.isNote) {
    if (hasValidCustomerGstin) {
      category = 'CDNR';
      subType = noteInfo.type || 'C';
    } else {
      category = 'CDNUR';
      subType = noteInfo.type || 'C';
    }
  } else if (isExport) {
    category = 'EXP';
    subType = inv.totalTax > 0 ? 'WPAY' : 'WOPAY';
  } else if (hasValidCustomerGstin) {
    category = 'B2B';
    const notesRef = `${inv.notes || ''} ${inv.referenceNumber || ''}`.toUpperCase();
    if (notesRef.includes('DEEMED')) subType = 'DE';
    else if (notesRef.includes('SEZ') && inv.totalTax > 0) subType = 'SEWP';
    else if (notesRef.includes('SEZ') && inv.totalTax === 0) subType = 'SEWOP';
    else subType = 'R';
  } else {
    // Unregistered recipient (Consumer)
    const isNilEntirely = (inv.items || []).every((it) => (it.taxRate || 0) === 0);
    if (isNilEntirely && inv.taxableAmount > 0) {
      category = 'NIL';
    } else if (isInterState && inv.grandTotal > 250000) {
      // B2C Large: Inter-state invoice value strictly exceeding 2.5 Lakhs
      category = 'B2CL';
    } else {
      // B2C Small: All intra-state B2C + inter-state B2C <= 2.5 Lakhs
      category = 'B2CS';
    }
  }

  return {
    category,
    subType,
    invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    posCode,
    posStateName: inv.placeOfSupply || sellerState,
    customerName: inv.customerSnapshot?.companyName || inv.customerSnapshot?.name || 'Consumer',
    customerGstin: rawGstin,
    isRegistered: hasValidCustomerGstin,
    isInterState,
    isCancelled,
    isDraft,
    taxableAmount: Math.abs(inv.taxableAmount || 0),
    cgstAmount: Math.abs(inv.cgstTotal || 0),
    sgstAmount: Math.abs(inv.sgstTotal || 0),
    igstAmount: Math.abs(inv.igstTotal || 0),
    cessAmount: totalCess,
    totalTax: Math.abs(inv.totalTax || 0),
    invoiceValue: Math.abs(inv.grandTotal || 0),
    items: lineSummaries,
  };
}

/**
 * Compiles comprehensive GSTR-1 summary from invoices for the selected period
 */
export function compileGstr1Summary(
  invoices: Invoice[],
  config: GstReturnConfig,
  sellerState: string,
  businessName: string
): Gstr1ComprehensiveSummary {
  const periodOptions = generatePeriodOptions(config.financialYear, config.frequency);
  const selectedPeriod =
    periodOptions.find((p) => p.code === config.periodCode) || periodOptions[0];

  // Filter invoices within return period date range & matching selected GSTIN if specified
  const filtered = invoices.filter((inv) => {
    if (!inv.invoiceDate) return false;
    // Date comparison YYYY-MM-DD
    const inRange =
      inv.invoiceDate >= selectedPeriod.startDate &&
      inv.invoiceDate <= selectedPeriod.endDate;
    if (!inRange) return false;

    // Ignore if not a GST invoice
    if (inv.isGst === false) return false;

    // If invoice has a business snapshot with gstin, ensure it matches selected config GSTIN
    const invGstin = inv.businessSnapshot?.gstin?.trim().toUpperCase();
    if (invGstin && config.gstin && invGstin !== config.gstin.trim().toUpperCase()) {
      return false;
    }

    return true;
  });

  // Classify each transaction
  const transactions: ClassifiedTransaction[] = [];
  let totalInvoicesScanned = filtered.length;
  let activeInvoicesCount = 0;
  let cancelledInvoicesCount = 0;
  let draftInvoicesCount = 0;

  // Initialize summary sections
  const initSection = (code: string, title: string, tableNumber: string): Gstr1SummarySection => ({
    title,
    code,
    tableNumber,
    invoiceCount: 0,
    taxableValue: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    cessAmount: 0,
    totalTax: 0,
    totalInvoiceValue: 0,
  });

  const sections: Record<GstTransactionCategory, Gstr1SummarySection> = {
    B2B: initSection('B2B', 'B2B Invoices (Registered)', 'Table 4'),
    B2CL: initSection('B2CL', 'B2C (Large) Invoices', 'Table 5'),
    B2CS: initSection('B2CS', 'B2C (Small) Details', 'Table 7'),
    CDNR: initSection('CDNR', 'Credit/Debit Notes (Registered)', 'Table 9B'),
    CDNUR: initSection('CDNUR', 'Credit/Debit Notes (Unregistered)', 'Table 9B'),
    EXP: initSection('EXP', 'Export Invoices', 'Table 6A'),
    NIL: initSection('NIL', 'Nil Rated & Exempted', 'Table 8'),
  };

  // HSN Aggregator: Key = `${hsnCode}_${rate}`
  interface HsnBucket {
    hsn_sc: string;
    desc: string;
    uqc: string;
    qty: number;
    txval: number;
    rt: number;
    iamt: number;
    camt: number;
    samt: number;
    csamt: number;
  }
  const hsnMap = new Map<string, HsnBucket>();

  for (const inv of filtered) {
    if (inv.status === 'cancelled') {
      cancelledInvoicesCount++;
      continue; // Excluded from monetary outward supply totals as per GST rules
    }
    if (inv.status === 'draft') {
      draftInvoicesCount++;
      // Drafts are inspected but excluded from official totals
      continue;
    }

    activeInvoicesCount++;
    const classified = classifyInvoice(inv, sellerState);
    transactions.push(classified);

    const sec = sections[classified.category];
    sec.invoiceCount += 1;
    sec.taxableValue += classified.taxableAmount;
    sec.cgstAmount += classified.cgstAmount;
    sec.sgstAmount += classified.sgstAmount;
    sec.igstAmount += classified.igstAmount;
    sec.cessAmount += classified.cessAmount;
    sec.totalTax += classified.totalTax;
    sec.totalInvoiceValue += classified.invoiceValue;

    // Aggregate into HSN Summary for Table 12
    for (const item of inv.items || []) {
      const code = (item.hsnSac || '').trim() || 'OTH';
      const rate = Number(item.taxRate) || 0;
      const key = `${code}_${rate}`;

      const uqc = mapUnitToUqc(item.unit);
      const desc = getHsnSacDescription(code) || item.name || 'Goods/Services';

      const existing = hsnMap.get(key) || {
        hsn_sc: code,
        desc: desc.slice(0, 100),
        uqc,
        qty: 0,
        txval: 0,
        rt: rate,
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0,
      };

      existing.qty += item.quantity || 0;
      existing.txval += item.taxableAmount || 0;
      existing.iamt += item.igstAmount || 0;
      existing.camt += item.cgstAmount || 0;
      existing.samt += item.sgstAmount || 0;
      hsnMap.set(key, existing);
    }
  }

  // Build HSN List (Table 12)
  const hsnSummary: Gstr1HsnItem[] = Array.from(hsnMap.values()).map((b, idx) => ({
    num: idx + 1,
    hsn_sc: b.hsn_sc,
    desc: b.desc,
    uqc: b.uqc,
    qty: Math.round(b.qty * 100) / 100,
    txval: Math.round(b.txval * 100) / 100,
    rt: b.rt,
    iamt: Math.round(b.iamt * 100) / 100,
    camt: Math.round(b.camt * 100) / 100,
    samt: Math.round(b.samt * 100) / 100,
    csamt: Math.round(b.csamt * 100) / 100,
  }));

  // Build Document Issued Summary (Table 13)
  // Sort invoices by date / number to find min and max sequence
  const sortedInvoices = [...filtered].sort((a, b) =>
    a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true })
  );

  const outwardInvoices = sortedInvoices.filter((i) => !detectCreditDebitNote(i).isNote);
  const creditNotes = sortedInvoices.filter((i) => detectCreditDebitNote(i).type === 'C');
  const debitNotes = sortedInvoices.filter((i) => detectCreditDebitNote(i).type === 'D');

  const docSummary: Gstr1DocCategory[] = [];

  // Category 1: Invoices for outward supply
  if (outwardInvoices.length > 0) {
    const totalOutward = outwardInvoices.length;
    const cancOutward = outwardInvoices.filter((i) => i.status === 'cancelled').length;
    docSummary.push({
      doc_num: 1,
      doc_typ: 'Invoices for outward supply',
      docs: [
        {
          num: 1,
          from: outwardInvoices[0].invoiceNumber,
          to: outwardInvoices[totalOutward - 1].invoiceNumber,
          totnum: totalOutward,
          canc: cancOutward,
          net_issue: totalOutward - cancOutward,
        },
      ],
    });
  }

  // Category 5: Credit Note
  if (creditNotes.length > 0) {
    const totalCn = creditNotes.length;
    const cancCn = creditNotes.filter((i) => i.status === 'cancelled').length;
    docSummary.push({
      doc_num: 5,
      doc_typ: 'Credit Note',
      docs: [
        {
          num: 1,
          from: creditNotes[0].invoiceNumber,
          to: creditNotes[totalCn - 1].invoiceNumber,
          totnum: totalCn,
          canc: cancCn,
          net_issue: totalCn - cancCn,
        },
      ],
    });
  }

  // Category 4: Debit Note
  if (debitNotes.length > 0) {
    const totalDn = debitNotes.length;
    const cancDn = debitNotes.filter((i) => i.status === 'cancelled').length;
    docSummary.push({
      doc_num: 4,
      doc_typ: 'Debit Note',
      docs: [
        {
          num: 1,
          from: debitNotes[0].invoiceNumber,
          to: debitNotes[totalDn - 1].invoiceNumber,
          totnum: totalDn,
          canc: cancDn,
          net_issue: totalDn - cancDn,
        },
      ],
    });
  }

  // Calculate grand totals across active sections
  let totalTaxableValue = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalTax = 0;
  let totalInvoiceValue = 0;

  for (const s of Object.values(sections)) {
    totalTaxableValue += s.taxableValue;
    totalCgst += s.cgstAmount;
    totalSgst += s.sgstAmount;
    totalIgst += s.igstAmount;
    totalTax += s.totalTax;
    totalInvoiceValue += s.totalInvoiceValue;
  }

  return {
    periodCode: selectedPeriod.code,
    periodLabel: selectedPeriod.label,
    financialYear: config.financialYear,
    gstin: config.gstin || '',
    supplierName: businessName,
    totalInvoicesScanned,
    activeInvoicesCount,
    cancelledInvoicesCount,
    draftInvoicesCount,
    totalTaxableValue: Math.round(totalTaxableValue * 100) / 100,
    totalCgst: Math.round(totalCgst * 100) / 100,
    totalSgst: Math.round(totalSgst * 100) / 100,
    totalIgst: Math.round(totalIgst * 100) / 100,
    totalCess: 0,
    totalTax: Math.round(totalTax * 100) / 100,
    totalInvoiceValue: Math.round(totalInvoiceValue * 100) / 100,
    sections,
    hsnSummary,
    docSummary,
    transactions,
  };
}
