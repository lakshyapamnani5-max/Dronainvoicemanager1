import assert from 'node:assert';
import {
  classifyInvoice,
  compileGstr1Summary,
  generatePeriodOptions,
} from '../src/lib/gstnClassifier';
import { validateGstr1Data } from '../src/lib/gstnValidator';
import {
  generateGstr1JsonPayload,
  getGstr1ExportFilename,
} from '../src/lib/gstr1Generator';
import {
  getHsnSacDescription,
  mapUnitToUqc,
  validateHsnDigitRequirement,
} from '../src/lib/hsnSacService';
import type { Invoice, LineItemInput } from '../src/shared/types';
import type { GstReturnConfig } from '../src/shared/gstnTypes';

console.log('=== RUNNING GSTR-1 & HSN/SAC TEST SUITE ===');

// Helper to create mock invoice
function createMockInvoice(overrides: Partial<Invoice>): Invoice {
  const base: Invoice = {
    id: 'inv_' + Math.random().toString(36).substring(2, 9),
    userUid: 'usr_test_seller',
    invoiceNumber: 'INV-2026-0001',
    status: 'paid',
    customerId: 'cust_1',
    customerSnapshot: {
      id: 'cust_1',
      name: 'Rohan Sharma',
      companyName: 'Apex Technologies',
      email: 'rohan@apex.in',
      phone: '+91 98200 11223',
      gstin: '29AABCA7719M1Z9', // Karnataka
      billingAddress: 'MG Road, Bengaluru',
      shippingAddress: 'MG Road, Bengaluru',
      state: 'Karnataka',
    },
    businessSnapshot: {
      businessName: 'Vanguard Tech',
      ownerName: 'Arjun Mehta',
      logoDataUrl: '',
      address: 'Mumbai',
      email: 'billing@vanguard.in',
      phone: '+91 98200 00000',
      gstin: '27AABCV4321M1Z2', // Maharashtra
      pan: 'AABCV4321M',
      state: 'Maharashtra',
      bankName: 'HDFC',
      accountNumber: '1234567890',
      ifsc: 'HDFC0000240',
      upiId: 'vanguard@hdfc',
      upiQrDataUrl: '',
      signatureLabel: 'Auth Sig',
    },
    invoiceDate: '2026-04-15',
    dueDate: '2026-04-30',
    paymentTerms: 'Net 15',
    referenceNumber: 'PO-991',
    placeOfSupply: 'Karnataka',
    isGst: true,
    taxMode: 'exclusive',
    taxSupplyMode: 'auto',
    isInterState: true,
    roundOffEnabled: true,
    subtotal: 100000,
    totalDiscount: 0,
    taxableAmount: 100000,
    cgstTotal: 0,
    sgstTotal: 0,
    igstTotal: 18000,
    totalTax: 18000,
    roundOff: 0,
    grandTotal: 118000,
    amountPaid: 118000,
    balanceDue: 0,
    amountInWords: 'Rupees One Lakh Eighteen Thousand Only',
    templateId: 'classic_gst',
    notes: 'Thank you',
    terms: 'Standard terms',
    sourceQuotationId: null,
    cancellationReason: null,
    cancelledAt: null,
    finalizedAt: '2026-04-15T10:00:00.000Z',
    createdAt: '2026-04-15T10:00:00.000Z',
    updatedAt: '2026-04-15T10:00:00.000Z',
    items: [
      {
        sortOrder: 0,
        name: 'Cloud Consulting',
        description: 'Monthly cloud consulting retainer',
        hsnSac: '998314',
        quantity: 1,
        unit: 'Nos',
        rate: 100000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: 18,
        grossAmount: 100000,
        discountAmount: 0,
        taxableAmount: 100000,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 18000,
        taxAmount: 18000,
        totalAmount: 118000,
      },
    ],
  };

  return { ...base, ...overrides };
}

const sellerState = 'Maharashtra';
const config: GstReturnConfig = {
  gstin: '27AABCV4321M1Z2',
  financialYear: '2026-27',
  frequency: 'monthly',
  periodCode: '042026', // April 2026
  previousFyTurnover: 5000000,
  currentFyTurnover: 1200000,
};

