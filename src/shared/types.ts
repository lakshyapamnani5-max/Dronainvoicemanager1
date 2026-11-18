import type {
  CustomColumnAlign,
  CustomColumnDataType,
  CustomColumnDef,
  CustomInvoiceLayout,
} from './customLayoutTypes';

export type {
  CustomColumnAlign,
  CustomColumnDataType,
  CustomColumnDef,
  CustomInvoiceLayout,
};

export type UserRole = 'super_admin' | 'business';
export type AccountStatus = 'active' | 'inactive';

export type InvoiceStatus =
  | 'draft'
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled';

export type QuotationStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted';

export type PaymentMethod =
  | 'Cash'
  | 'UPI'
  | 'Bank Transfer'
  | 'Credit/Debit Card'
  | 'Cheque'
  | 'Other';

export type TaxPricingMode = 'exclusive' | 'inclusive';
export type TaxSupplyMode = 'auto' | 'intra' | 'inter';
export type DiscountType = 'percent' | 'fixed';
export type QuotationTemplateId =
  | 'executive_gold'
  | 'modern_minimal'
  | 'corporate_blue'
  | 'french_classic'
  | 'drona_signature'
  | 'landscape_pro';

export type TemplateId =
  | 'gst_theme_1'
  | 'gst_theme_2'
  | 'gst_theme_3'
  | 'gst_theme_4'
  | 'gst_theme_5'
  | 'gst_theme_6'
  | 'double_divine'
  | 'french_elite'
  | 'landscape_theme_2'
  | 'classic_gst'
  | 'executive_minimal'
  | 'compact_commercial'
  | QuotationTemplateId;

