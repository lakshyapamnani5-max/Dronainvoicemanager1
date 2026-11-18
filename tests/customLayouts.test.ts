import { evaluateFormula, validateFormula, extractFormulaDependencies } from '../src/lib/formulaEngine';
import { BUILT_IN_LAYOUT_PRESETS, PRESET_DOOR_FURNITURE_SUPPLIER } from '../src/lib/customLayoutPresets';
import { computeDocumentTotals } from '../src/shared/gstCalculator';
import type { LineItemInput } from '../src/shared/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

console.log('=== RUNNING CUSTOM INVOICE LAYOUTS & FORMULA ENGINE TEST SUITE ===\n');

// 1. Formula Engine Tokenization & Evaluation
console.log('Test 1: Safe Formula Evaluation');
{
  const values = {
    length: 12,
    width: 32,
    height: 10,
    rate_sq_ft: 39,
    qty: 24,
    discount_pct: 10,
    zero_val: 0,
  };

  // Shiv Hari Doors area-based calculation: Total Sq. Ft. * Rate/Sq. Ft.
  const sqFt = 384;
  const rate = 39;
  const resultShivHari = evaluateFormula('total_sq_ft * rate_sq_ft', { total_sq_ft: sqFt, rate_sq_ft: rate }, 2);
  assert(resultShivHari === 14976, `Expected 14976 but got ${resultShivHari}`);
  console.log('  ✓ Shiv Hari Doors formula (384 * 39) = 14976 evaluated successfully');

  // Multi-variable arithmetic with parentheses
  const areaCalc = evaluateFormula('length * width', values, 2);
  assert(areaCalc === 384, `Expected 384 but got ${areaCalc}`);
  console.log('  ✓ Area formula (12 * 32) = 384');

  const volumeCalc = evaluateFormula('length * width * height', values, 2);
  assert(volumeCalc === 3840, `Expected 3840 but got ${volumeCalc}`);
  console.log('  ✓ Volume formula (12 * 32 * 10) = 3840');

  const complexCalc = evaluateFormula('(length + width) * 2', values, 2);
  assert(complexCalc === 88, `Expected 88 but got ${complexCalc}`);
  console.log('  ✓ Perimeter formula (12 + 32) * 2 = 88');

  // Division by zero safety
  const divByZero = evaluateFormula('length / zero_val', values, 2);
  assert(divByZero === 0, `Expected 0 on division by zero but got ${divByZero}`);
  console.log('  ✓ Division by zero safely returns 0');

  // Missing variable fallback to 0
  const missingVar = evaluateFormula('length * non_existent_key', values, 2);
  assert(missingVar === 0, `Expected 0 on missing variable but got ${missingVar}`);
  console.log('  ✓ Missing variable safely evaluated as 0');
}

// 2. Formula Validation
console.log('\nTest 2: Formula Validation');
{
  const numericKeys = ['length', 'width', 'height', 'rate', 'qty', 'weight'];

  const valid1 = validateFormula('length * width', numericKeys);
  assert(valid1.isValid, `Expected valid formula, got: ${valid1.error}`);
  console.log('  ✓ Valid formula accepted');

  const valid2 = validateFormula('(length + width) * 2', numericKeys);
  assert(valid2.isValid, `Expected valid formula with parentheses, got: ${valid2.error}`);
  console.log('  ✓ Valid formula with parentheses accepted');

  const invalidParen = validateFormula('(length * width', numericKeys);
  assert(!invalidParen.isValid, 'Mismatched parentheses should be invalid');
  console.log('  ✓ Mismatched parentheses rejected');

  const unknownCol = validateFormula('length * unknown_col', numericKeys);
  assert(!unknownCol.isValid, 'Unknown column should be rejected');
  console.log('  ✓ Unknown column identifier rejected');

  const emptyFormula = validateFormula('', numericKeys);
  assert(!emptyFormula.isValid, 'Empty formula should be rejected');
  console.log('  ✓ Empty formula rejected');
}

// 3. Formula Dependency Extraction
console.log('\nTest 3: Dependency Extraction');
{
  const deps = extractFormulaDependencies('total_sq_ft * rate_sq_ft + surcharge');
  assert(deps.includes('total_sq_ft'), 'Should include total_sq_ft');
  assert(deps.includes('rate_sq_ft'), 'Should include rate_sq_ft');
  assert(deps.includes('surcharge'), 'Should include surcharge');
  assert(deps.length === 3, `Expected 3 dependencies, got ${deps.length}`);
  console.log('  ✓ Formula dependencies extracted:', deps);
}

