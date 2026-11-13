import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';

const TEST_DB = '/tmp/drona_e2e_verify.db';
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB + suffix)) fs.unlinkSync(TEST_DB + suffix);
}
process.env.DRONA_DB_PATH = TEST_DB;

const { initializeDatabase } = await import('../server/db.ts');
const { apiRouter } = await import('../server/routes.ts');
const { buildUpiPaymentUri } = await import('../src/shared/gstCalculator.ts');

initializeDatabase();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', apiRouter);

const server = await new Promise<import('node:http').Server>((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}/api`;

async function req<T = unknown>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

try {
  // 1. Admin login
  const adminLogin = await req<{ token: string; session: { actorUser: { role: string } } }>(
    '/auth/login',
    {
      method: 'POST',
      body: { email: 'admin@drona.in', password: 'DronaAdmin@2026', portal: 'admin' },
    }
  );
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.data.session.actorUser.role, 'super_admin');
  const adminToken = adminLogin.data.token;

  // 2. Customer login (and reject customer on admin portal)
  const badAdminAttempt = await req('/auth/login', {
    method: 'POST',
    body: { email: 'arjun@vanguardtech.in', password: 'Vanguard@2026', portal: 'admin' },
  });
  assert.equal(badAdminAttempt.status, 403);

  const biz1Login = await req<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'arjun@vanguardtech.in', password: 'Vanguard@2026' },
  });
  assert.equal(biz1Login.status, 200);
  const biz1Token = biz1Login.data.token;

  const biz2Login = await req<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'meera@kaveriprecision.in', password: 'Kaveri@2026' },
  });
  assert.equal(biz2Login.status, 200);
  const biz2Token = biz2Login.data.token;

  // 3. Unauthorized access checks
  const unauth = await req('/invoices');
  assert.equal(unauth.status, 401);

  const custOnAdmin = await req('/admin/users', { token: biz1Token });
  assert.equal(custOnAdmin.status, 403);

  const custImpersonate = await req('/admin/impersonate/usr_fake', {
    method: 'POST',
    token: biz1Token,
  });
  assert.equal(custImpersonate.status, 403);

  // 4. Tenant Isolation check
  const biz1Invs = await req<{ invoices: Array<{ id: string }> }>('/invoices', {
    token: biz1Token,
  });
  assert.equal(biz1Invs.status, 200);
  assert.ok(biz1Invs.data.invoices.length >= 4);
  const biz1InvoiceId = biz1Invs.data.invoices[0].id;

  const crossTenantRead = await req(`/invoices/${biz1InvoiceId}`, { token: biz2Token });
  assert.equal(crossTenantRead.status, 404);

  // 5. Admin creates new customer account, toggles deactivation & activation
  const createdBiz = await req<{ user: { uid: string } }>('/admin/users', {
    method: 'POST',
    token: adminToken,
    body: {
      businessName: 'Deccan Precision Systems',
      ownerName: 'Kiran Nair',
      email: 'kiran@deccanprecision.in',
      password: 'Deccan@2026',
      phone: '+91 98220 11223',
      gstin: '27AAACD1122F1Z9',
      state: 'Maharashtra',
      subscriptionPlan: 'Growth',
      subscriptionAmount: 1999,
    },
  });
  assert.equal(createdBiz.status, 201);
  const newUid = createdBiz.data.user.uid;

  const deactivate = await req(`/admin/users/${newUid}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'inactive' },
  });
  assert.equal(deactivate.status, 200);

  const inactiveLogin = await req('/auth/login', {
    method: 'POST',
    body: { email: 'kiran@deccanprecision.in', password: 'Deccan@2026' },
  });
  assert.equal(inactiveLogin.status, 403);

  await req(`/admin/users/${newUid}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'active' },
  });

  // 6. Invoice draft -> edit -> finalize -> immutability -> partial payments
  const custs = await req<{ customers: Array<{ id: string }> }>('/customers', {
    token: biz1Token,
  });
  const custId = custs.data.customers[0].id;

  const draftInv = await req<{ invoice: { id: string; status: string; invoiceNumber: string } }>(
    '/invoices',
    {
      method: 'POST',
      token: biz1Token,
      body: {
        customerId: custId,
        invoiceDate: '2026-11-13',
        dueDate: '2026-11-28',
        placeOfSupply: 'Maharashtra',
        isGst: true,
        taxMode: 'exclusive',
        taxSupplyMode: 'auto',
        roundOffEnabled: true,
        saveAsDraft: true,
        items: [
          {
            name: 'Consulting Retainer',
            description: 'Monthly advisory',
            hsnSac: '998311',
            quantity: 2,
            unit: 'Sprint',
            rate: 10000,
            discountType: 'percent',
            discountValue: 10,
            taxRate: 18,
          },
        ],
      },
    }
  );
  assert.equal(draftInv.status, 201);
  assert.equal(draftInv.data.invoice.status, 'draft');

  const finalized = await req<{
    invoice: { id: string; status: string; invoiceNumber: string; grandTotal: number; cgstTotal: number; sgstTotal: number };
  }>(`/invoices/${draftInv.data.invoice.id}/finalize`, {
    method: 'POST',
    token: biz1Token,
  });
  assert.equal(finalized.status, 200);
  assert.equal(finalized.data.invoice.status, 'unpaid');
  assert.equal(finalized.data.invoice.grandTotal, 21240); // (20000 - 2000) * 1.18 = 21240
  assert.equal(finalized.data.invoice.cgstTotal, 1620);
  assert.equal(finalized.data.invoice.sgstTotal, 1620);

  // Attempt to overwrite finalized invoice must fail
  const overwriteAttempt = await req(`/invoices/${finalized.data.invoice.id}`, {
    method: 'PUT',
    token: biz1Token,
    body: {
      customerId: custId,
      isGst: true,
      taxMode: 'exclusive',
      taxSupplyMode: 'auto',
      roundOffEnabled: true,
      items: [{ name: 'Tampered', description: '', hsnSac: '', quantity: 1, unit: 'Nos', rate: 1, discountType: 'percent', discountValue: 0, taxRate: 0 }],
    },
  });
  assert.equal(overwriteAttempt.status, 400);

  // Partial payment + duplicate ref check + overpayment check
  const p1 = await req('/payments', {
    method: 'POST',
    token: biz1Token,
    body: {
      invoiceId: finalized.data.invoice.id,
      paymentDate: '2026-11-13',
      amount: 10000,
      paymentMethod: 'UPI',
      referenceId: 'UPI-TEST-9901',
    },
  });
  assert.equal(p1.status, 201);

  const dupRef = await req('/payments', {
    method: 'POST',
    token: biz1Token,
    body: {
      invoiceId: finalized.data.invoice.id,
      paymentDate: '2026-11-13',
      amount: 1000,
      paymentMethod: 'UPI',
      referenceId: 'UPI-TEST-9901',
    },
  });
  assert.equal(dupRef.status, 400);

  const overpay = await req('/payments', {
    method: 'POST',
    token: biz1Token,
    body: {
      invoiceId: finalized.data.invoice.id,
      paymentDate: '2026-11-13',
      amount: 15000,
      paymentMethod: 'Cash',
    },
  });
  assert.equal(overpay.status, 400);

  const invAfterPartial = await req<{ invoice: { status: string; amountPaid: number; balanceDue: number } }>(
    `/invoices/${finalized.data.invoice.id}`,
    { token: biz1Token }
  );
  assert.equal(invAfterPartial.data.invoice.status, 'partially_paid');
  assert.equal(invAfterPartial.data.invoice.amountPaid, 10000);
  assert.equal(invAfterPartial.data.invoice.balanceDue, 11240);

  // 7. Concurrent invoice creation numbering uniqueness
  const concurrentResults = await Promise.all(
    Array.from({ length: 5 }).map((_, idx) =>
      req<{ invoice: { invoiceNumber: string } }>('/invoices', {
        method: 'POST',
        token: biz1Token,
        body: {
          customerId: custId,
          invoiceDate: '2026-11-13',
          dueDate: '2026-11-28',
          placeOfSupply: 'Karnataka',
          isGst: true,
          taxMode: 'exclusive',
          taxSupplyMode: 'auto',
          roundOffEnabled: true,
          saveAsDraft: false,
          items: [
            {
              name: `Batch Item ${idx}`,
              description: '',
              hsnSac: '998314',
              quantity: 1,
              unit: 'Nos',
              rate: 5000,
              discountType: 'percent',
              discountValue: 0,
              taxRate: 18,
            },
          ],
        },
      })
    )
  );
  const numbers = new Set(concurrentResults.map((r) => r.data.invoice.invoiceNumber));
  assert.equal(numbers.size, 5, 'Concurrent invoice numbers must all be unique');

  // 8. Quotation creation & atomic conversion to invoice (prevent duplicate conversion)
  const quo = await req<{ quotation: { id: string } }>('/quotations', {
    method: 'POST',
    token: biz1Token,
    body: {
      customerId: custId,
      quotationDate: '2026-11-13',
      validUntil: '2026-12-13',
      placeOfSupply: 'Maharashtra',
      isGst: true,
      taxMode: 'exclusive',
      taxSupplyMode: 'auto',
      roundOffEnabled: true,
      saveAsDraft: false,
      items: [
        {
          name: 'Annual Support Plan',
          description: '',
          hsnSac: '998314',
          quantity: 1,
          unit: 'Year',
          rate: 30000,
          discountType: 'fixed',
          discountValue: 2000,
          taxRate: 18,
        },
      ],
    },
  });
  assert.equal(quo.status, 201);

  const conv1 = await req<{ invoice: { id: string; sourceQuotationId: string } }>(
    `/quotations/${quo.data.quotation.id}/convert`,
    { method: 'POST', token: biz1Token }
  );
  assert.equal(conv1.status, 201);
  assert.equal(conv1.data.invoice.sourceQuotationId, quo.data.quotation.id);

  const convDup = await req(`/quotations/${quo.data.quotation.id}/convert`, {
    method: 'POST',
    token: biz1Token,
  });
  assert.equal(convDup.status, 400);

  // 9. Admin impersonation ("Login as Customer") + Audit Trail + Exit
  const impStart = await req<{ session: { isImpersonating: boolean; effectiveUser: { uid: string } } }>(
    `/admin/impersonate/${newUid}`,
    { method: 'POST', token: adminToken }
  );
  assert.equal(impStart.status, 200);
  assert.equal(impStart.data.session.isImpersonating, true);
  assert.equal(impStart.data.session.effectiveUser.uid, newUid);

  // While impersonating, admin creates a customer inside target workspace
  const impCust = await req<{ customer: { id: string } }>('/customers', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Impersonated Test Client', state: 'Maharashtra' },
  });
  assert.equal(impCust.status, 201);

  const impExit = await req<{ session: { isImpersonating: boolean; effectiveUser: { role: string } } }>(
    '/admin/exit-impersonation',
    { method: 'POST', token: adminToken }
  );
  assert.equal(impExit.status, 200);
  assert.equal(impExit.data.session.isImpersonating, false);
  assert.equal(impExit.data.session.effectiveUser.role, 'super_admin');

  // Verify impersonation history & audit logs captured the impersonated action
  const impHistory = await req<{ sessions: Array<{ targetUid: string; active: boolean }> }>(
    '/admin/impersonation-history',
    { token: adminToken }
  );
  assert.equal(impHistory.status, 200);
  assert.ok(impHistory.data.sessions.some((s) => s.targetUid === newUid && !s.active));

  const logs = await req<{ logs: Array<{ action: string; impersonationSessionId: string | null }> }>(
    '/admin/activity-logs',
    { token: adminToken }
  );
  assert.ok(
    logs.data.logs.some(
      (l) => l.action === 'CUSTOMER_CREATED' && l.impersonationSessionId !== null
    )
  );

  // 10. Outstanding report & Admin dashboard separation of GMV vs Drona MRR
  const outRep = await req<{ rows: Array<{ outstandingBalance: number }> }>(
    '/reports/outstanding',
    { token: biz1Token }
  );
  assert.equal(outRep.status, 200);
  assert.ok(outRep.data.rows.length > 0);

  const adminDash = await req<{
    summary: { platformInvoicedValue: number; dronaSubscriptionRevenue: number };
  }>('/admin/dashboard', { token: adminToken });
  assert.equal(adminDash.status, 200);
  assert.ok(
    adminDash.data.summary.platformInvoicedValue > adminDash.data.summary.dronaSubscriptionRevenue
  );

  // 11. Invoice logo + UPI ID upload override, profile persistence & exact UPI QR URI matching
  const tinyPngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const testUpiId = 'vanguard.pay@okicici';
  const logoInvRes = await req<{
    invoice: {
      id: string;
      invoiceNumber: string;
      grandTotal: number;
      businessSnapshot: { logoDataUrl: string; upiId: string; businessName: string };
    };
  }>('/invoices', {
    method: 'POST',
    token: biz1Token,
    body: {
      customerId: custId,
      invoiceDate: '2026-11-13',
      dueDate: '2026-11-28',
      placeOfSupply: 'Maharashtra',
      isGst: true,
      taxMode: 'exclusive',
      taxSupplyMode: 'auto',
      roundOffEnabled: true,
      saveAsDraft: false,
      logoDataUrl: tinyPngDataUrl,
      saveLogoToProfile: true,
      upiId: testUpiId,
      saveUpiToProfile: true,
      items: [
        {
          name: 'Branded Consulting',
          description: '',
          hsnSac: '998314',
          quantity: 1,
          unit: 'Nos',
          rate: 2500,
          discountType: 'percent',
          discountValue: 0,
          taxRate: 18,
        },
      ],
    },
  });
  assert.equal(logoInvRes.status, 201);
  assert.equal(logoInvRes.data.invoice.businessSnapshot.logoDataUrl, tinyPngDataUrl);
  assert.equal(logoInvRes.data.invoice.businessSnapshot.upiId, testUpiId);
  assert.equal(logoInvRes.data.invoice.grandTotal, 2950);

  const upiUri = buildUpiPaymentUri({
    upiId: logoInvRes.data.invoice.businessSnapshot.upiId,
    payeeName: logoInvRes.data.invoice.businessSnapshot.businessName,
    amount: logoInvRes.data.invoice.grandTotal,
    docNumber: logoInvRes.data.invoice.invoiceNumber,
  });
  assert.ok(upiUri.includes(`pa=${encodeURIComponent(testUpiId)}`));
  assert.ok(upiUri.includes('am=2950.00'));
  assert.ok(upiUri.includes('cu=INR'));

  const profAfterLogo = await req<{ profile: { logoDataUrl: string; upiId: string } }>(
    '/business/profile',
    { token: biz1Token }
  );
  assert.equal(profAfterLogo.status, 200);
  assert.equal(profAfterLogo.data.profile.logoDataUrl, tinyPngDataUrl);
  assert.equal(profAfterLogo.data.profile.upiId, testUpiId);

  console.log('ALL DRONA E2E VERIFICATION TESTS PASSED (11/11 SUITES)');
} finally {
  server.close();
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(TEST_DB + suffix)) fs.unlinkSync(TEST_DB + suffix);
  }
}
