/**
 * GSTN GSTR-1 Validation Engine for DronaInvoice
 * Audits all transaction data before enabling JSON download.
 * Identifies blocking ERRORS and advisory WARNINGS with actionable links.
 */

import {
  GSTIN_REGEX,
  getStateCode,
  isValidGstin,
  isValidGstinChecksum,
} from '../shared/indianStates';
import type { Invoice } from '../shared/types';
import {
  type GstPeriodOption,
  type GstReturnConfig,
  type GstValidationIssue,
  type GstValidationReport,
} from '../shared/gstnTypes';
import {
  classifyInvoice,
  detectCreditDebitNote,
  generatePeriodOptions,
  normalizePlaceOfSupplyCode,
} from './gstnClassifier';

export function validateGstr1Data(
  invoices: Invoice[],
  config: GstReturnConfig,
  sellerState: string
): GstValidationReport {
  const issues: GstValidationIssue[] = [];

  const periodOptions = generatePeriodOptions(config.financialYear, config.frequency);
  const selectedPeriod =
    periodOptions.find((p) => p.code === config.periodCode) || periodOptions[0];

  // 1. Validate Seller GSTIN
  const cleanSellerGstin = (config.gstin || '').trim().toUpperCase();
  if (!cleanSellerGstin) {
    issues.push({
      id: 'SELLER_GSTIN_MISSING',
      severity: 'error',
      code: 'ERR_SELLER_GSTIN',
      message: 'Business GSTIN is missing. A valid 15-character GSTIN is required to export GSTR-1.',
      section: 'Configuration',
      field: 'gstin',
      actionText: 'Update Business Profile',
    });
  } else {
    if (!GSTIN_REGEX.test(cleanSellerGstin)) {
      issues.push({
        id: 'SELLER_GSTIN_INVALID_FORMAT',
        severity: 'error',
        code: 'ERR_SELLER_GSTIN_FORMAT',
        message: `Business GSTIN "${cleanSellerGstin}" does not match the standard 15-character GSTIN format.`,
        section: 'Configuration',
        field: 'gstin',
      });
    } else if (!isValidGstinChecksum(cleanSellerGstin)) {
      issues.push({
        id: 'SELLER_GSTIN_CHECKSUM',
        severity: 'warning',
        code: 'WARN_SELLER_GSTIN_CHECKSUM',
        message: `Business GSTIN "${cleanSellerGstin}" checksum validation failed. Please verify with GST Portal.`,
        section: 'Configuration',
        field: 'gstin',
      });
    }

    const sellerExpectedStateCode = getStateCode(sellerState);
    if (sellerExpectedStateCode && cleanSellerGstin.slice(0, 2) !== sellerExpectedStateCode) {
      issues.push({
        id: 'SELLER_STATE_MISMATCH',
        severity: 'warning',
        code: 'WARN_SELLER_STATE_MISMATCH',
        message: `Business GSTIN state prefix (${cleanSellerGstin.slice(0, 2)}) does not match Business State (${sellerState} - code ${sellerExpectedStateCode}).`,
        section: 'Configuration',
        field: 'state',
      });
    }
  }

  // Filter invoices for period
  const periodInvoices = invoices.filter((inv) => {
    if (!inv.invoiceDate) return false;
    if (inv.isGst === false) return false;
    return (
      inv.invoiceDate >= selectedPeriod.startDate &&
      inv.invoiceDate <= selectedPeriod.endDate
    );
  });

  if (periodInvoices.length === 0) {
    issues.push({
      id: 'NO_INVOICES_IN_PERIOD',
      severity: 'warning',
      code: 'WARN_NO_INVOICES',
      message: `No GST invoices found between ${selectedPeriod.startDate} and ${selectedPeriod.endDate} for GSTIN ${cleanSellerGstin || 'selected'}. A Nil return will be generated.`,
      section: 'Overview',
    });
  }

  // 2. Audit Invoices
  const seenNumbers = new Map<string, string>(); // invoiceNumber -> invoiceId

  for (const inv of periodInvoices) {
    const isCancelled = inv.status === 'cancelled';
    const isDraft = inv.status === 'draft';

    // Draft warnings
    if (isDraft) {
      issues.push({
        id: `DRAFT_INV_${inv.id}`,
        severity: 'warning',
        code: 'WARN_DRAFT_INVOICE',
        message: `Invoice ${inv.invoiceNumber} is currently in DRAFT status and will not be included in the GSTR-1 upload file.`,
        section: 'DOCS',
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        actionText: 'Finalize Invoice',
      });
      continue;
    }

    // Cancelled notice
    if (isCancelled) {
      // Cancelled invoices are validly documented in Table 13 but excluded from monetary values
      continue;
    }

    // Check Invoice Number Format (GST rules: max 16 chars, only [A-Za-z0-9/-])
    const invNum = (inv.invoiceNumber || '').trim();
    if (!invNum) {
      issues.push({
        id: `INV_NUM_MISSING_${inv.id}`,
        severity: 'error',
        code: 'ERR_INVOICE_NUM_MISSING',
        message: 'Invoice has no invoice number assigned.',
        section: 'Invoices',
        invoiceId: inv.id,
      });
    } else {
      if (invNum.length > 16) {
        issues.push({
          id: `INV_NUM_LEN_${inv.id}`,
          severity: 'error',
          code: 'ERR_INVOICE_NUM_TOO_LONG',
          message: `Invoice number "${invNum}" exceeds the 16-character limit allowed by GSTN (${invNum.length} chars).`,
          section: 'Invoices',
          invoiceId: inv.id,
          invoiceNumber: invNum,
          field: 'invoiceNumber',
          actionText: 'Edit Invoice Number',
        });
      }

      if (!/^[a-zA-Z0-9\/-]+$/.test(invNum)) {
        issues.push({
          id: `INV_NUM_CHARS_${inv.id}`,
          severity: 'error',
          code: 'ERR_INVOICE_NUM_INVALID_CHARS',
          message: `Invoice number "${invNum}" contains special characters not permitted by GSTN. Only alphanumeric, "/" and "-" are allowed.`,
          section: 'Invoices',
          invoiceId: inv.id,
          invoiceNumber: invNum,
          field: 'invoiceNumber',
          actionText: 'Edit Invoice Number',
        });
      }

      // Check Duplicates
      const lowerNum = invNum.toLowerCase();
      if (seenNumbers.has(lowerNum)) {
        issues.push({
          id: `INV_NUM_DUP_${inv.id}`,
          severity: 'error',
          code: 'ERR_DUPLICATE_INVOICE_NUM',
          message: `Duplicate invoice number "${invNum}" detected in the same return period. GST portal rejects duplicate invoice numbers.`,
          section: 'Invoices',
          invoiceId: inv.id,
          invoiceNumber: invNum,
          field: 'invoiceNumber',
        });
      } else {
        seenNumbers.set(lowerNum, inv.id);
      }
    }

    // Check Invoice Date
    if (!inv.invoiceDate || isNaN(Date.parse(inv.invoiceDate))) {
      issues.push({
        id: `INV_DATE_INVALID_${inv.id}`,
        severity: 'error',
        code: 'ERR_INVOICE_DATE_INVALID',
        message: `Invoice ${invNum} has an invalid or missing date.`,
        section: 'Invoices',
        invoiceId: inv.id,
        invoiceNumber: invNum,
      });
    }

    // Check Place of Supply
    const custGstin = (inv.customerSnapshot?.gstin || '').trim().toUpperCase();
    const posCode = normalizePlaceOfSupplyCode(inv.placeOfSupply, custGstin);
    if (!posCode) {
      issues.push({
        id: `POS_MISSING_${inv.id}`,
        severity: 'error',
        code: 'ERR_POS_MISSING',
        message: `Invoice ${invNum} has an invalid or unrecognized Place of Supply: "${inv.placeOfSupply || 'empty'}".`,
        section: 'Classification',
        invoiceId: inv.id,
        invoiceNumber: invNum,
        field: 'placeOfSupply',
        actionText: 'Update Place of Supply',
      });
    }

    // Classify transaction to run section-specific audits
    const classified = classifyInvoice(inv, sellerState);

    // B2B Customer GSTIN validation
    if (classified.category === 'B2B' || classified.category === 'CDNR') {
      if (!custGstin) {
        issues.push({
          id: `B2B_GSTIN_MISSING_${inv.id}`,
          severity: 'error',
          code: 'ERR_B2B_GSTIN_MISSING',
          message: `B2B transaction ${invNum} is missing recipient GSTIN.`,
          section: classified.category,
          invoiceId: inv.id,
          invoiceNumber: invNum,
          field: 'gstin',
          actionText: 'Add Customer GSTIN',
        });
      } else {
        if (!GSTIN_REGEX.test(custGstin)) {
          issues.push({
            id: `B2B_GSTIN_FORMAT_${inv.id}`,
            severity: 'error',
            code: 'ERR_CUSTOMER_GSTIN_FORMAT',
            message: `Customer GSTIN "${custGstin}" on invoice ${invNum} is invalid (does not match 15-character GSTIN regex).`,
            section: classified.category,
            invoiceId: inv.id,
            invoiceNumber: invNum,
            field: 'gstin',
            actionText: 'Fix Customer GSTIN',
          });
        } else if (!isValidGstinChecksum(custGstin)) {
          issues.push({
            id: `B2B_GSTIN_CHECKSUM_${inv.id}`,
            severity: 'warning',
            code: 'WARN_CUSTOMER_GSTIN_CHECKSUM',
            message: `Customer GSTIN "${custGstin}" checksum validation failed on invoice ${invNum}. Verify with GST Portal.`,
            section: classified.category,
            invoiceId: inv.id,
            invoiceNumber: invNum,
          });
        }

        // Check if customer GSTIN state matches POS code
        const custGstinState = custGstin.slice(0, 2);
        if (posCode && custGstinState !== posCode && !inv.placeOfSupply?.toLowerCase().includes('sez')) {
          issues.push({
            id: `POS_GSTIN_MISMATCH_${inv.id}`,
            severity: 'warning',
            code: 'WARN_POS_GSTIN_STATE_MISMATCH',
            message: `Invoice ${invNum}: Place of supply state code (${posCode}) differs from customer GSTIN state code (${custGstinState}).`,
            section: classified.category,
            invoiceId: inv.id,
            invoiceNumber: invNum,
          });
        }
      }
    }

    // Line items audit: HSN/SAC, rates, tax calculations
    if (!inv.items || inv.items.length === 0) {
      issues.push({
        id: `ITEMS_EMPTY_${inv.id}`,
        severity: 'error',
        code: 'ERR_LINE_ITEMS_EMPTY',
        message: `Invoice ${invNum} has no line items.`,
        section: 'Invoices',
        invoiceId: inv.id,
        invoiceNumber: invNum,
        actionText: 'Add Line Items',
      });
    } else {
      let calcTaxable = 0;
      let calcCgst = 0;
      let calcSgst = 0;
      let calcIgst = 0;

      inv.items.forEach((item, itemIdx) => {
        calcTaxable += item.taxableAmount || 0;
        calcCgst += item.cgstAmount || 0;
        calcSgst += item.sgstAmount || 0;
        calcIgst += item.igstAmount || 0;

        // HSN/SAC check
        const hsnCode = (item.hsnSac || '').trim();
        if (!hsnCode) {
          issues.push({
            id: `HSN_MISSING_${inv.id}_${itemIdx}`,
            severity: 'error',
            code: 'ERR_HSN_MISSING',
            message: `Invoice ${invNum}, Item #${itemIdx + 1} ("${item.name || 'Untitled'}") is missing HSN/SAC code. GST reporting requires HSN/SAC for all goods & services.`,
            section: 'HSN',
            invoiceId: inv.id,
            invoiceNumber: invNum,
            field: 'hsnSac',
            actionText: 'Add HSN Code',
          });
        } else {
          const digitsOnly = hsnCode.replace(/\D/g, '');
          if (digitsOnly.length < 4) {
            issues.push({
              id: `HSN_SHORT_${inv.id}_${itemIdx}`,
              severity: 'warning',
              code: 'WARN_HSN_DIGITS_SHORT',
              message: `Invoice ${invNum}, Item #${itemIdx + 1}: HSN/SAC code "${hsnCode}" has only ${digitsOnly.length} digits. GSTN requires at least 4 digits (or 6 digits for turnover > ₹5 Cr).`,
              section: 'HSN',
              invoiceId: inv.id,
              invoiceNumber: invNum,
              field: 'hsnSac',
            });
          }
        }

        // Tax calculation check per item
        const rate = item.taxRate || 0;
        const expectedTax = (item.taxableAmount * rate) / 100;

        if (inv.isInterState || posCode === '96') {
          // Inter-state -> IGST
          if (Math.abs((item.igstAmount || 0) - expectedTax) > 0.5) {
            issues.push({
              id: `TAX_MATH_IGST_${inv.id}_${itemIdx}`,
              severity: 'error',
              code: 'ERR_TAX_MATH_IGST',
              message: `Invoice ${invNum}, Item #${itemIdx + 1}: IGST (${item.igstAmount}) does not match ${rate}% of taxable value (${item.taxableAmount}). Expected ${expectedTax.toFixed(2)}.`,
              section: 'Taxes',
              invoiceId: inv.id,
              invoiceNumber: invNum,
            });
          }
        } else {
          // Intra-state -> CGST + SGST (50% each)
          const halfExpected = expectedTax / 2;
          if (
            Math.abs((item.cgstAmount || 0) - halfExpected) > 0.5 ||
            Math.abs((item.sgstAmount || 0) - halfExpected) > 0.5
          ) {
            issues.push({
              id: `TAX_MATH_INTRA_${inv.id}_${itemIdx}`,
              severity: 'error',
              code: 'ERR_TAX_MATH_INTRA',
              message: `Invoice ${invNum}, Item #${itemIdx + 1}: CGST (${item.cgstAmount}) / SGST (${item.sgstAmount}) do not match ${rate / 2}% each on taxable value (${item.taxableAmount}).`,
              section: 'Taxes',
              invoiceId: inv.id,
              invoiceNumber: invNum,
            });
          }
        }
      });

      // Invoice level math check
      const expectedTotal = calcTaxable + calcCgst + calcSgst + calcIgst + (inv.roundOff || 0);
      if (Math.abs(expectedTotal - inv.grandTotal) > 1.0) {
        issues.push({
          id: `INV_TOTAL_MISMATCH_${inv.id}`,
          severity: 'warning',
          code: 'WARN_INVOICE_TOTAL_MATH',
          message: `Invoice ${invNum}: Grand total (${inv.grandTotal}) deviates from sum of taxable (${calcTaxable.toFixed(2)}) + tax (${(calcCgst + calcSgst + calcIgst).toFixed(2)}) + roundoff (${(inv.roundOff || 0).toFixed(2)}).`,
          section: 'Invoices',
          invoiceId: inv.id,
          invoiceNumber: invNum,
        });
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    isValid: errorCount === 0 && warningCount === 0,
    canExport: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
}