// 4. Built-in Presets Verification
console.log('\nTest 4: Built-in Layout Presets');
{
  assert(BUILT_IN_LAYOUT_PRESETS.length >= 5, `Expected at least 5 built-in presets, got ${BUILT_IN_LAYOUT_PRESETS.length}`);
  
  // Verify Door & Furniture Supplier preset
  const doorPreset = PRESET_DOOR_FURNITURE_SUPPLIER;
  assert(doorPreset.name === 'Door & Furniture Supplier', `Preset name mismatch: ${doorPreset.name}`);
  assert(doorPreset.columns.length === 7, `Expected 7 columns in Shiv Hari Doors preset, got ${doorPreset.columns.length}`);

  const colKeys = doorPreset.columns.map(c => c.key);
  assert(colKeys.includes('qty'), 'Missing qty column');
  assert(colKeys.includes('particulars'), 'Missing particulars column');
  assert(colKeys.includes('hsn_acs'), 'Missing hsn_acs column');
  assert(colKeys.includes('total_sq_ft'), 'Missing total_sq_ft column');
  assert(colKeys.includes('thickness'), 'Missing thickness column');
  assert(colKeys.includes('rate_sq_ft'), 'Missing rate_sq_ft column');
  assert(colKeys.includes('amount'), 'Missing amount column');
  console.log('  ✓ Door & Furniture Supplier (Shiv Hari Doors reference) preset columns verified');

  const amountCol = doorPreset.columns.find(c => c.key === 'amount')!;
  assert(amountCol.dataType === 'formula', 'Amount column should be formula type');
  assert(amountCol.formula === 'total_sq_ft * rate_sq_ft', `Unexpected formula: ${amountCol.formula}`);
  console.log('  ✓ Shiv Hari Doors amount formula verified');
}

// 5. GST Isolation with Custom Layout Line Items
console.log('\nTest 5: GST Engine Isolation with Custom Columns');
{
  // Shiv Hari Doors scenario:
  // Item: Commercial Plywood, Qty: 24, Sq Ft: 384, Thickness: 12mm, Rate/Sq. Ft.: 39
  // Amount = 384 * 39 = 14,976
  // Line item rate = 14,976 / 24 = 624
  const lineItem: LineItemInput = {
    name: 'Commercial Plywood',
    description: '12mm thickness',
    hsnSac: '4412',
    quantity: 24,
    unit: 'Nos',
    rate: 624, // 24 * 624 = 14,976
    discountType: 'percent',
    discountValue: 0,
    taxRate: 18,
    customFields: {
      qty: 24,
      particulars: 'Commercial Plywood',
      hsn_acs: '4412',
      total_sq_ft: 384,
      thickness: '12mm',
      rate_sq_ft: 39,
      amount: 14976,
    },
  };

  const totalsIntra = computeDocumentTotals({
    items: [lineItem],
    businessState: 'Maharashtra',
    placeOfSupply: 'Maharashtra',
    isGst: true,
    taxMode: 'exclusive',
    taxSupplyMode: 'intra',
    roundOffEnabled: true,
  });

  assert(totalsIntra.taxableAmount === 14976, `Expected taxable 14976, got ${totalsIntra.taxableAmount}`);
  assert(totalsIntra.cgstTotal === 1347.84, `Expected CGST 1347.84, got ${totalsIntra.cgstTotal}`);
  assert(totalsIntra.sgstTotal === 1347.84, `Expected SGST 1347.84, got ${totalsIntra.sgstTotal}`);
  assert(totalsIntra.igstTotal === 0, `Expected IGST 0, got ${totalsIntra.igstTotal}`);
  assert(totalsIntra.grandTotal === 17672, `Expected rounded total 17672, got ${totalsIntra.grandTotal}`);
  console.log('  ✓ Intrastate CGST & SGST calculated accurately on custom formula amount (14,976 + 2,695.68 = 17,671.68 -> 17,672)');

  // Interstate IGST
  const totalsInter = computeDocumentTotals({
    items: [lineItem],
    businessState: 'Maharashtra',
    placeOfSupply: 'Gujarat',
    isGst: true,
    taxMode: 'exclusive',
    taxSupplyMode: 'auto',
    roundOffEnabled: true,
  });

  assert(totalsInter.igstTotal === 2695.68, `Expected IGST 2695.68, got ${totalsInter.igstTotal}`);
  assert(totalsInter.cgstTotal === 0, `Expected CGST 0, got ${totalsInter.cgstTotal}`);
  assert(totalsInter.sgstTotal === 0, `Expected SGST 0, got ${totalsInter.sgstTotal}`);
  console.log('  ✓ Interstate IGST calculated accurately on custom formula amount (IGST: 2695.68)');

  // Verify customFields passed through in calc items
  assert(totalsInter.items[0].customFields?.total_sq_ft === 384, 'customFields must be preserved on computed items');
  console.log('  ✓ customFields preserved on computed line items');
}

console.log('\n========================================');
console.log('ALL CUSTOM LAYOUT & FORMULA TESTS PASSED!');
console.log('========================================');