// Test 1: B2B Inter-State
{
  const inv = createMockInvoice({
    invoiceNumber: 'INV-2026-0001',
    isInterState: true,
    placeOfSupply: 'Karnataka',
  });
  const tx = classifyInvoice(inv, sellerState);
  assert.strictEqual(tx.category, 'B2B', 'Should be classified as B2B');
  assert.strictEqual(tx.isInterState, true);
  assert.strictEqual(tx.igstAmount, 18000);
  assert.strictEqual(tx.cgstAmount, 0);
  console.log('✓ Test 1 Passed: B2B Inter-state classification');
}

// Test 2: B2B Intra-State
{
  const inv = createMockInvoice({
    invoiceNumber: 'INV-2026-0002',
    isInterState: false,
    placeOfSupply: 'Maharashtra',
    customerSnapshot: {
      id: 'cust_2',
      name: 'Sahyadri Logistics',
      companyName: 'Sahyadri Logistics LLP',
      email: 'accounts@sahyadri.in',
      phone: '+91 98200 33445',
      gstin: '27AADFS9021C1Z2', // Maharashtra
      billingAddress: 'Navi Mumbai',
      shippingAddress: 'Navi Mumbai',
      state: 'Maharashtra',
    },
    cgstTotal: 9000,
    sgstTotal: 9000,
    igstTotal: 0,
    items: [
      {
        sortOrder: 0,
        name: 'Warehouse Operations',
        description: 'Logistics',
        hsnSac: '998313',
        quantity: 1,
        unit: 'Month',
        rate: 100000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: 18,
        grossAmount: 100000,
        discountAmount: 0,
        taxableAmount: 100000,
        cgstAmount: 9000,
        sgstAmount: 9000,
        igstAmount: 0,
        taxAmount: 18000,
        totalAmount: 118000,
      },
    ],
  });
  const tx = classifyInvoice(inv, sellerState);
  assert.strictEqual(tx.category, 'B2B');
  assert.strictEqual(tx.isInterState, false);
  assert.strictEqual(tx.cgstAmount, 9000);
  assert.strictEqual(tx.sgstAmount, 9000);
  console.log('✓ Test 2 Passed: B2B Intra-state classification');
}

// Test 3: B2C Intra-State (B2CS)
{
  const inv = createMockInvoice({
    invoiceNumber: 'INV-2026-0003',
    isInterState: false,
    placeOfSupply: 'Maharashtra',
    customerSnapshot: {
      id: 'c_consumer',
      name: 'Sunil Patil',
      companyName: '',
      email: 'sunil@gmail.com',
      phone: '+91 98200 44556',
      gstin: '', // Unregistered
      billingAddress: 'Pune',
      shippingAddress: 'Pune',
      state: 'Maharashtra',
    },
    taxableAmount: 40000,
    grandTotal: 47200,
  });
  const tx = classifyInvoice(inv, sellerState);
  assert.strictEqual(tx.category, 'B2CS', 'Intra-state unregistered should be B2CS');
  console.log('✓ Test 3 Passed: B2C Intra-state classified as B2CS');
}

// Test 4: B2C Inter-State > 2.5 Lakhs (B2CL)
{
  const inv = createMockInvoice({
    invoiceNumber: 'INV-2026-0004',
    isInterState: true,
    placeOfSupply: 'Gujarat',
    customerSnapshot: {
      id: 'c_large_unreg',
      name: 'Amit Patel',
      companyName: '',
      email: 'amit@patel.com',
      phone: '+91 98250 11223',
      gstin: '', // Unregistered
      billingAddress: 'Ahmedabad',
      shippingAddress: 'Ahmedabad',
      state: 'Gujarat',
    },
    subtotal: 250000,
    taxableAmount: 250000,
    igstTotal: 45000,
    totalTax: 45000,
    grandTotal: 295000, // > 2.5 Lakhs
  });
  const tx = classifyInvoice(inv, sellerState);
  assert.strictEqual(tx.category, 'B2CL', 'Inter-state unregistered > 2.5L should be B2CL (Table 5)');
  assert.strictEqual(tx.posCode, '24', 'Gujarat POS code should be 24');
  console.log('✓ Test 4 Passed: B2C Inter-state > 2.5L classified as B2CL');
}

