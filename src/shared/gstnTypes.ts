/**
 * GSTN GSTR-1 Schema Types & Report Interfaces for DronaInvoice
 * Follows the official Goods and Services Tax Network (GSTN) offline upload schema.
 */

export interface Gstr1ItemDetail {
  num: number;
  itm_det: {
    txval: number;
    rt: number;
    iamt?: number;
    camt?: number;
    samt?: number;
    csamt?: number;
  };
}

export interface Gstr1B2BInvoice {
  inum: string;
  idt: string; // DD-MM-YYYY
  val: number; // Invoice total
  pos: string; // 2-digit state code
  rchrg: 'Y' | 'N';
  etin?: string;
  inv_ty: 'R' | 'DE' | 'SEWP' | 'SEWOP';
  diff_percent?: number;
  itms: Gstr1ItemDetail[];
}

export interface Gstr1B2BGroup {
  ctin: string; // Customer GSTIN
  cfs?: string;
  inv: Gstr1B2BInvoice[];
}

export interface Gstr1B2CLInvoice {
  inum: string;
  idt: string;
  val: number;
  etin?: string;
  diff_percent?: number;
  itms: Gstr1ItemDetail[];
}

export interface Gstr1B2CLGroup {
  pos: string;
  inv: Gstr1B2CLInvoice[];
}

export interface Gstr1B2CSRow {
  sply_ty: 'INTER' | 'INTRA';
  pos: string;
  typ: 'OE' | 'E';
  etin?: string;
  rt: number;
  txval: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt?: number;
}

export interface Gstr1CdnrNote {
  ntty: 'C' | 'D';
  nt_num: string;
  nt_dt: string;
  p_gst: 'Y' | 'N';
  val: number;
  pos: string;
  rchrg: 'Y' | 'N';
  inv_ty: 'R' | 'DE' | 'SEWP' | 'SEWOP';
  itms: Gstr1ItemDetail[];
}

export interface Gstr1CdnrGroup {
  ctin: string;
  cfs?: string;
  nt: Gstr1CdnrNote[];
}

export interface Gstr1CdnurRow {
  typ: 'B2CL' | 'EXPWP' | 'EXPWOP';
  ntty: 'C' | 'D';
  nt_num: string;
  nt_dt: string;
  p_gst: 'Y' | 'N';
  pos: string;
  val: number;
  itms: Gstr1ItemDetail[];
}

export interface Gstr1ExpInvoice {
  inum: string;
  idt: string;
  val: number;
  sbnum?: string;
  sbdt?: string;
  sbpcode?: string;
  itms: Gstr1ItemDetail[];
}

export interface Gstr1ExpGroup {
  exp_typ: 'WPAY' | 'WOPAY';
  inv: Gstr1ExpInvoice[];
}

export interface Gstr1NilItem {
  nil_amt: number;
  expt_amt: number;
  ngsup_amt: number;
  sply_ty: 'INTRAB2B' | 'INTRAB2C' | 'INTERB2B' | 'INTERB2C';
}

export interface Gstr1HsnItem {
  num: number;
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

export interface Gstr1DocDetail {
  num: number;
  from: string;
  to: string;
  totnum: number;
  canc: number;
  net_issue: number;
}

export interface Gstr1DocCategory {
  doc_num: number;
  doc_typ: string;
  docs: Gstr1DocDetail[];
}

/**
 * Root JSON Object expected by the GSTN Portal Offline Tool
 */
export interface Gstr1JsonPayload {
  gstin: string;
  fp: string; // MMYYYY format
  gt: number;
  cur_gt: number;
  version: string;
  hash: string;
  b2b?: Gstr1B2BGroup[];
  b2cl?: Gstr1B2CLGroup[];
  b2cs?: Gstr1B2CSRow[];
  cdnr?: Gstr1CdnrGroup[];
  cdnur?: Gstr1CdnurRow[];
  exp?: Gstr1ExpGroup[];
  nil?: {
    inv: Gstr1NilItem[];
  };
  hsn?: {
    data: Gstr1HsnItem[];
  };
  doc_issue?: {
    doc_det: Gstr1DocCategory[];
  };
}

/**
 * Return configuration options
 */
export type GstReturnPeriodType = 'monthly' | 'quarterly';

export interface GstPeriodOption {
  code: string; // e.g., "042026"
  label: string; // e.g., "April 2026"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  month: number; // 1-12
  year: number;
  quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
}

export interface GstReturnConfig {
  gstin: string;
  financialYear: string; // e.g. "2026-27"
  frequency: GstReturnPeriodType;
  periodCode: string; // "MMYYYY"
  previousFyTurnover: number;
  currentFyTurnover: number;
}

/**
 * Validation Issues
 */
export interface GstValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  section: string;
  invoiceId?: string;
  invoiceNumber?: string;
  field?: string;
  actionText?: string;
}

export interface GstValidationReport {
  isValid: boolean;
  canExport: boolean;
  errorCount: number;
  warningCount: number;
  issues: GstValidationIssue[];
}

/**
 * Classified Invoice Representation
 */
export type GstTransactionCategory =
  | 'B2B'
  | 'B2CL'
  | 'B2CS'
  | 'CDNR'
  | 'CDNUR'
  | 'EXP'
  | 'NIL';

export interface ClassifiedInvoiceItem {
  sortOrder: number;
  name: string;
  description: string;
  hsnSac: string;
  quantity: number;
  unit: string;
  uqc: string;
  rate: number;
  taxRate: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalAmount: number;
}

export interface ClassifiedTransaction {
  category: GstTransactionCategory;
  subType?: string; // 'R', 'DE', 'SEWP', 'SEWOP', 'WPAY', 'WOPAY', 'C', 'D'
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  posCode: string; // 2-digit POS
  posStateName: string;
  customerName: string;
  customerGstin: string;
  isRegistered: boolean;
  isInterState: boolean;
  isCancelled: boolean;
  isDraft: boolean;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalTax: number;
  invoiceValue: number;
  items: ClassifiedLineSummary[];
}

export interface ClassifiedLineSummary {
  rate: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
}

/**
 * GSTR-1 Aggregated Summary
 */
export interface Gstr1SummarySection {
  title: string;
  code: string;
  tableNumber: string;
  invoiceCount: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalTax: number;
  totalInvoiceValue: number;
}

export interface Gstr1ComprehensiveSummary {
  periodCode: string;
  periodLabel: string;
  financialYear: string;
  gstin: string;
  supplierName: string;
  totalInvoicesScanned: number;
  activeInvoicesCount: number;
  cancelledInvoicesCount: number;
  draftInvoicesCount: number;
  totalTaxableValue: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalCess: number;
  totalTax: number;
  totalInvoiceValue: number;
  sections: Record<GstTransactionCategory, Gstr1SummarySection>;
  hsnSummary: Gstr1HsnItem[];
  docSummary: Gstr1DocCategory[];
  transactions: ClassifiedTransaction[];
}

/**
 * Export History record stored in Firebase RTDB
 */
export interface GstExportRecord {
  id: string;
  userUid: string;
  gstin: string;
  period: string; // "MMYYYY"
  periodLabel: string;
  financialYear: string;
  frequency: GstReturnPeriodType;
  filename: string;
  invoiceCount: number;
  totalTaxableValue: number;
  totalTax: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalCess: number;
  grandTotal: number;
  validationStatus: 'valid' | 'has_warnings';
  exportedInvoiceIds: string[];
  createdAt: string;
  jsonPayload: string;
}
