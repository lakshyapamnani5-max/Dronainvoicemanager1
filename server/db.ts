import Database from 'better-sqlite3';
import path from 'node:path';
import { generateId, hashPassword } from './cryptoUtils.ts';
import { computeDocumentTotals, toPaise } from '../src/shared/gstCalculator.ts';

const dbPath = process.env.DRONA_DB_PATH || path.resolve(process.cwd(), 'drona.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      allow_self_registration INTEGER NOT NULL DEFAULT 1,
      platform_name TEXT NOT NULL DEFAULT 'DRONA',
      support_email TEXT NOT NULL DEFAULT 'support@drona.in',
      default_currency TEXT NOT NULL DEFAULT 'INR',
      default_invoice_prefix TEXT NOT NULL DEFAULT 'INV',
      default_quotation_prefix TEXT NOT NULL DEFAULT 'QUO',
      default_subscription_monthly INTEGER NOT NULL DEFAULT 1999,
      maintenance_mode INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super_admin', 'business')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      owner_name TEXT NOT NULL,
      business_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      gstin TEXT NOT NULL DEFAULT '',
      subscription_plan TEXT NOT NULL DEFAULT 'Growth',
      subscription_amount INTEGER NOT NULL DEFAULT 1999,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      impersonating_uid TEXT REFERENCES users(uid) ON DELETE SET NULL,
      impersonation_session_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS business_profiles (
      user_uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
      business_name TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      logo_data_url TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      gstin TEXT NOT NULL DEFAULT '',
      pan TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'Maharashtra',
      bank_name TEXT NOT NULL DEFAULT '',
      account_number TEXT NOT NULL DEFAULT '',
      ifsc TEXT NOT NULL DEFAULT '',
      upi_id TEXT NOT NULL DEFAULT '',
      upi_qr_data_url TEXT NOT NULL DEFAULT '',
      invoice_prefix TEXT NOT NULL DEFAULT 'INV',
      quotation_prefix TEXT NOT NULL DEFAULT 'QUO',
      default_is_gst INTEGER NOT NULL DEFAULT 1,
      default_tax_rate REAL NOT NULL DEFAULT 18,
      default_tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (default_tax_mode IN ('exclusive', 'inclusive')),
      default_payment_terms_days INTEGER NOT NULL DEFAULT 15,
      default_invoice_template TEXT NOT NULL DEFAULT 'classic_gst',
      default_quotation_template TEXT NOT NULL DEFAULT 'classic_gst',
      terms_and_conditions TEXT NOT NULL DEFAULT '1. Payment due within specified terms.\n2. Subject to local jurisdiction.',
      signature_label TEXT NOT NULL DEFAULT 'Authorized Signatory',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_counters (
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      doc_type TEXT NOT NULL CHECK (doc_type IN ('INV', 'QUO', 'RCP')),
      year INTEGER NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_uid, doc_type, year)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      name TEXT NOT NULL,
      company_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      gstin TEXT NOT NULL DEFAULT '',
      billing_address TEXT NOT NULL DEFAULT '',
      shipping_address TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'Maharashtra',
      notes TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled')),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      customer_snapshot_json TEXT NOT NULL,
      business_snapshot_json TEXT NOT NULL,
      invoice_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      payment_terms TEXT NOT NULL DEFAULT 'Net 15',
      reference_number TEXT NOT NULL DEFAULT '',
      place_of_supply TEXT NOT NULL DEFAULT '',
      is_gst INTEGER NOT NULL DEFAULT 1,
      tax_mode TEXT NOT NULL DEFAULT 'exclusive',
      tax_supply_mode TEXT NOT NULL DEFAULT 'auto',
      is_inter_state INTEGER NOT NULL DEFAULT 0,
      round_off_enabled INTEGER NOT NULL DEFAULT 1,
      subtotal_paise INTEGER NOT NULL DEFAULT 0,
      discount_paise INTEGER NOT NULL DEFAULT 0,
      taxable_paise INTEGER NOT NULL DEFAULT 0,
      cgst_paise INTEGER NOT NULL DEFAULT 0,
      sgst_paise INTEGER NOT NULL DEFAULT 0,
      igst_paise INTEGER NOT NULL DEFAULT 0,
      total_tax_paise INTEGER NOT NULL DEFAULT 0,
      round_off_paise INTEGER NOT NULL DEFAULT 0,
      grand_total_paise INTEGER NOT NULL DEFAULT 0,
      amount_paid_paise INTEGER NOT NULL DEFAULT 0,
      balance_due_paise INTEGER NOT NULL DEFAULT 0,
      amount_in_words TEXT NOT NULL DEFAULT '',
      template_id TEXT NOT NULL DEFAULT 'classic_gst',
      notes TEXT NOT NULL DEFAULT '',
      terms TEXT NOT NULL DEFAULT '',
      source_quotation_id TEXT,
      cancellation_reason TEXT,
      cancelled_at TEXT,
      finalized_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_uid, invoice_number)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      hsn_sac TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'Nos',
      rate_paise INTEGER NOT NULL,
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      gross_paise INTEGER NOT NULL,
      discount_paise INTEGER NOT NULL,
      taxable_paise INTEGER NOT NULL,
      cgst_paise INTEGER NOT NULL,
      sgst_paise INTEGER NOT NULL,
      igst_paise INTEGER NOT NULL,
      tax_paise INTEGER NOT NULL,
      total_paise INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      quotation_number TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      customer_snapshot_json TEXT NOT NULL,
      business_snapshot_json TEXT NOT NULL,
      quotation_date TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      reference_number TEXT NOT NULL DEFAULT '',
      place_of_supply TEXT NOT NULL DEFAULT '',
      is_gst INTEGER NOT NULL DEFAULT 1,
      tax_mode TEXT NOT NULL DEFAULT 'exclusive',
      tax_supply_mode TEXT NOT NULL DEFAULT 'auto',
      is_inter_state INTEGER NOT NULL DEFAULT 0,
      round_off_enabled INTEGER NOT NULL DEFAULT 1,
      subtotal_paise INTEGER NOT NULL DEFAULT 0,
      discount_paise INTEGER NOT NULL DEFAULT 0,
      taxable_paise INTEGER NOT NULL DEFAULT 0,
      cgst_paise INTEGER NOT NULL DEFAULT 0,
      sgst_paise INTEGER NOT NULL DEFAULT 0,
      igst_paise INTEGER NOT NULL DEFAULT 0,
      total_tax_paise INTEGER NOT NULL DEFAULT 0,
      round_off_paise INTEGER NOT NULL DEFAULT 0,
      grand_total_paise INTEGER NOT NULL DEFAULT 0,
      amount_in_words TEXT NOT NULL DEFAULT '',
      template_id TEXT NOT NULL DEFAULT 'classic_gst',
      notes TEXT NOT NULL DEFAULT '',
      terms TEXT NOT NULL DEFAULT '',
      converted_invoice_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_uid, quotation_number)
    );

    CREATE TABLE IF NOT EXISTS quotation_items (
      id TEXT PRIMARY KEY,
      quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      hsn_sac TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'Nos',
      rate_paise INTEGER NOT NULL,
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      gross_paise INTEGER NOT NULL,
      discount_paise INTEGER NOT NULL,
      taxable_paise INTEGER NOT NULL,
      cgst_paise INTEGER NOT NULL,
      sgst_paise INTEGER NOT NULL,
      igst_paise INTEGER NOT NULL,
      tax_paise INTEGER NOT NULL,
      total_paise INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      payment_date TEXT NOT NULL,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      payment_method TEXT NOT NULL,
      reference_id TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      receipt_number TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_uid, receipt_number)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      email_status TEXT NOT NULL DEFAULT 'not_configured',
      whatsapp_status TEXT NOT NULL DEFAULT 'not_configured',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS impersonation_sessions (
      id TEXT PRIMARY KEY,
      admin_uid TEXT NOT NULL REFERENCES users(uid),
      admin_email TEXT NOT NULL,
      target_uid TEXT NOT NULL REFERENCES users(uid),
      target_business_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ended_at TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      actor_uid TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      target_tenant_uid TEXT,
      impersonation_session_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      summary TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(user_uid, archived);
    CREATE INDEX IF NOT EXISTS idx_invoices_tenant_date ON invoices(user_uid, invoice_date DESC);
    CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status ON invoices(user_uid, status);
    CREATE INDEX IF NOT EXISTS idx_invoices_tenant_customer ON invoices(user_uid, customer_id);
    CREATE INDEX IF NOT EXISTS idx_quotations_tenant_date ON quotations(user_uid, quotation_date DESC);
    CREATE INDEX IF NOT EXISTS idx_quotations_tenant_status ON quotations(user_uid, status);
    CREATE INDEX IF NOT EXISTS idx_payments_tenant_date ON payments(user_uid, payment_date DESC);
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(user_uid, is_read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_impersonation_active ON impersonation_sessions(active, started_at DESC);
  `);

  seedInitialDatabase();
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysAheadIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seedInitialDatabase(): void {
  const now = new Date().toISOString();
  const existingSettings = db.prepare('SELECT id FROM platform_settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO platform_settings (
        id, allow_self_registration, platform_name, support_email, default_currency,
        default_invoice_prefix, default_quotation_prefix, default_subscription_monthly,
        maintenance_mode, updated_at
      ) VALUES (1, 1, 'DRONA', 'support@drona.in', 'INR', 'INV', 'QUO', 1999, 0, ?)
    `).run(now);
  }

  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (userCount.c > 0) return;

  const adminEmail = process.env.DRONA_ADMIN_EMAIL || 'admin@drona.in';
  const adminPassword = process.env.DRONA_ADMIN_PASSWORD || 'DronaAdmin@2026';

  const insertSeed = db.transaction(() => {
    const adminUid = generateId('usr');
    db.prepare(`
      INSERT INTO users (uid, email, password_hash, role, status, owner_name, business_name, phone, gstin, subscription_plan, subscription_amount, created_at, updated_at)
      VALUES (?, ?, ?, 'super_admin', 'active', 'Raghavendra Rao', 'DRONA Platform', '+91 98200 00001', '', 'Platform', 0, ?, ?)
    `).run(adminUid, adminEmail, hashPassword(adminPassword), now, now);

    // Tenant 1: Vanguard Tech Solutions Pvt Ltd
    const biz1Uid = generateId('usr');
    db.prepare(`
      INSERT INTO users (uid, email, password_hash, role, status, owner_name, business_name, phone, gstin, subscription_plan, subscription_amount, created_at, updated_at)
      VALUES (?, ?, ?, 'business', 'active', 'Arjun Mehta', 'Vanguard Tech Solutions Pvt Ltd', '+91 98204 51200', '27AABCV4812N1Z5', 'Enterprise', 4999, ?, ?)
    `).run(biz1Uid, 'arjun@vanguardtech.in', hashPassword('Vanguard@2026'), daysAgoIso(45) + 'T09:30:00.000Z', now);

    const biz1Profile = {
      businessName: 'Vanguard Tech Solutions Pvt Ltd',
      ownerName: 'Arjun Mehta',
      logoDataUrl: '',
      address: '402, Trade World Tower B, Lower Parel, Mumbai - 400013',
      email: 'billing@vanguardtech.in',
      phone: '+91 98204 51200',
      gstin: '27AABCV4812N1Z5',
      pan: 'AABCV4812N',
      state: 'Maharashtra',
      bankName: 'HDFC Bank Ltd',
      accountNumber: '50200048192044',
      ifsc: 'HDFC0000240',
      upiId: 'vanguardtech@hdfcbank',
      upiQrDataUrl: '',
      signatureLabel: 'For Vanguard Tech Solutions Pvt Ltd',
    };

    db.prepare(`
      INSERT INTO business_profiles (
        user_uid, business_name, owner_name, logo_data_url, address, email, phone, gstin, pan, state,
        bank_name, account_number, ifsc, upi_id, upi_qr_data_url, invoice_prefix, quotation_prefix,
        default_is_gst, default_tax_rate, default_tax_mode, default_payment_terms_days,
        default_invoice_template, default_quotation_template, terms_and_conditions, signature_label, updated_at
      ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'VTS', 'VQT', 1, 18, 'exclusive', 15, 'classic_gst', 'classic_gst', ?, ?, ?)
    `).run(
      biz1Uid,
      biz1Profile.businessName,
      biz1Profile.ownerName,
      biz1Profile.address,
      biz1Profile.email,
      biz1Profile.phone,
      biz1Profile.gstin,
      biz1Profile.pan,
      biz1Profile.state,
      biz1Profile.bankName,
      biz1Profile.accountNumber,
      biz1Profile.ifsc,
      biz1Profile.upiId,
      '1. Payment due within 15 days of invoice date.\n2. Delayed payments attract 1.5% monthly interest.\n3. Subject to Mumbai jurisdiction.',
      biz1Profile.signatureLabel,
      now
    );

    const cust1Id = generateId('cus');
    const cust2Id = generateId('cus');
    const cust3Id = generateId('cus');

    const customers1 = [
      {
        id: cust1Id,
        name: 'Vikramaditya Joshi',
        companyName: 'Sahyadri Logistics & Warehousing LLP',
        email: 'accounts@sahyadrilogistics.in',
        phone: '+91 98192 33410',
        gstin: '27AADFS9021C1Z2',
        billingAddress: 'Plot 14, MIDC Taloja, Navi Mumbai - 410208',
        shippingAddress: 'Plot 14, MIDC Taloja, Navi Mumbai - 410208',
        state: 'Maharashtra',
        notes: 'Key enterprise logistics retainer client.',
      },
      {
        id: cust2Id,
        name: 'Neha Kulkarni',
        companyName: 'Aether Cloud Systems Pvt Ltd',
        email: 'finance@aethercloud.io',
        phone: '+91 99001 77214',
        gstin: '29AABCA7719M1Z9',
        billingAddress: '88 Indiranagar 100 Feet Road, Bengaluru - 560038',
        shippingAddress: '88 Indiranagar 100 Feet Road, Bengaluru - 560038',
        state: 'Karnataka',
        notes: 'Inter-state SaaS consulting client (IGST).',
      },
      {
        id: cust3Id,
        name: 'Siddharth Bansal',
        companyName: 'Meridian Retail Ventures',
        email: 'ap@meridianretail.co.in',
        phone: '+91 98111 45092',
        gstin: '07AAACM1920P1Z8',
        billingAddress: 'B-22 Connaught Place, New Delhi - 110001',
        shippingAddress: 'B-22 Connaught Place, New Delhi - 110001',
        state: 'Delhi',
        notes: 'Quarterly POS integration rollout.',
      },
    ];

    for (const c of customers1) {
      db.prepare(`
        INSERT INTO customers (id, user_uid, name, company_name, email, phone, gstin, billing_address, shipping_address, state, notes, archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(c.id, biz1Uid, c.name, c.companyName, c.email, c.phone, c.gstin, c.billingAddress, c.shippingAddress, c.state, c.notes, now, now);
    }

    const year = new Date().getFullYear();

    let seededReceiptSeq = 0;

    // Helper to insert seeded invoices cleanly
    const seedInvoice = (opts: {
      seq: number;
      customer: (typeof customers1)[number];
      invoiceDate: string;
      dueDate: string;
      status: 'paid' | 'partially_paid' | 'unpaid' | 'overdue' | 'draft';
      paidRatio?: number;
      items: Array<{ name: string; description: string; hsnSac: string; quantity: number; unit: string; rate: number; discountType: 'percent' | 'fixed'; discountValue: number; taxRate: number }>;
    }) => {
      const invId = generateId('inv');
      const invNum = opts.status === 'draft' ? `DRAFT-${opts.seq}` : `VTS-${year}-${String(opts.seq).padStart(4, '0')}`;
      const calc = computeDocumentTotals({
        items: opts.items,
        businessState: biz1Profile.state,
        placeOfSupply: opts.customer.state,
        isGst: true,
        taxMode: 'exclusive',
        taxSupplyMode: 'auto',
        roundOffEnabled: true,
      });

      const paidPaise =
        opts.status === 'paid'
          ? calc.grandTotalPaise
          : opts.status === 'partially_paid'
            ? Math.round(calc.grandTotalPaise * (opts.paidRatio ?? 0.5))
            : 0;
      const balancePaise = Math.max(0, calc.grandTotalPaise - paidPaise);

      db.prepare(`
        INSERT INTO invoices (
          id, user_uid, invoice_number, status, customer_id, customer_snapshot_json, business_snapshot_json,
          invoice_date, due_date, payment_terms, reference_number, place_of_supply, is_gst, tax_mode,
          tax_supply_mode, is_inter_state, round_off_enabled, subtotal_paise, discount_paise, taxable_paise,
          cgst_paise, sgst_paise, igst_paise, total_tax_paise, round_off_paise, grand_total_paise,
          amount_paid_paise, balance_due_paise, amount_in_words, template_id, notes, terms,
          finalized_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Net 15', ?, ?, 1, 'exclusive', 'auto', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic_gst', 'Thank you for your business.', ?, ?, ?, ?)
      `).run(
        invId,
        biz1Uid,
        invNum,
        opts.status,
        opts.customer.id,
        JSON.stringify({
          id: opts.customer.id,
          name: opts.customer.name,
          companyName: opts.customer.companyName,
          email: opts.customer.email,
          phone: opts.customer.phone,
          gstin: opts.customer.gstin,
          billingAddress: opts.customer.billingAddress,
          shippingAddress: opts.customer.shippingAddress,
          state: opts.customer.state,
        }),
        JSON.stringify(biz1Profile),
        opts.invoiceDate,
        opts.dueDate,
        `PO-${year}-0${opts.seq}`,
        opts.customer.state,
        calc.isInterState ? 1 : 0,
        calc.subtotalPaise,
        calc.totalDiscountPaise,
        calc.taxableAmountPaise,
        calc.cgstTotalPaise,
        calc.sgstTotalPaise,
        calc.igstTotalPaise,
        calc.totalTaxPaise,
        calc.roundOffPaise,
        calc.grandTotalPaise,
        paidPaise,
        balancePaise,
        calc.amountInWords,
        '1. Payment due within 15 days of invoice date.\n2. Subject to Mumbai jurisdiction.',
        opts.status === 'draft' ? null : now,
        now,
        now
      );

      for (const item of calc.items) {
        db.prepare(`
          INSERT INTO invoice_items (
            id, invoice_id, user_uid, sort_order, name, description, hsn_sac, quantity, unit,
            rate_paise, discount_type, discount_value, tax_rate, gross_paise, discount_paise,
            taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId('itm'),
          invId,
          biz1Uid,
          item.sortOrder,
          item.name,
          item.description,
          item.hsnSac,
          item.quantity,
          item.unit,
          toPaise(item.rate),
          item.discountType,
          item.discountValue,
          item.taxRate,
          toPaise(item.grossAmount),
          toPaise(item.discountAmount),
          toPaise(item.taxableAmount),
          toPaise(item.cgstAmount),
          toPaise(item.sgstAmount),
          toPaise(item.igstAmount),
          toPaise(item.taxAmount),
          toPaise(item.totalAmount)
        );
      }

      if (paidPaise > 0) {
        seededReceiptSeq += 1;
        const payId = generateId('pay');
        db.prepare(`
          INSERT INTO payments (id, user_uid, invoice_id, customer_id, payment_date, amount_paise, payment_method, reference_id, notes, receipt_number, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'Bank Transfer', ?, 'NEFT Settlement', ?, ?)
        `).run(
          payId,
          biz1Uid,
          invId,
          opts.customer.id,
          opts.invoiceDate,
          paidPaise,
          `UTR${year}8821${opts.seq}`,
          `RCP-${year}-${String(seededReceiptSeq).padStart(4, '0')}`,
          now
        );
      }
    };

    seedInvoice({
      seq: 1,
      customer: customers1[0],
      invoiceDate: daysAgoIso(28),
      dueDate: daysAgoIso(13),
      status: 'paid',
      items: [
        { name: 'Warehouse Telemetry Suite License', description: 'Annual enterprise deployment across 4 hubs', hsnSac: '998314', quantity: 1, unit: 'Year', rate: 85000, discountType: 'percent', discountValue: 5, taxRate: 18 },
        { name: 'RFID Gateway Integration', description: 'On-site commissioning & API bridge', hsnSac: '998313', quantity: 4, unit: 'Hub', rate: 12000, discountType: 'fixed', discountValue: 0, taxRate: 18 },
      ],
    });

    seedInvoice({
      seq: 2,
      customer: customers1[1],
      invoiceDate: daysAgoIso(22),
      dueDate: daysAgoIso(7),
      status: 'overdue',
      items: [
        { name: 'Cloud Security Audit & Hardening', description: 'Kubernetes cluster & IAM compliance audit', hsnSac: '998315', quantity: 1, unit: 'Project', rate: 64000, discountType: 'percent', discountValue: 0, taxRate: 18 },
      ],
    });

    seedInvoice({
      seq: 3,
      customer: customers1[2],
      invoiceDate: daysAgoIso(10),
      dueDate: daysAheadIso(5),
      status: 'partially_paid',
      paidRatio: 0.6,
      items: [
        { name: 'Omnichannel POS Middleware', description: 'API connector for 18 retail stores', hsnSac: '998314', quantity: 18, unit: 'Store', rate: 4500, discountType: 'percent', discountValue: 10, taxRate: 18 },
      ],
    });

    seedInvoice({
      seq: 4,
      customer: customers1[0],
      invoiceDate: daysAgoIso(3),
      dueDate: daysAheadIso(12),
      status: 'unpaid',
      items: [
        { name: 'Q4 Managed Infrastructure Retainer', description: '24x7 SLA monitoring and incident response', hsnSac: '998316', quantity: 1, unit: 'Month', rate: 45000, discountType: 'percent', discountValue: 0, taxRate: 18 },
      ],
    });

    db.prepare(`INSERT INTO document_counters (user_uid, doc_type, year, last_seq) VALUES (?, 'INV', ?, 4)`).run(biz1Uid, year);
    db.prepare(`INSERT INTO document_counters (user_uid, doc_type, year, last_seq) VALUES (?, 'RCP', ?, ?)`).run(biz1Uid, year, seededReceiptSeq);

    // Seed 2 quotations for Business 1
    const quoItems = [
      { name: 'ERP GST Reconciliation Module', description: 'Automated GSTR-2B matching & vendor portal', hsnSac: '998314', quantity: 1, unit: 'License', rate: 120000, discountType: 'percent' as const, discountValue: 8, taxRate: 18 },
    ];
    const qCalc = computeDocumentTotals({
      items: quoItems,
      businessState: biz1Profile.state,
      placeOfSupply: customers1[1].state,
      isGst: true,
      taxMode: 'exclusive',
      taxSupplyMode: 'auto',
      roundOffEnabled: true,
    });
    const quoId1 = generateId('quo');
    db.prepare(`
      INSERT INTO quotations (
        id, user_uid, quotation_number, status, customer_id, customer_snapshot_json, business_snapshot_json,
        quotation_date, valid_until, reference_number, place_of_supply, is_gst, tax_mode, tax_supply_mode,
        is_inter_state, round_off_enabled, subtotal_paise, discount_paise, taxable_paise, cgst_paise,
        sgst_paise, igst_paise, total_tax_paise, round_off_paise, grand_total_paise, amount_in_words,
        template_id, notes, terms, created_at, updated_at
      ) VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?, ?, 'RFQ-2026-19', ?, 1, 'exclusive', 'auto', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic_gst', 'Ready for onboarding upon PO issuance.', 'Valid for 30 days.', ?, ?)
    `).run(
      quoId1,
      biz1Uid,
      `VQT-${year}-0001`,
      customers1[1].id,
      JSON.stringify({
        id: customers1[1].id,
        name: customers1[1].name,
        companyName: customers1[1].companyName,
        email: customers1[1].email,
        phone: customers1[1].phone,
        gstin: customers1[1].gstin,
        billingAddress: customers1[1].billingAddress,
        shippingAddress: customers1[1].shippingAddress,
        state: customers1[1].state,
      }),
      JSON.stringify(biz1Profile),
      daysAgoIso(5),
      daysAheadIso(25),
      customers1[1].state,
      qCalc.isInterState ? 1 : 0,
      qCalc.subtotalPaise,
      qCalc.totalDiscountPaise,
      qCalc.taxableAmountPaise,
      qCalc.cgstTotalPaise,
      qCalc.sgstTotalPaise,
      qCalc.igstTotalPaise,
      qCalc.totalTaxPaise,
      qCalc.roundOffPaise,
      qCalc.grandTotalPaise,
      qCalc.amountInWords,
      now,
      now
    );

    for (const item of qCalc.items) {
      db.prepare(`
        INSERT INTO quotation_items (
          id, quotation_id, user_uid, sort_order, name, description, hsn_sac, quantity, unit,
          rate_paise, discount_type, discount_value, tax_rate, gross_paise, discount_paise,
          taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId('qit'),
        quoId1,
        biz1Uid,
        item.sortOrder,
        item.name,
        item.description,
        item.hsnSac,
        item.quantity,
        item.unit,
        toPaise(item.rate),
        item.discountType,
        item.discountValue,
        item.taxRate,
        toPaise(item.grossAmount),
        toPaise(item.discountAmount),
        toPaise(item.taxableAmount),
        toPaise(item.cgstAmount),
        toPaise(item.sgstAmount),
        toPaise(item.igstAmount),
        toPaise(item.taxAmount),
        toPaise(item.totalAmount)
      );
    }

    db.prepare(`INSERT INTO document_counters (user_uid, doc_type, year, last_seq) VALUES (?, 'QUO', ?, 1)`).run(biz1Uid, year);

    // Tenant 2: Kaveri Precision Components
    const biz2Uid = generateId('usr');
    db.prepare(`
      INSERT INTO users (uid, email, password_hash, role, status, owner_name, business_name, phone, gstin, subscription_plan, subscription_amount, created_at, updated_at)
      VALUES (?, ?, ?, 'business', 'active', 'Meera Deshmukh', 'Kaveri Precision Components', '+91 97650 88321', '27AAACK5491H1Z1', 'Growth', 1999, ?, ?)
    `).run(biz2Uid, 'meera@kaveriprecision.in', hashPassword('Kaveri@2026'), daysAgoIso(20) + 'T11:00:00.000Z', now);

    db.prepare(`
      INSERT INTO business_profiles (
        user_uid, business_name, owner_name, logo_data_url, address, email, phone, gstin, pan, state,
        bank_name, account_number, ifsc, upi_id, upi_qr_data_url, invoice_prefix, quotation_prefix,
        default_is_gst, default_tax_rate, default_tax_mode, default_payment_terms_days,
        default_invoice_template, default_quotation_template, terms_and_conditions, signature_label, updated_at
      ) VALUES (?, 'Kaveri Precision Components', 'Meera Deshmukh', '', 'Plot C-42, Bhosari MIDC, Pune - 411026', 'accounts@kaveriprecision.in', '+91 97650 88321', '27AAACK5491H1Z1', 'AAACK5491H', 'Maharashtra', 'ICICI Bank', '004205009182', 'ICIC0000042', 'kaveriprecision@icici', '', 'KPC', 'KPQ', 1, 18, 'exclusive', 30, 'executive_minimal', 'executive_minimal', '1. Goods once sold will not be taken back.\n2. Subject to Pune jurisdiction.', 'For Kaveri Precision Components', ?)
    `).run(biz2Uid, now);

    const kCustId = generateId('cus');
    db.prepare(`
      INSERT INTO customers (id, user_uid, name, company_name, email, phone, gstin, billing_address, shipping_address, state, notes, archived, created_at, updated_at)
      VALUES (?, ?, 'Prakash Menon', 'Bharat Heavy Assemblies Ltd', 'procurement@bharatassemblies.in', '+91 98450 22911', '29AAACB8810D1Z4', 'Peenya Industrial Area Phase II, Bengaluru - 560058', 'Peenya Industrial Area Phase II, Bengaluru - 560058', 'Karnataka', 'OEM CNC parts buyer', 0, ?, ?)
    `).run(kCustId, biz2Uid, now, now);

    const kItems = [
      { name: 'CNC Machined Brass Flange', description: 'Tolerance +/- 0.02mm ISO-9001 batch', hsnSac: '741999', quantity: 250, unit: 'Pcs', rate: 340, discountType: 'percent' as const, discountValue: 0, taxRate: 18 },
    ];
    const kCalc = computeDocumentTotals({
      items: kItems,
      businessState: 'Maharashtra',
      placeOfSupply: 'Karnataka',
      isGst: true,
      taxMode: 'exclusive',
      taxSupplyMode: 'auto',
      roundOffEnabled: true,
    });
    const kInvId = generateId('inv');
    db.prepare(`
      INSERT INTO invoices (
        id, user_uid, invoice_number, status, customer_id, customer_snapshot_json, business_snapshot_json,
        invoice_date, due_date, payment_terms, reference_number, place_of_supply, is_gst, tax_mode,
        tax_supply_mode, is_inter_state, round_off_enabled, subtotal_paise, discount_paise, taxable_paise,
        cgst_paise, sgst_paise, igst_paise, total_tax_paise, round_off_paise, grand_total_paise,
        amount_paid_paise, balance_due_paise, amount_in_words, template_id, notes, terms,
        finalized_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'paid', ?, ?, ?, ?, ?, 'Net 30', 'PO-BHA-409', 'Karnataka', 1, 'exclusive', 'auto', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'executive_minimal', 'Batch inspected & dispatched.', 'Subject to Pune jurisdiction.', ?, ?, ?)
    `).run(
      kInvId,
      biz2Uid,
      `KPC-${year}-0001`,
      kCustId,
      JSON.stringify({
        id: kCustId,
        name: 'Prakash Menon',
        companyName: 'Bharat Heavy Assemblies Ltd',
        email: 'procurement@bharatassemblies.in',
        phone: '+91 98450 22911',
        gstin: '29AAACB8810D1Z4',
        billingAddress: 'Peenya Industrial Area Phase II, Bengaluru - 560058',
        shippingAddress: 'Peenya Industrial Area Phase II, Bengaluru - 560058',
        state: 'Karnataka',
      }),
      JSON.stringify({
        businessName: 'Kaveri Precision Components',
        ownerName: 'Meera Deshmukh',
        logoDataUrl: '',
        address: 'Plot C-42, Bhosari MIDC, Pune - 411026',
        email: 'accounts@kaveriprecision.in',
        phone: '+91 97650 88321',
        gstin: '27AAACK5491H1Z1',
        pan: 'AAACK5491H',
        state: 'Maharashtra',
        bankName: 'ICICI Bank',
        accountNumber: '004205009182',
        ifsc: 'ICIC0000042',
        upiId: 'kaveriprecision@icici',
        upiQrDataUrl: '',
        signatureLabel: 'For Kaveri Precision Components',
      }),
      daysAgoIso(12),
      daysAheadIso(18),
      kCalc.subtotalPaise,
      kCalc.totalDiscountPaise,
      kCalc.taxableAmountPaise,
      kCalc.cgstTotalPaise,
      kCalc.sgstTotalPaise,
      kCalc.igstTotalPaise,
      kCalc.totalTaxPaise,
      kCalc.roundOffPaise,
      kCalc.grandTotalPaise,
      kCalc.grandTotalPaise,
      kCalc.amountInWords,
      now,
      now,
      now
    );

    for (const item of kCalc.items) {
      db.prepare(`
        INSERT INTO invoice_items (
          id, invoice_id, user_uid, sort_order, name, description, hsn_sac, quantity, unit,
          rate_paise, discount_type, discount_value, tax_rate, gross_paise, discount_paise,
          taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId('itm'),
        kInvId,
        biz2Uid,
        item.sortOrder,
        item.name,
        item.description,
        item.hsnSac,
        item.quantity,
        item.unit,
        toPaise(item.rate),
        item.discountType,
        item.discountValue,
        item.taxRate,
        toPaise(item.grossAmount),
        toPaise(item.discountAmount),
        toPaise(item.taxableAmount),
        toPaise(item.cgstAmount),
        toPaise(item.sgstAmount),
        toPaise(item.igstAmount),
        toPaise(item.taxAmount),
        toPaise(item.totalAmount)
      );
    }

    db.prepare(`
      INSERT INTO payments (id, user_uid, invoice_id, customer_id, payment_date, amount_paise, payment_method, reference_id, notes, receipt_number, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'UPI', 'UPI2026991844', 'Full batch payment', ?, ?)
    `).run(generateId('pay'), biz2Uid, kInvId, kCustId, daysAgoIso(8), kCalc.grandTotalPaise, `RCP-${year}-0001`, now);

    db.prepare(`INSERT INTO document_counters (user_uid, doc_type, year, last_seq) VALUES (?, 'INV', ?, 1)`).run(biz2Uid, year);
    db.prepare(`INSERT INTO document_counters (user_uid, doc_type, year, last_seq) VALUES (?, 'RCP', ?, 1)`).run(biz2Uid, year);

    db.prepare(`
      INSERT INTO notifications (id, user_uid, type, title, message, entity_type, entity_id, is_read, email_status, whatsapp_status, created_at)
      VALUES (?, ?, 'invoice_overdue', 'Invoice overdue', 'Invoice VTS-${year}-0002 for Aether Cloud Systems Pvt Ltd is overdue.', 'invoice', null, 0, 'not_configured', 'not_configured', ?)
    `).run(generateId('ntf'), biz1Uid, now);

    db.prepare(`
      INSERT INTO activity_logs (id, actor_uid, actor_email, actor_role, target_tenant_uid, action, entity_type, summary, created_at)
      VALUES (?, ?, ?, 'super_admin', ?, 'PLATFORM_INITIALIZED', 'system', 'Initialized DRONA platform with initial admin and business workspaces.', ?)
    `).run(generateId('log'), adminUid, adminEmail, biz1Uid, now);
  });

  insertSeed();
}