// Test 5: B2C Inter-State <= 2.5 Lakhs (B2CS)
{
  const inv = createMockInvoice({
    invoiceNumber: 'INV-2026-0005',
    isInterState: true,
    placeOfSupply: 'Delhi',
    customerSnapshot: {
      id: 'c_small_inter',
      name: 'Pooja Verma',
      companyName: '',
      email: 'pooja@verma.com',
      phone: '+91 98110 11223',
      gstin: '', // Unregistered
      billingAddress: 'New Delhi',
      shippingAddress: 'New Delhi',
      state: 'Delhi',
    },
    subtotal: 50000,
    taxableAmount: 50000,
    igstTotal: 9000,
    totalTax: 9000,
    grandTotal: 59000, // <= 2.5 Lakhs
  });
  const tx = classifyInvoice(inv, sellerState);
  assert.strictEqual(tx.category, 'B2CS', 'Inter-state unregistered <= 2.5L should be B2CS (Table 7)');
  assert.strictEqual(tx.posCode, '07', 'Delhi POS code should be 07');
  console.log('✓ Test 5 Passed: B2C Inter-state <= 2.5L classified as B2CS');
}

// Test 6: Multi-rate Invoice (5%, 12%, 18%)
{
  const inv = createMockInvoice({
    invoiceNumber: 'INV-2026-0006',
    items: [
      {
        sortOrder: 0,
        name: 'Item A',
        description: 'Goods 5%',
        hsnSac: '080111',
        quantity: 10,
        unit: 'KGS',
        rate: 1000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: 5,
        grossAmount: 10000,
        discountAmount: 0,
        taxableAmount: 10000,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 500,
        taxAmount: 500,
        totalAmount: 10500,
      },
      {
        sortOrder: 1,
        name: 'Item B',
        description: 'Goods 12%',
        hsnSac: '190531',
        quantity: 5,
        unit: 'BOX',
        rate: 4000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: 12,
        grossAmount: 20000,
        discountAmount: 0,
        taxableAmount: 20000,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 2400,
        taxAmount: 2400,
        totalAmount: 22400,
      },
      {
        sortOrder: 2,
        name: 'Item C',
        description: 'Services 18%',
        hsnSac: '998314',
        quantity: 1,
        unit: 'Nos',
        rate: 50000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: 18,
        grossAmount: 50000,
        discountAmount: 0,
        taxableAmount: 50000,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 9000,
        taxAmount: 9000,
        totalAmount: 59000,
      },
    ],
    taxableAmount: 80000,
    igstTotal: 11900,
    totalTax: 11900,
    grandTotal: 91900,
  });
  const tx = classifyInvoice(inv, sellerState);
  assert.strictEqual(tx.items.length, 3, 'Should have 3 distinct rate groups');
  assert.strictEqual(tx.totalTax, 11900);
  console.log('✓ Test 6 Passed: Multi-rate invoice correctly broken down');
}

// Test 7: Credit Note (CDNR)
{
  const inv = createMockInvoice({
    invoiceNumber: 'CRN-2026-0001',
    referenceNumber: 'Original Inv: INV-2026-0001',
    customerSnapshot: {
      id: 'cust_1',
      name: 'Rohan Sharma',
      companyName: 'Apex Tech',
      email: 'r@a.com',
      phone: '9820011223',
      gstin: '29AABCA7719M1Z9',
      billingAddress: 'Bengaluru',
      shippingAddress: 'Bengaluru',
      state: 'Karnataka',
    },
    subtotal: 10000,
    taxableAmount: 10000,
    igstTotal: 1800,
    totalTax: 1800,
    grandTotal: 11800,
  });
  const tx = classifyInvoice(inv, sellerState);
  assert.strictEqual(tx.category, 'CDNR', 'Credit Note with GSTIN should be CDNR');
  assert.strictEqual(tx.subType, 'C');
  console.log('✓ Test 7 Passed: Credit Note classified as CDNR');
}

// Test 8: Export Invoices
{
  const inv = createMockInvoice({
    invoiceNumber: 'EXP-2026-0001',
    placeOfSupply: 'Other Territory',
    customerSnapshot: {
      id: 'c_export',
      name: 'Global Corp Inc',
      companyName: 'Global Corp Inc',
      email: 'ap@globalcorp.com',
      phone: '+1 415 555 2671',
      gstin: '',
      billingAddress: 'San Francisco, CA, USA',
      shippingAddress: 'San Francisco, CA, USA',
      state: 'Outside India',
    },
    subtotal: 200000,
    taxableAmount: 200000,
    igstTotal: 36000,
    totalTax: 36000,
    grandTotal: 236000,
  });
  const tx = classifyInvoice(inv, sellerState);
  assert.strictEqual(tx.category, 'EXP', 'Overseas export should be EXP');
  assert.strictEqual(tx.subType, 'WPAY', 'Tax paying export should be WPAY');
  assert.strictEqual(tx.posCode, '96', 'Export POS should be 96');
  console.log('✓ Test 8 Passed: Export with payment of tax classified as EXP/WPAY');
}