export interface UserRecord {
  uid: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  ownerName: string;
  businessName: string;
  phone: string;
  gstin: string;
  subscriptionPlan: string;
  subscriptionAmount: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface BusinessProfile {
  userUid: string;
  businessName: string;
  ownerName: string;
  logoDataUrl: string;
  address: string;
  email: string;
  phone: string;
  gstin: string;
  pan: string;
  state: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
  upiQrDataUrl: string;
  invoicePrefix: string;
  quotationPrefix: string;
  defaultIsGst: boolean;
  defaultTaxRate: number;
  defaultTaxMode: TaxPricingMode;
  defaultPaymentTermsDays: number;
  defaultInvoiceTemplate: TemplateId;
  defaultQuotationTemplate: TemplateId;
  termsAndConditions: string;
  signatureLabel: string;
  signatureDataUrl?: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  userUid: string;
  name: string;
  companyName: string;
  email: string;
  phone: string;
  gstin: string;
  billingAddress: string;
  shippingAddress: string;
  state: string;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  totalSales?: number;
  totalPaid?: number;
  outstandingBalance?: number;
  invoiceCount?: number;
  quotationCount?: number;
}

export interface LineItemInput {
  id?: string;
  name: string;
  description: string;
  hsnSac: string;
  quantity: number;
  unit: string;
  rate: number;
  discountType: DiscountType;
  discountValue: number;
  taxRate: number;
  customFields?: Record<string, any>;
}

export interface RateCardItem {
  id: string;
  userUid: string;
  name: string;
  description: string;
  hsnSac: string;
  unit: string;
  rate: number;
  discountType: DiscountType;
  discountValue: number;
  taxRate: number;
  category: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComputedLineItem extends LineItemInput {
  sortOrder: number;
  grossAmount: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface CustomerSnapshot {
  id: string;
  name: string;
  companyName: string;
  email: string;
  phone: string;
  gstin: string;
  billingAddress: string;
  shippingAddress: string;
  state: string;
}

export interface BusinessSnapshot {
  businessName: string;
  ownerName: string;
  logoDataUrl: string;
  address: string;
  email: string;
  phone: string;
  gstin: string;
  pan: string;
  state: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
  upiQrDataUrl: string;
  signatureLabel: string;
  signatureDataUrl?: string;
}

export interface Invoice {
  id: string;
  userUid: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  customerId: string;
  customerSnapshot: CustomerSnapshot;
  businessSnapshot: BusinessSnapshot;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  referenceNumber: string;
  placeOfSupply: string;
  isGst: boolean;
  taxMode: TaxPricingMode;
  taxSupplyMode: TaxSupplyMode;
  isInterState: boolean;
  roundOffEnabled: boolean;
  subtotal: number;
  totalDiscount: number;
  taxableAmount: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  totalTax: number;
  roundOff: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  amountInWords: string;
  templateId: TemplateId;
  layoutId?: string | null;
  layoutSnapshot?: CustomInvoiceLayout | null;
  notes: string;
  terms: string;
  sourceQuotationId: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: ComputedLineItem[];
  payments?: Payment[];
}

export interface Quotation {
  id: string;
  userUid: string;
  quotationNumber: string;
  status: QuotationStatus;
  customerId: string;
  customerSnapshot: CustomerSnapshot;
  businessSnapshot: BusinessSnapshot;
  quotationDate: string;
  validUntil: string;
  referenceNumber: string;
  placeOfSupply: string;
  isGst: boolean;
  taxMode: TaxPricingMode;
  taxSupplyMode: TaxSupplyMode;
  isInterState: boolean;
  roundOffEnabled: boolean;
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
  templateId: TemplateId;
  layoutId?: string | null;
  layoutSnapshot?: CustomInvoiceLayout | null;
  quotationTitle?: string;
  projectDescription?: string;
  deliveryTimeline?: string;
  paymentTerms?: string;
  preparedBy?: string;
  showPaymentInstructions?: boolean;
  paymentInstructions?: string;
  notes: string;
  terms: string;
  convertedInvoiceId: string | null;
  createdAt: string;
  updatedAt: string;
  items: ComputedLineItem[];
}

export interface Payment {
  id: string;
  userUid: string;
  invoiceId: string;
  invoiceNumber?: string;
  customerId: string;
  customerName?: string;
  paymentDate: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceId: string;
  notes: string;
  receiptNumber: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userUid: string;
  type:
    | 'invoice_created'
    | 'payment_received'
    | 'invoice_overdue'
    | 'quotation_expiring'
    | 'quotation_accepted'
    | 'quotation_converted';
  title: string;
  message: string;
  entityType: 'invoice' | 'quotation' | 'payment' | null;
  entityId: string | null;
  isRead: boolean;
  emailStatus: 'not_configured' | 'queued' | 'sent';
  whatsappStatus: 'not_configured' | 'queued' | 'sent';
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: UserRole;
  targetTenantUid: string | null;
  impersonationSessionId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ImpersonationSession {
  id: string;
  adminUid: string;
  adminEmail: string;
  targetUid: string;
  targetBusinessName: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  active: boolean;
}

export interface PlatformSettings {
  allowSelfRegistration: boolean;
  platformName: string;
  supportEmail: string;
  defaultCurrency: string;
  defaultInvoicePrefix: string;
  defaultQuotationPrefix: string;
  defaultSubscriptionMonthly: number;
  maintenanceMode: boolean;
  updatedAt: string;
}

export interface AuthSessionState {
  actorUser: UserRecord;
  effectiveUser: UserRecord;
  businessProfile: BusinessProfile | null;
  isImpersonating: boolean;
  impersonationSession: ImpersonationSession | null;
}

export interface CustomerAnalyticsData {
  summary: {
    totalSales: number;
    previousPeriodSales: number;
    salesGrowthPct: number;
    totalInvoices: number;
    totalAmountReceived: number;
    totalOutstanding: number;
    overdueAmount: number;
    totalQuotations: number;
    acceptedQuotations: number;
    pendingQuotations: number;
  };
  salesSeries: Array<{
    period: string;
    label: string;
    invoiced: number;
    collected: number;
    invoiceCount: number;
  }>;
  invoiceStatusBreakdown: Array<{
    status: InvoiceStatus;
    count: number;
    amount: number;
  }>;
  topCustomersBySales: Array<{
    customerId: string;
    name: string;
    companyName: string;
    totalSales: number;
    invoiceCount: number;
  }>;
  topCustomersByOutstanding: Array<{
    customerId: string;
    name: string;
    companyName: string;
    outstanding: number;
    overdue: number;
  }>;
  recentCustomers: Customer[];
  recentInvoices: Invoice[];
}

export interface OutstandingReportRow {
  customerId: string;
  customerName: string;
  companyName: string;
  email: string;
  phone: string;
  totalInvoiced: number;
  amountPaid: number;
  outstandingBalance: number;
  unpaidInvoiceCount: number;
  overdueAmount: number;
  oldestDueDate: string | null;
}

export interface AdminDashboardData {
  summary: {
    totalBusinesses: number;
    activeAccounts: number;
    inactiveAccounts: number;
    totalInvoicesGenerated: number;
    totalQuotationsGenerated: number;
    platformInvoicedValue: number;
    platformPaymentsRecorded: number;
    dronaSubscriptionRevenue: number;
  };
  usageSeries: Array<{
    period: string;
    label: string;
    invoicedValue: number;
    paymentsRecorded: number;
    dronaRevenue: number;
    invoiceCount: number;
  }>;
  recentBusinesses: Array<UserRecord & { invoiceCount: number; quotationCount: number; totalSales: number }>;
  recentActivity: ActivityLog[];
}

export interface GstinAddressDetails {
  building_number: string | null;
  building_name: string | null;
  floor: string | null;
  street: string | null;
  locality: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  landmark: string | null;
  pincode: string | null;
}

export interface GstinLookupDetails {
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  status: string | null;
  taxpayer_type: string | null;
  business_constitution: string | null;
  registration_date: string | null;
  cancellation_date: string | null;
  state_code: string | null;
  state_jurisdiction: string | null;
  address: string | null;
  pincode: string | null;
  nature_of_business: string[] | null;
  block_status: string | null;
  einvoice_status?: string | null;
  last_updated?: string | null;
  address_details?: GstinAddressDetails | null;
}

export interface GstinLookupResponse {
  success: true;
  gstin: string;
  data: GstinLookupDetails;
  credits_remaining?: number;
  response_ms?: number;
  profile_complete?: boolean;
  cachedAt?: number;
}

// ==================== PURCHASES MANAGEMENT MODULE ====================

export type PurchaseType = 'gst' | 'non_gst' | 'import' | 'composition';
export type PurchaseStatus = 'draft' | 'unpaid' | 'partially_paid' | 'paid' | 'overdue';

export interface Supplier {
  id: string;
  userUid: string;
  name: string;
  companyName: string;
  email: string;
  phone: string;
  gstin: string;
  billingAddress: string;
  state: string;
  stateCode: string;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  totalPurchases?: number;
  totalPaid?: number;
  outstandingBalance?: number;
  billCount?: number;
}

export interface SupplierSnapshot {
  id: string;
  name: string;
  companyName: string;
  email: string;
  phone: string;
  gstin: string;
  billingAddress: string;
  state: string;
  stateCode: string;
}

export type OcrConfidenceLevel = 'high' | 'review' | 'invalid';

export interface OcrFieldValidation {
  confidence: number | null;
  level: OcrConfidenceLevel;
  message?: string;
}

export interface PurchaseLineItemInput extends LineItemInput {
  ocrConfidence?: number | null;
  ocrStatus?: OcrConfidenceLevel;
  ocrMessage?: string;
}

export interface ComputedPurchaseLineItem extends ComputedLineItem {
  ocrConfidence?: number | null;
  ocrStatus?: OcrConfidenceLevel;
  ocrMessage?: string;
}

export interface PurchaseAttachment {
  id: string;
  userUid: string;
  purchaseId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  downloadUrl: string;
  pageCount?: number;
  createdAt: string;
}

export interface Purchase {
  id: string;
  userUid: string;
  billNumber: string;
  referenceNumber: string;
  supplierId: string;
  supplierSnapshot: SupplierSnapshot;
  billDate: string;
  dueDate: string;
  paymentTerms: string;
  purchaseType: PurchaseType;
  isGst: boolean;
  taxMode: TaxPricingMode;
  taxSupplyMode: TaxSupplyMode;
  isInterState: boolean;
  placeOfSupply: string;
  roundOffEnabled: boolean;
  status: PurchaseStatus;
  items: ComputedPurchaseLineItem[];
  subtotal: number;
  itemDiscountTotal: number;
  invoiceDiscountType: DiscountType;
  invoiceDiscountValue: number;
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
  amountPaid: number;
  balanceDue: number;
  amountInWords: string;
  notes: string;
  ocrUsed: boolean;
  ocrWarnings?: string[];
  attachmentId?: string;
  attachmentMeta?: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string;
    storagePath: string;
    pageCount?: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchasePayment {
  id: string;
  userUid: string;
  purchaseId: string;
  billNumber?: string;
  supplierId: string;
  supplierName?: string;
  paymentDate: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceId: string;
  notes: string;
  paymentNumber: string;
  isAdvance?: boolean;
  createdAt: string;
}

export interface SavePurchasePayload {
  supplierId: string;
  billNumber: string;
  referenceNumber?: string;
  billDate: string;
  dueDate: string;
  paymentTerms?: string;
  purchaseType: PurchaseType;
  taxMode: TaxPricingMode;
  taxSupplyMode: TaxSupplyMode;
  placeOfSupply?: string;
  roundOffEnabled: boolean;
  invoiceDiscountType?: DiscountType;
  invoiceDiscountValue?: number;
  additionalCharges?: number;
  notes?: string;
  saveAsDraft?: boolean;
  ocrUsed?: boolean;
  ocrWarnings?: string[];
  items: PurchaseLineItemInput[];
  initialPayment?: {
    amount: number;
    paymentDate: string;
    paymentMethod: PaymentMethod;
    referenceId?: string;
    notes?: string;
    allowAdvance?: boolean;
  };
  attachmentFile?: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    base64Data: string;
    pageCount?: number;
  };
}

export interface PurchaseOcrField<T = string | number | null> {
  value: T;
  confidence: number | null;
}

export interface PurchaseOcrRawResponse {
  success: true;
  engine: string;
  pageCount: number;
  processingMs: number;
  supplier: {
    businessName: PurchaseOcrField<string>;
    gstin: PurchaseOcrField<string>;
    address: PurchaseOcrField<string>;
    state: PurchaseOcrField<string>;
    phone: PurchaseOcrField<string>;
    email: PurchaseOcrField<string>;
  };
  invoice: {
    invoiceNumber: PurchaseOcrField<string>;
    invoiceDate: PurchaseOcrField<string>;
    dueDate: PurchaseOcrField<string>;
    poNumber: PurchaseOcrField<string>;
  };
  items: Array<{
    name: PurchaseOcrField<string>;
    description?: PurchaseOcrField<string>;
    hsnSac: PurchaseOcrField<string>;
    quantity: PurchaseOcrField<number>;
    unit: PurchaseOcrField<string>;
    rate: PurchaseOcrField<number>;
    discount: PurchaseOcrField<number>;
    taxableValue: PurchaseOcrField<number>;
    gstRate: PurchaseOcrField<number>;
    cgst: PurchaseOcrField<number>;
    sgst: PurchaseOcrField<number>;
    igst: PurchaseOcrField<number>;
    lineTotal: PurchaseOcrField<number>;
  }>;
  summary: {
    subtotal: PurchaseOcrField<number>;
    totalDiscount: PurchaseOcrField<number>;
    totalTaxableValue: PurchaseOcrField<number>;
    totalGst: PurchaseOcrField<number>;
    cgstTotal?: PurchaseOcrField<number>;
    sgstTotal?: PurchaseOcrField<number>;
    igstTotal?: PurchaseOcrField<number>;
    additionalCharges: PurchaseOcrField<number>;
    roundOff: PurchaseOcrField<number>;
    grandTotal: PurchaseOcrField<number>;
  };
  rawText?: string;
}

export interface PurchaseAnalyticsData {
  summary: {
    totalPurchases: number;
    totalPurchaseBills: number;
    amountPaid: number;
    outstandingPayables: number;
    overduePayables: number;
    totalVendors: number;
    draftBills: number;
  };
  purchaseSeries: Array<{
    period: string;
    label: string;
    purchased: number;
    paid: number;
    billCount: number;
  }>;
  statusBreakdown: Array<{ status: PurchaseStatus; count: number; amount: number }>;
  topSuppliers: Array<{
    supplierId: string;
    name: string;
    companyName: string;
    gstin: string;
    totalPurchases: number;
    outstanding: number;
    billCount: number;
  }>;
  recentPurchases: Purchase[];
}


