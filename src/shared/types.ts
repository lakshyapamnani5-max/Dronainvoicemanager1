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
export type TemplateId = 'classic_gst' | 'executive_minimal' | 'compact_commercial';

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