// Test 9: Cancelled Invoices Exclusion
{
  const activeInv = createMockInvoice({
    invoiceNumber: 'INV-2026-0010',
    status: 'paid',
    taxableAmount: 100000,
    totalTax: 18000,
    grandTotal: 118000,
  });
  const cancInv = createMockInvoice({
    invoiceNumber: 'INV-2026-0011',
    status: 'cancelled',
    cancellationReason: 'Order cancelled by customer',
    taxableAmount: 50000,
    totalTax: 9000,
    grandTotal: 59000,
  });

  const testSummary = compileGstr1Summary([activeInv, cancInv], config, sellerState, 'Vanguard');
  assert.strictEqual(testSummary.activeInvoicesCount, 1, 'Only 1 active invoice should be counted');
  assert.strictEqual(testSummary.cancelledInvoicesCount, 1, '1 cancelled invoice should be tracked');
  assert.strictEqual(testSummary.totalTaxableValue, 100000, 'Taxable value must exclude cancelled invoice');
  
  // Verify Table 13 DOCS tracks the cancelled invoice
  const outwardDocCat = testSummary.docSummary.find((d) => d.doc_num === 1);
  assert(outwardDocCat, 'Document category 1 should exist');
  assert.strictEqual(outwardDocCat.docs[0].canc, 1, 'Cancelled count in Table 13 must be 1');
  assert.strictEqual(outwardDocCat.docs[0].totnum, 2, 'Total number in Table 13 must be 2');
  assert.strictEqual(outwardDocCat.docs[0].net_issue, 1, 'Net issued in Table 13 must be 1');
  console.log('✓ Test 9 Passed: Cancelled invoices excluded from taxable totals but tracked in DOCS');
}

// Test 10: Partial Payments do NOT reduce reported invoice taxable value
{
  const partialInv = createMockInvoice({
    invoiceNumber: 'INV-2026-0012',
    status: 'partially_paid',
    taxableAmount: 100000,
    totalTax: 18000,
    grandTotal: 118000,
    amountPaid: 30000, // Only 30k paid
    balanceDue: 88000,
  });

  const testSummary = compileGstr1Summary([partialInv], config, sellerState, 'Vanguard');
  assert.strictEqual(
    testSummary.totalTaxableValue,
    100000,
    'Taxable value must reflect full invoice value regardless of partial payment'
  );
  assert.strictEqual(
    testSummary.totalTax,
    18000,
    'Tax must reflect full invoice tax regardless of partial payment'
  );
  console.log('✓ Test 10 Passed: Partial payment does not alter GSTR-1 reported value');
}

// Test 11: Validation Engine catches Missing GSTIN, Bad HSN, Duplicates
{
  const badInvoices: Invoice[] = [
    createMockInvoice({
      invoiceNumber: 'INV-2026-0020',
      customerSnapshot: {
        id: 'c1',
        name: 'ABC',
        companyName: 'ABC Corp',
        email: 'a@a.com',
        phone: '123',
        gstin: '29INVALIDGSTINXX', // Invalid checksum / format
        billingAddress: 'KA',
        shippingAddress: 'KA',
        state: 'Karnataka',
      },
      items: [
        {
          sortOrder: 0,
          name: 'Item',
          description: '',
          hsnSac: '', // Missing HSN
          quantity: 1,
          unit: 'Nos',
          rate: 10000,
          discountType: 'percent',
          discountValue: 0,
          taxRate: 18,
          grossAmount: 10000,
          discountAmount: 0,
          taxableAmount: 10000,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 1800,
          taxAmount: 1800,
          totalAmount: 11800,
        },
      ],
    }),
    createMockInvoice({
      invoiceNumber: 'INV-2026-0020', // Duplicate number!
      customerSnapshot: {
        id: 'c2',
        name: 'DEF',
        companyName: 'DEF Corp',
        email: 'd@d.com',
        phone: '123',
        gstin: '29AABCA7719M1Z9',
        billingAddress: 'KA',
        shippingAddress: 'KA',
        state: 'Karnataka',
      },
    }),
  ];

  const report = validateGstr1Data(badInvoices, config, sellerState);
  assert.strictEqual(report.isValid, false);
  assert.strictEqual(report.canExport, false, 'Blocking errors must disable export');
  
  const codes = report.issues.map((i) => i.code);
  assert(codes.includes('ERR_CUSTOMER_GSTIN_FORMAT') || codes.includes('WARN_CUSTOMER_GSTIN_CHECKSUM'), 'Should catch bad GSTIN');
  assert(codes.includes('ERR_HSN_MISSING'), 'Should catch missing HSN code');
  assert(codes.includes('ERR_DUPLICATE_INVOICE_NUM'), 'Should catch duplicate invoice number');
  console.log('✓ Test 11 Passed: Validation engine successfully caught invalid GSTIN, missing HSN, duplicate invoice number');
}

