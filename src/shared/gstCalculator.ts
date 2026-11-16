import type {
  ComputedLineItem,
  ComputedPurchaseLineItem,
  DiscountType,
  LineItemInput,
  PurchaseLineItemInput,
  PurchaseType,
  TaxPricingMode,
  TaxSupplyMode,
} from './types';

export function toPaise(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

export function formatINR(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function formatINRForPdf(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
  return `INR ${formatted}`;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seven' + 'ty',
  'Eighty',
  'Ninety',
];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one ? `${TENS[ten]} ${ONES[one]}` : TENS[ten];
}

function integerToIndianWords(num: number): string {
  if (num === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const hundred = Math.floor(num / 100);
  const rem = num % 100;

  if (crore > 0) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (rem > 0) parts.push(twoDigitsToWords(rem));

  return parts.join(' ').trim();
}

export function amountInWordsINR(amount: number): string {
  const totalPaise = Math.max(0, toPaise(amount));
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  const rupeePart = `Rupees ${integerToIndianWords(rupees)}`;
  if (paise === 0) return `${rupeePart} Only`;
  return `${rupeePart} and ${twoDigitsToWords(paise)} Paise Only`;
}

export interface DocumentCalculationInput {
  items: LineItemInput[];
  businessState: string;
  placeOfSupply: string;
  isGst: boolean;
  taxMode: TaxPricingMode;
  taxSupplyMode: TaxSupplyMode;
  roundOffEnabled: boolean;
}

export interface DocumentCalculationResult {
  items: ComputedLineItem[];
  isInterState: boolean;
  subtotalPaise: number;
  totalDiscountPaise: number;
  taxableAmountPaise: number;
  cgstTotalPaise: number;
  sgstTotalPaise: number;
  igstTotalPaise: number;
  totalTaxPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
  subtotal: number;
  totalDiscount: number;
  taxableAmount: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  totalTax: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
}

export function determineInterState(
  businessState: string,
  placeOfSupply: string,
  taxSupplyMode: TaxSupplyMode
): boolean {
  if (taxSupplyMode === 'inter') return true;
  if (taxSupplyMode === 'intra') return false;
  const b = businessState.trim().toLowerCase();
  const p = placeOfSupply.trim().toLowerCase();
  if (!b || !p) return false;
  return b !== p;
}

export function computeDocumentTotals(
  input: DocumentCalculationInput
): DocumentCalculationResult {
  const isInterState = determineInterState(
    input.businessState,
    input.placeOfSupply,
    input.taxSupplyMode
  );

  let subtotalPaise = 0;
  let totalDiscountPaise = 0;
  let taxableAmountPaise = 0;
  let cgstTotalPaise = 0;
  let sgstTotalPaise = 0;
  let igstTotalPaise = 0;

  const computedItems: ComputedLineItem[] = input.items.map((item, idx) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const ratePaise = Math.max(0, toPaise(Number(item.rate) || 0));
    const effectiveTaxRate = input.isGst ? Math.max(0, Number(item.taxRate) || 0) : 0;

    // Gross line amount before discount in paise
    const rawLinePaise = Math.round(qty * ratePaise);

    let lineBaseBeforeDiscountPaise = rawLinePaise;
    let discountPaise = 0;

    if (item.discountType === 'percent') {
      const pct = Math.min(100, Math.max(0, Number(item.discountValue) || 0));
      discountPaise = Math.round((rawLinePaise * pct) / 100);
    } else {
      discountPaise = Math.min(rawLinePaise, Math.max(0, toPaise(Number(item.discountValue) || 0)));
    }

    const afterDiscountPaise = Math.max(0, rawLinePaise - discountPaise);

    let itemTaxablePaise = 0;
    let itemTaxPaise = 0;

    if (effectiveTaxRate > 0) {
      if (input.taxMode === 'inclusive') {
        // afterDiscountPaise includes GST: taxable = afterDiscount / (1 + r/100)
        itemTaxablePaise = Math.round((afterDiscountPaise * 100) / (100 + effectiveTaxRate));
        itemTaxPaise = afterDiscountPaise - itemTaxablePaise;
        lineBaseBeforeDiscountPaise = Math.round(
          (rawLinePaise * 100) / (100 + effectiveTaxRate)
        );
        discountPaise = Math.max(0, lineBaseBeforeDiscountPaise - itemTaxablePaise);
      } else {
        itemTaxablePaise = afterDiscountPaise;
        itemTaxPaise = Math.round((itemTaxablePaise * effectiveTaxRate) / 100);
      }
    } else {
      itemTaxablePaise = afterDiscountPaise;
      itemTaxPaise = 0;
    }

    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;

    if (itemTaxPaise > 0) {
      if (isInterState) {
        igstPaise = itemTaxPaise;
      } else {
        cgstPaise = Math.floor(itemTaxPaise / 2);
        sgstPaise = itemTaxPaise - cgstPaise;
      }
    }

    const itemTotalPaise = itemTaxablePaise + itemTaxPaise;

    subtotalPaise += lineBaseBeforeDiscountPaise;
    totalDiscountPaise += discountPaise;
    taxableAmountPaise += itemTaxablePaise;
    cgstTotalPaise += cgstPaise;
    sgstTotalPaise += sgstPaise;
    igstTotalPaise += igstPaise;

    return {
      ...item,
      sortOrder: idx,
      quantity: qty,
      rate: fromPaise(ratePaise),
      discountValue: Number(item.discountValue) || 0,
      taxRate: effectiveTaxRate,
      grossAmount: fromPaise(lineBaseBeforeDiscountPaise),
      discountAmount: fromPaise(discountPaise),
      taxableAmount: fromPaise(itemTaxablePaise),
      cgstAmount: fromPaise(cgstPaise),
      sgstAmount: fromPaise(sgstPaise),
      igstAmount: fromPaise(igstPaise),
      taxAmount: fromPaise(itemTaxPaise),
      totalAmount: fromPaise(itemTotalPaise),
    };
  });

  const totalTaxPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise;
  const preRoundGrandPaise = taxableAmountPaise + totalTaxPaise;
  let roundOffPaise = 0;
  let grandTotalPaise = preRoundGrandPaise;

  if (input.roundOffEnabled) {
    const roundedRupees = Math.round(preRoundGrandPaise / 100);
    grandTotalPaise = roundedRupees * 100;
    roundOffPaise = grandTotalPaise - preRoundGrandPaise;
  }

  const grandTotal = fromPaise(grandTotalPaise);

  return {
    items: computedItems,
    isInterState,
    subtotalPaise,
    totalDiscountPaise,
    taxableAmountPaise,
    cgstTotalPaise,
    sgstTotalPaise,
    igstTotalPaise,
    totalTaxPaise,
    roundOffPaise,
    grandTotalPaise,
    subtotal: fromPaise(subtotalPaise),
    totalDiscount: fromPaise(totalDiscountPaise),
    taxableAmount: fromPaise(taxableAmountPaise),
    cgstTotal: fromPaise(cgstTotalPaise),
    sgstTotal: fromPaise(sgstTotalPaise),
    igstTotal: fromPaise(igstTotalPaise),
    totalTax: fromPaise(totalTaxPaise),
    roundOff: fromPaise(roundOffPaise),
    grandTotal,
    amountInWords: amountInWordsINR(grandTotal),
  };
}

export function buildUpiPaymentUri(params: {
  upiId: string;
  payeeName: string;
  amount: number;
  docNumber?: string;
}): string {
  const cleanUpi = params.upiId.trim();
  if (!cleanUpi) return '';
  const parts = [
    `pa=${encodeURIComponent(cleanUpi)}`,
    `pn=${encodeURIComponent((params.payeeName || 'Merchant').trim())}`,
  ];
  if (Number.isFinite(params.amount) && params.amount > 0) {
    parts.push(`am=${params.amount.toFixed(2)}`);
  }
  parts.push('cu=INR');
  if (params.docNumber && params.docNumber.trim()) {
    parts.push(`tn=${encodeURIComponent(`Payment for ${params.docNumber.trim()}`)}`);
  }
  return `upi://pay?${parts.join('&')}`;
}

export interface PurchaseCalculationInput {
  items: PurchaseLineItemInput[];
  supplierState: string;
  recipientState: string;
  placeOfSupply?: string;
  purchaseType: PurchaseType;
  taxMode: TaxPricingMode;
  taxSupplyMode: TaxSupplyMode;
  invoiceDiscountType?: DiscountType;
  invoiceDiscountValue?: number;
  additionalCharges?: number;
  roundOffEnabled: boolean;
}

export interface PurchaseCalculationResult {
  items: ComputedPurchaseLineItem[];
  isGst: boolean;
  isInterState: boolean;
  taxRuleChecked: boolean;
  taxRuleLabel: string;
  taxRuleWarning: string | null;
  subtotal: number;
  itemDiscountTotal: number;
  invoiceDiscountAmount: number;
  totalDiscount: number;
  taxableAmount: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  totalTax: number;
  additionalCharges: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
}

export function computePurchaseTotals(
  input: PurchaseCalculationInput
): PurchaseCalculationResult {
  const isGstApplicable =
    input.purchaseType === 'gst' || input.purchaseType === 'import';
  const supplierState = (input.supplierState || '').trim();
  const recipientState = (input.recipientState || '').trim();
  const pos = (input.placeOfSupply || recipientState).trim();

  let taxRuleChecked = true;
  let taxRuleWarning: string | null = null;
  let isInterState = false;
  let taxRuleLabel = 'Non-GST Purchase (0% GST)';

  if (input.purchaseType === 'non_gst') {
    isInterState = false;
    taxRuleLabel = 'Non-GST Purchase (No ITC / 0% GST)';
  } else if (input.purchaseType === 'composition') {
    isInterState = false;
    taxRuleLabel = 'Composition Supplier (Bill of Supply · 0% GST)';
  } else if (input.purchaseType === 'import') {
    isInterState = true;
    taxRuleLabel = 'Import Purchase (IGST Applicable)';
  } else {
    // Standard GST Purchase: explicitly verify supplier state vs recipient place of supply
    if (input.taxSupplyMode === 'inter') {
      isInterState = true;
      taxRuleLabel = 'Inter-State Override (IGST)';
    } else if (input.taxSupplyMode === 'intra') {
      isInterState = false;
      taxRuleLabel = 'Intra-State Override (CGST + SGST)';
    } else if (!supplierState || !pos) {
      taxRuleChecked = false;
      isInterState = false;
      taxRuleLabel = 'Place of Supply Unverified';
      taxRuleWarning =
        'Select both Supplier State and Recipient Business State / Place of Supply to confirm CGST+SGST vs IGST.';
    } else {
      isInterState = supplierState.toLowerCase() !== pos.toLowerCase();
      taxRuleLabel = isInterState
        ? `Inter-State Supply (${supplierState} → ${pos} · IGST)`
        : `Intra-State Supply (${pos} · CGST + SGST)`;
    }
  }

  // Pass 1: Compute per-item base & item-level discount in paise
  const pass1 = input.items.map((item) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const ratePaise = Math.max(0, toPaise(Number(item.rate) || 0));
    const effectiveTaxRate = isGstApplicable
      ? Math.min(28, Math.max(0, Number(item.taxRate) || 0))
      : 0;
    const rawLinePaise = Math.round(qty * ratePaise);

    let lineBaseBeforeDiscountPaise = rawLinePaise;
    let itemDiscountPaise = 0;

    if (item.discountType === 'percent') {
      const pct = Math.min(100, Math.max(0, Number(item.discountValue) || 0));
      itemDiscountPaise = Math.round((rawLinePaise * pct) / 100);
    } else {
      itemDiscountPaise = Math.min(
        rawLinePaise,
        Math.max(0, toPaise(Number(item.discountValue) || 0))
      );
    }

    const afterItemDiscountPaise = Math.max(0, rawLinePaise - itemDiscountPaise);

    let baseBeforeInvDiscPaise = afterItemDiscountPaise;
    if (effectiveTaxRate > 0 && input.taxMode === 'inclusive') {
      baseBeforeInvDiscPaise = Math.round(
        (afterItemDiscountPaise * 100) / (100 + effectiveTaxRate)
      );
      lineBaseBeforeDiscountPaise = Math.round(
        (rawLinePaise * 100) / (100 + effectiveTaxRate)
      );
      itemDiscountPaise = Math.max(0, lineBaseBeforeDiscountPaise - baseBeforeInvDiscPaise);
    }

    return {
      item,
      qty,
      ratePaise,
      effectiveTaxRate,
      lineBaseBeforeDiscountPaise,
      itemDiscountPaise,
      baseBeforeInvDiscPaise,
    };
  });

  const totalBaseBeforeInvDiscPaise = pass1.reduce(
    (sum, p) => sum + p.baseBeforeInvDiscPaise,
    0
  );

  // Invoice-level discount (applied proportionally across items before GST)
  const invDiscType: DiscountType =
    input.invoiceDiscountType === 'fixed' ? 'fixed' : 'percent';
  const rawInvDiscVal = Math.max(0, Number(input.invoiceDiscountValue) || 0);
  let invoiceDiscountPaise = 0;
  if (totalBaseBeforeInvDiscPaise > 0 && rawInvDiscVal > 0) {
    if (invDiscType === 'percent') {
      const pct = Math.min(100, rawInvDiscVal);
      invoiceDiscountPaise = Math.round((totalBaseBeforeInvDiscPaise * pct) / 100);
    } else {
      invoiceDiscountPaise = Math.min(
        totalBaseBeforeInvDiscPaise,
        toPaise(rawInvDiscVal)
      );
    }
  }

  let subtotalPaise = 0;
  let itemDiscountTotalPaise = 0;
  let taxableAmountPaise = 0;
  let cgstTotalPaise = 0;
  let sgstTotalPaise = 0;
  let igstTotalPaise = 0;
  let remainingInvDiscPaise = invoiceDiscountPaise;

  const computedItems: ComputedPurchaseLineItem[] = pass1.map((row, idx) => {
    const isLast = idx === pass1.length - 1;
    let rowInvDiscPaise = 0;
    if (invoiceDiscountPaise > 0 && totalBaseBeforeInvDiscPaise > 0) {
      if (isLast) {
        rowInvDiscPaise = Math.min(row.baseBeforeInvDiscPaise, remainingInvDiscPaise);
      } else {
        rowInvDiscPaise = Math.min(
          row.baseBeforeInvDiscPaise,
          Math.round(
            (invoiceDiscountPaise * row.baseBeforeInvDiscPaise) /
              totalBaseBeforeInvDiscPaise
          )
        );
        remainingInvDiscPaise = Math.max(0, remainingInvDiscPaise - rowInvDiscPaise);
      }
    }

    const itemTaxablePaise = Math.max(0, row.baseBeforeInvDiscPaise - rowInvDiscPaise);
    const itemTaxPaise =
      row.effectiveTaxRate > 0
        ? Math.round((itemTaxablePaise * row.effectiveTaxRate) / 100)
        : 0;

    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;

    if (itemTaxPaise > 0) {
      if (isInterState) {
        igstPaise = itemTaxPaise;
      } else {
        cgstPaise = Math.floor(itemTaxPaise / 2);
        sgstPaise = itemTaxPaise - cgstPaise;
      }
    }

    const itemTotalPaise = itemTaxablePaise + itemTaxPaise;

    subtotalPaise += row.lineBaseBeforeDiscountPaise;
    itemDiscountTotalPaise += row.itemDiscountPaise;
    taxableAmountPaise += itemTaxablePaise;
    cgstTotalPaise += cgstPaise;
    sgstTotalPaise += sgstPaise;
    igstTotalPaise += igstPaise;

    return {
      ...row.item,
      sortOrder: idx,
      quantity: row.qty,
      rate: fromPaise(row.ratePaise),
      discountValue: Number(row.item.discountValue) || 0,
      taxRate: row.effectiveTaxRate,
      grossAmount: fromPaise(row.lineBaseBeforeDiscountPaise),
      discountAmount: fromPaise(row.itemDiscountPaise),
      taxableAmount: fromPaise(itemTaxablePaise),
      cgstAmount: fromPaise(cgstPaise),
      sgstAmount: fromPaise(sgstPaise),
      igstAmount: fromPaise(igstPaise),
      taxAmount: fromPaise(itemTaxPaise),
      totalAmount: fromPaise(itemTotalPaise),
      ocrConfidence: row.item.ocrConfidence,
      ocrStatus: row.item.ocrStatus,
      ocrMessage: row.item.ocrMessage,
    };
  });

  const additionalChargesPaise = Math.max(0, toPaise(Number(input.additionalCharges) || 0));
  const totalTaxPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise;
  const totalDiscountPaise = itemDiscountTotalPaise + invoiceDiscountPaise;
  const preRoundGrandPaise = taxableAmountPaise + totalTaxPaise + additionalChargesPaise;

  let roundOffPaise = 0;
  let grandTotalPaise = preRoundGrandPaise;
  if (input.roundOffEnabled) {
    const roundedRupees = Math.round(preRoundGrandPaise / 100);
    grandTotalPaise = roundedRupees * 100;
    roundOffPaise = grandTotalPaise - preRoundGrandPaise;
  }

  const grandTotal = fromPaise(grandTotalPaise);

  return {
    items: computedItems,
    isGst: isGstApplicable,
    isInterState,
    taxRuleChecked,
    taxRuleLabel,
    taxRuleWarning,
    subtotal: fromPaise(subtotalPaise),
    itemDiscountTotal: fromPaise(itemDiscountTotalPaise),
    invoiceDiscountAmount: fromPaise(invoiceDiscountPaise),
    totalDiscount: fromPaise(totalDiscountPaise),
    taxableAmount: fromPaise(taxableAmountPaise),
    cgstTotal: fromPaise(cgstTotalPaise),
    sgstTotal: fromPaise(sgstTotalPaise),
    igstTotal: fromPaise(igstTotalPaise),
    totalTax: fromPaise(totalTaxPaise),
    additionalCharges: fromPaise(additionalChargesPaise),
    roundOff: fromPaise(roundOffPaise),
    grandTotal,
    amountInWords: amountInWordsINR(grandTotal),
  };
}

