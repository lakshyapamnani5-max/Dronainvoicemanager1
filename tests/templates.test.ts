import { INVOICE_THEMES, getThemeById, normalizeTemplateId } from '../src/components/invoice/invoiceThemeRegistry';
import type { StandardTemplateId } from '../src/components/invoice/invoiceThemeTypes';
import { generateDocumentPdf } from '../src/lib/pdfGenerator';
import type { Invoice, Quotation } from '../src/shared/types';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== RUNNING INVOICE TEMPLATES & THEME SELECTION TEST SUITE ===\n');

// Test 1: Registry Completeness
console.log('Test 1: Verifying all 9 themes in registry');
const expectedThemeIds: StandardTemplateId[] = [
  'gst_theme_1',
  'gst_theme_2',
  'gst_theme_3',
  'gst_theme_4',
  'gst_theme_5',
  'gst_theme_6',
  'double_divine',
  'french_elite',
  'landscape_theme_2',
];

assert(INVOICE_THEMES.length === 9, `Expected 9 themes, got ${INVOICE_THEMES.length}`);
for (const id of expectedThemeIds) {
  const theme = INVOICE_THEMES.find((t) => t.id === id);
  assert(Boolean(theme), `Missing theme: ${id}`);
  assert(typeof theme?.name === 'string' && theme.name.length > 0, `Theme ${id} missing name`);
  assert(typeof theme?.component === 'function', `Theme ${id} missing component`);
  assert(typeof theme?.thumbnail === 'function', `Theme ${id} missing thumbnail`);
}
console.log('✓ Test 1 Passed: All 9 themes verified in registry');

// Test 2: Orientation Verification
console.log('\nTest 2: Verifying orientations');
for (const theme of INVOICE_THEMES) {
  if (theme.id === 'landscape_theme_2') {
    assert(theme.orientation === 'landscape', 'Landscape Theme 2 must have landscape orientation');
  } else {
    assert(theme.orientation === 'portrait', `${theme.name} must have portrait orientation`);
  }
}
console.log('✓ Test 2 Passed: Landscape Theme 2 is landscape, others are portrait');

// Test 3: Normalization of legacy IDs
console.log('\nTest 3: Legacy template ID normalization');
assert(normalizeTemplateId('classic_gst') === 'gst_theme_1', 'classic_gst -> gst_theme_1');
assert(normalizeTemplateId('executive_minimal') === 'french_elite', 'executive_minimal -> french_elite');
assert(normalizeTemplateId('compact_commercial') === 'gst_theme_6', 'compact_commercial -> gst_theme_6');
assert(normalizeTemplateId(null) === 'gst_theme_1', 'null -> gst_theme_1');
assert(normalizeTemplateId('double_divine') === 'double_divine', 'double_divine preserved');
console.log('✓ Test 3 Passed: Legacy template IDs normalized correctly');

// Test 4: Sample Data Resilience (Multi-Rate, Long Description, Discounts)
console.log('\nTest 4: PDF generation across all 9 templates');
const mockInvoice: Invoice = {
  id: 'inv_test_101',
  userUid: 'tenant_1',
  invoiceNumber: 'INV-2026-0042',
  status: 'partially_paid',
  customerId: 'cust_1',
  customerSnapshot: {
    id: 'cust_1',
    name: 'Om Chaturvedi',
    companyName: 'Chaturvedi Industrial Supplies Pvt Ltd',
    email: 'om@chaturvedi-industries.com',
    phone: '+91 98200 12345',
    gstin: '27AABCC1234D1Z1',
    billingAddress: 'Survey No. 45, Phase 2, Hinjewadi IT Park, Pune, Maharashtra 411057',
    shippingAddress: 'Plot 10, MIDC Chakan, Pune, Maharashtra 410501',
    state: 'Maharashtra',
  },
  businessSnapshot: {
    businessName: 'Pamnani Logistics & Cloud Solutions',
    ownerName: 'Lakshya Pamnani',
    logoDataUrl: '',
    address: 'Commercial Tower A, 4th Floor, Vashi, Navi Mumbai - 400703',
    email: 'billing@pamnanisolutions.in',
    phone: '+91 76203 66930',
    gstin: '27AAECP1234M1Z5',
    pan: 'AAECP1234M',
    state: 'Maharashtra',
    bankName: 'HDFC Bank Ltd',
    accountNumber: '50200012345678',
    ifsc: 'HDFC0000123',
    upiId: '7620366930@hdfcbank',
    upiQrDataUrl: '',
    signatureLabel: 'Authorized Signatory',
    signatureDataUrl: '',
  },
  invoiceDate: '2026-11-17',
  dueDate: '2026-12-02',
  paymentTerms: 'Net 15 Days',
  referenceNumber: 'PO-IND-2026-99',
  placeOfSupply: 'Maharashtra',
  isGst: true,
  taxMode: 'exclusive',
  taxSupplyMode: 'auto',
  isInterState: false,
  roundOffEnabled: true,
  subtotal: 70000,
  totalDiscount: 2000,
  taxableAmount: 68000,
  cgstTotal: 6120,
  sgstTotal: 6120,
  igstTotal: 0,
  totalTax: 12240,
  roundOff: 0,
  grandTotal: 80240,
  amountPaid: 20000,
  balanceDue: 60240,
  amountInWords: 'Rupees Eighty Thousand Two Hundred Forty Only',
  templateId: 'gst_theme_1',
  notes: 'Goods once sold cannot be returned after 7 days.',
  terms: '1. Payment due within 15 days.\n2. Interest @ 18% p.a. on overdue bills.',
  sourceQuotationId: null,
  cancellationReason: null,
  cancelledAt: null,
  finalizedAt: '2026-11-17T10:00:00Z',
  createdAt: '2026-11-17T10:00:00Z',
  updatedAt: '2026-11-17T10:00:00Z',
  items: [
    {
      sortOrder: 0,
      name: 'Industrial Drone Sensor Integration',
      description: 'Precision GPS, RTK module & LiDAR obstacle sensor kit for industrial inspection UAVs with high altitude calibrations.',
      hsnSac: '880621',
      quantity: 2,
      unit: 'Units',
      rate: 30000,
      discountType: 'fixed',
      discountValue: 2000,
      taxRate: 18,
      grossAmount: 60000,
      discountAmount: 2000,
      taxableAmount: 58000,
      cgstAmount: 5220,
      sgstAmount: 5220,
      igstAmount: 0,
      taxAmount: 10440,
      totalAmount: 68440,
    },
    {
      sortOrder: 1,
      name: 'Firmware Calibration & Maintenance SLA',
      description: 'Annual remote telemetry logging and safety patch SLA',
      hsnSac: '998314',
      quantity: 1,
      unit: 'Service',
      rate: 10000,
      discountType: 'percent',
      discountValue: 0,
      taxRate: 18,
      grossAmount: 10000,
      discountAmount: 0,
      taxableAmount: 10000,
      cgstAmount: 900,
      sgstAmount: 900,
      igstAmount: 0,
      taxAmount: 1800,
      totalAmount: 11800,
    },
  ],
};

async function testPdfGeneration() {
  for (const themeId of expectedThemeIds) {
    // Generate PDF with overridden template
    await generateDocumentPdf('invoice', mockInvoice, themeId);
    console.log(`  ✓ Generated PDF cleanly for ${themeId}`);
  }
}

testPdfGeneration().then(() => {
  console.log('✓ Test 4 Passed: All 9 templates generated PDFs cleanly without runtime errors');
  console.log('\n========================================');
  console.log('ALL INVOICE THEME TESTS PASSED!');
  console.log('========================================');
}).catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