// Test 12: HSN/SAC Unit to UQC Mapping & Digit Validation
{
  assert.strictEqual(mapUnitToUqc('Nos'), 'NOS');
  assert.strictEqual(mapUnitToUqc('pieces'), 'PCS');
  assert.strictEqual(mapUnitToUqc('kilograms'), 'KGS');
  assert.strictEqual(mapUnitToUqc('Meters'), 'MTR');
  assert.strictEqual(mapUnitToUqc('custom_xyz'), 'OTH');

  const check4 = validateHsnDigitRequirement('0101', false);
  assert.strictEqual(check4.valid, true, '4 digits is valid for turnover <= 5 Cr');

  const check2 = validateHsnDigitRequirement('01', false);
  assert.strictEqual(check2.valid, false, '2 digits is invalid for item level reporting');

  console.log('✓ Test 12 Passed: UQC mapping and HSN digit validation');
}

// Test 13: GSTR-1 JSON Payload Generation & Official Schema Structure
{
  const inv1 = createMockInvoice({
    invoiceNumber: 'INV-2026-0001',
    isInterState: true,
  });
  const inv2 = createMockInvoice({
    invoiceNumber: 'INV-2026-0002',
    isInterState: false,
    customerSnapshot: {
      id: 'c_local',
      name: 'Local Client',
      companyName: 'Local Ltd',
      email: 'l@l.com',
      phone: '1234567890',
      gstin: '27AABCV4812N1Z5',
      billingAddress: 'Mumbai',
      shippingAddress: 'Mumbai',
      state: 'Maharashtra',
    },
    cgstTotal: 9000,
    sgstTotal: 9000,
    igstTotal: 0,
    items: [
      {
        sortOrder: 0,
        name: 'Services',
        description: 'Software development',
        hsnSac: '998314',
        quantity: 1,
        unit: 'Nos',
        rate: 100000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: 18,
        grossAmount: 100000,
        discountAmount: 0,
        taxableAmount: 100000,
        cgstAmount: 9000,
        sgstAmount: 9000,
        igstAmount: 0,
        taxAmount: 18000,
        totalAmount: 118000,
      },
    ],
  });

  const summaryResult = compileGstr1Summary([inv1, inv2], config, sellerState, 'Vanguard Tech');
  const payload = generateGstr1JsonPayload(summaryResult, [inv1, inv2], config);

  // Validate exact root properties required by GSTN
  assert.strictEqual(payload.gstin, config.gstin);
  assert.strictEqual(payload.fp, '042026');
  assert.strictEqual(payload.version, 'GSTR1_V1.1');
  assert.strictEqual(payload.hash, 'hash');
  assert(Array.isArray(payload.b2b), 'b2b array must exist');
  assert.strictEqual(payload.b2b?.length, 2, '2 B2B recipient groups');

  // Verify HSN Table 12
  assert(payload.hsn?.data, 'hsn data must exist');
  assert.strictEqual(payload.hsn.data[0].hsn_sc, '998314');
  assert.strictEqual(payload.hsn.data[0].uqc, 'NOS');
  assert.strictEqual(payload.hsn.data[0].txval, 200000);

  // Verify DOCS Table 13
  assert(payload.doc_issue?.doc_det, 'doc_issue must exist');
  assert.strictEqual(payload.doc_issue.doc_det[0].docs[0].totnum, 2);

  const filename = getGstr1ExportFilename(payload.gstin, payload.fp);
  assert.strictEqual(filename, '27AABCV4321M1Z2_GSTR1_042026.json');

  console.log('✓ Test 13 Passed: Official GSTN JSON Schema generation verified');
}

console.log('\n========================================');
console.log('ALL 13 GSTR-1 & HSN/SAC TESTS PASSED!');
console.log('========================================\n');
