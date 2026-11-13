import type {
  ComputedLineItem,
  LineItemInput,
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
