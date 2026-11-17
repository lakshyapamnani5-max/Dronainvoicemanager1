import assert from 'node:assert/strict';
import { computeDocumentTotals } from '../src/shared/gstCalculator.ts';
import type { Quotation, QuotationTemplateId } from '../src/shared/types.ts';
import {
  QUOTATION_THEMES,
  normalizeQuotationTemplateId,
} from '../src/components/quotation/quotationThemeRegistry.tsx';
import {
  INVOICE_THEMES,
  normalizeTemplateId,
} from '../src/components/invoice/invoiceThemeRegistry.tsx';
import { buildQuotationPdfDocument } from '../src/components/quotation/quotationPdfGenerator.ts';

function makeQuotation(opts: {
  templateId: QuotationTemplateId;
  itemCount: number;
  isGst?: boolean;
  placeOfSupply?: string;
  discountValue?: number;
  showPaymentInstructions?: boolean;
  omitOptionalFields?: boolean;
}): Quotation {
  const items = Array.from({ length: opts.itemCount }, (_, idx) => ({
    id: `it_${idx + 1}`,
    name: `Deliverable Module ${idx + 1}: Cloud Platform & Analytics`,
    description: opts.omitOptionalFields
      ? ''
      : `Full-stack implementation, automated reconciliation, API integration, and SLA monitoring (Phase ${idx + 1}) with multi-line deployment specification.`,
    hsnSac: opts.isGst ? '998314' : '',
    quantity: idx % 3 === 0 ? 2 : 1,
    unit: idx % 2 === 0 ? 'Module' : 'Lot',
    rate: 12500 + idx * 500,
    discountType: 'percent' as const,
    discountValue: opts.discountValue ?? 0,
    taxRate: opts.isGst ? 18 : 0,
  }));

  const calc = computeDocumentTotals({
    items,
    businessState: 'Maharashtra',
    placeOfSupply: opts.placeOfSupply || 'Maharashtra',
    isGst: opts.isGst ?? true,
    taxMode: 'exclusive',
    taxSupplyMode: 'auto',
    roundOffEnabled: true,
  });

  return {
    id: `quo_test_${opts.templateId}_${opts.itemCount}`,
    userUid: 'usr_test_1',
    quotationNumber: 'QTN-2026-0042',
    status: 'sent',
    customerId: 'cust_1',
    customerSnapshot: {
      id: 'cust_1',
      name: opts.omitOptionalFields ? 'Rohan Mehta' : 'Rohan Deshmukh (VP Procurement & Engineering)',
      companyName: opts.omitOptionalFields
        ? ''
        : 'Sahyadri Heavy Engineering & Infrastructure Logistics Private Limited',
      email: opts.omitOptionalFields ? '' : 'procurement@sahyadriinfrastructure.in',
      phone: opts.omitOptionalFields ? '' : '+91 98200 55110',
      gstin: opts.isGst ? '27AADFS9021C1Z2' : '',
      billingAddress: opts.omitOptionalFields
        ? ''
        : 'Building 4B, Wing C, Hiranandani Knowledge Park, Powai, Mumbai, Maharashtra 400076, India',
      shippingAddress: '',
      state: opts.placeOfSupply || 'Maharashtra',
    },
    businessSnapshot: {
      businessName: 'Vanguard Technologies Pvt Ltd',
      ownerName: 'Arjun Deshmukh',
      logoDataUrl: '',
      address: '402, Pinnacle Corporate Park, BKC, Mumbai 400051',
      email: 'proposals@vanguardtech.in',
      phone: '+91 98201 44550',
      gstin: opts.isGst ? '27AABCV4321M1Z2' : '',
      pan: 'AABCV4321M',
      state: 'Maharashtra',
      bankName: 'HDFC Bank Secret Test Bank',
      accountNumber: '50200048192011',
      ifsc: 'HDFC0000142',
      upiId: 'vanguardsecret@hdfcbank',
      upiQrDataUrl: '',
      signatureLabel: 'Authorized Proposal Signatory',
      signatureDataUrl: '',
    },
    quotationDate: '2026-11-17',
    validUntil: '2026-12-17',
    referenceNumber: opts.omitOptionalFields ? '' : 'RFP-2026-884',
    placeOfSupply: opts.placeOfSupply || 'Maharashtra',
    isGst: opts.isGst ?? true,
    taxMode: 'exclusive',
    taxSupplyMode: 'auto',
    isInterState: calc.isInterState,
    roundOffEnabled: true,
    subtotal: calc.subtotal,
    totalDiscount: calc.totalDiscount,
    taxableAmount: calc.taxableAmount,
    cgstTotal: calc.cgstTotal,
    sgstTotal: calc.sgstTotal,
    igstTotal: calc.igstTotal,
    totalTax: calc.totalTax,
    roundOff: calc.roundOff,
    grandTotal: calc.grandTotal,
    amountInWords: calc.amountInWords,
    templateId: opts.templateId,
    quotationTitle: opts.omitOptionalFields ? undefined : 'COMMERCIAL QUOTATION',
    projectDescription: opts.omitOptionalFields
      ? undefined
      : 'Turnkey architecture modernization, cloud telemetry dashboard, and 12-month enterprise SLA.',
    deliveryTimeline: opts.omitOptionalFields ? undefined : '4 Weeks from Sign-Off',
    paymentTerms: opts.omitOptionalFields ? undefined : '40% Advance, 60% on Go-Live',
    preparedBy: opts.omitOptionalFields ? undefined : 'Arjun Deshmukh',
    showPaymentInstructions: opts.showPaymentInstructions ?? false,
    paymentInstructions: opts.showPaymentInstructions
      ? '40% mobilization advance payable via NEFT upon proposal acceptance.'
      : undefined,
    notes: opts.omitOptionalFields ? '' : 'Pricing assumes client staging environment access by Week 1.',
    terms: opts.omitOptionalFields
      ? ''
      : '1. Quote valid for 30 days.\n2. Scope changes billed via change request.',
    convertedInvoiceId: null,
    createdAt: '2026-11-17T10:00:00.000Z',
    updatedAt: '2026-11-17T10:00:00.000Z',
    items: calc.items.map((it, idx) => ({ ...it, id: `qit_${idx + 1}` })),
  };
}

function extractPdfAsciiText(pdf: { output: (type: 'arraybuffer') => ArrayBuffer }): string {
  const buf = Buffer.from(pdf.output('arraybuffer'));
  return buf.toString('latin1');
}

async function run() {
  // 1. Registry isolation verification
  assert.equal(INVOICE_THEMES.length, 9, 'All 9 existing invoice themes preserved');
  assert.equal(QUOTATION_THEMES.length, 6, 'All 6 quotation themes registered');

  for (const qt of QUOTATION_THEMES) {
    assert.equal(normalizeQuotationTemplateId(qt.id), qt.id);
    assert.equal(normalizeTemplateId(qt.id), 'gst_theme_1', 'Invoice normalizer rejects quotation themes');
  }
  for (const it of INVOICE_THEMES) {
    assert.equal(normalizeTemplateId(it.id), it.id);
    assert.equal(normalizeQuotationTemplateId(it.id), 'executive_gold', 'Quotation normalizer rejects invoice themes');
  }

  // 2. Test all 6 quotation themes with standard intra-state GST multi-item proposal
  for (const theme of QUOTATION_THEMES) {
    const q = makeQuotation({
      templateId: theme.id,
      itemCount: 5,
      isGst: true,
      discountValue: 5,
      showPaymentInstructions: false,
    });
    const { pdf, fileName, themeId } = await buildQuotationPdfDocument(q);
    assert.equal(themeId, theme.id);
    assert.equal(fileName, 'QTN-2026-0042.pdf');

    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    if (theme.id === 'landscape_pro') {
      assert.ok(pw > ph && Math.round(pw) === 297 && Math.round(ph) === 210, 'Landscape Pro must be 297x210 mm landscape');
    } else {
      assert.ok(ph > pw && Math.round(pw) === 210 && Math.round(ph) === 297, `${theme.id} must be 210x297 mm portrait`);
    }

    const rawPdf = extractPdfAsciiText(pdf);
    assert.ok(!rawPdf.includes('TAX INVOICE'), `${theme.id} must NOT contain TAX INVOICE`);
    assert.ok(!rawPdf.includes('BILL OF SUPPLY'), `${theme.id} must NOT contain BILL OF SUPPLY`);
    assert.ok(!rawPdf.includes('Scan to Pay'), `${theme.id} must NOT contain UPI Scan to Pay`);
    assert.ok(!rawPdf.includes('vanguardsecret@hdfcbank'), `${theme.id} must NOT leak auto UPI ID`);
    assert.ok(!rawPdf.includes('50200048192011'), `${theme.id} must NOT leak auto bank account number`);
    assert.ok(!rawPdf.includes('Amount Received'), `${theme.id} must NOT show Amount Received`);
    assert.ok(!rawPdf.includes('Balance Due'), `${theme.id} must NOT show Balance Due`);
    assert.ok(rawPdf.includes('QTN-2026-0042'), `${theme.id} must include quotation number`);
    assert.ok(rawPdf.includes('CLIENT ACCEPTANCE'), `${theme.id} must include Client Acceptance block`);
  }

  // 3. Test minimal/missing optional fields + non-GST + inter-state + 1 item
  for (const theme of QUOTATION_THEMES) {
    const qMinimal = makeQuotation({
      templateId: theme.id,
      itemCount: 1,
      isGst: false,
      omitOptionalFields: true,
      showPaymentInstructions: false,
    });
    const resMin = await buildQuotationPdfDocument(qMinimal);
    assert.equal(resMin.pdf.getNumberOfPages(), 1, `1-item minimal ${theme.id} fits on 1 page`);

    const qInter = makeQuotation({
      templateId: theme.id,
      itemCount: 2,
      isGst: true,
      placeOfSupply: 'Karnataka',
      showPaymentInstructions: true,
    });
    const resInter = await buildQuotationPdfDocument(qInter);
    const rawInter = extractPdfAsciiText(resInter.pdf);
    assert.ok(rawInter.includes('Estimated IGST'), `${theme.id} inter-state must label Estimated IGST`);
    assert.ok(
      rawInter.includes('PROPOSED PAYMENT INSTRUCTIONS'),
      `${theme.id} must show manual Proposed Payment Instructions only when enabled`
    );
    assert.ok(!rawInter.includes('vanguardsecret@hdfcbank'), 'Still never leaks business UPI ID');
  }

  // 4. Multi-page stress test (32 items with long descriptions) across Portrait & Landscape
  for (const themeId of ['executive_gold', 'modern_minimal', 'landscape_pro'] as QuotationTemplateId[]) {
    const qLong = makeQuotation({
      templateId: themeId,
      itemCount: 32,
      isGst: true,
      discountValue: 10,
    });
    const resLong = await buildQuotationPdfDocument(qLong);
    const pages = resLong.pdf.getNumberOfPages();
    assert.ok(pages >= 2, `32-item quotation (${themeId}) spans multiple pages (got ${pages})`);
    const lastPageContent = (resLong.pdf.internal as unknown as { pages: string[][] }).pages[pages].join('\n');
    assert.ok(
      lastPageContent.includes('CLIENT ACCEPTANCE') || lastPageContent.includes('Estimated Subtotal'),
      `Final page of ${themeId} must contain rendered summary/acceptance content (no trailing blank page)`
    );
  }

  console.log('ALL QUOTATION THEME & PDF VERIFICATION TESTS PASSED (6 themes, pagination, isolation, no invoice leakage)');
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

