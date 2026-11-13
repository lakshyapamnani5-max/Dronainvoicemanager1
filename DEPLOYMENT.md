# DRONA Invoice Manager — Architecture & Deployment Guide

## 1. Architecture Overview
DRONA is a multi-tenant GST Invoice, Quotation, Payment Collection, and Sales Analytics SaaS platform powered by **Firebase Authentication** and **Firebase Realtime Database** (zero Firestore).

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 + Recharts + jsPDF + jsPDF-AutoTable + QRCode + SheetJS (`xlsx`).
- **Authentication**: Firebase Authentication (`firebase/auth`) with persistent sessions, self-registration toggle, and Firebase password reset emails.
- **Database**: Firebase Realtime Database (`dronainvoicehub-default-rtdb.firebaseio.com`, `firebase/database`) with real-time `onValue` subscriptions across all Customer and Drona Admin tabs.
- **Financial Precision**: All monetary amounts are computed in integer **paise** (`toPaise` / `fromPaise`) via `src/shared/gstCalculator.ts`.

## 2. Firebase Realtime Database Structure & Tenant Isolation
Every tenant workspace is strictly isolated under `tenants/$uid` and protected by `/database.rules.json`:
- `platformSettings`: Global platform flags (`allowSelfRegistration`, `maintenanceMode`, default prefixes, pricing)
- `users/$uid`: User identity (`super_admin` or `business`), active/inactive status, subscription plan & fee
- `businessProfiles/$uid`: Business logo, GSTIN, PAN, state, bank/UPI details, prefixes, default A4 templates
- `tenants/$uid/counters`: Atomic `runTransaction` year-based counters (`INV_YYYY`, `QUO_YYYY`, `RCP_YYYY`)
- `tenants/$uid/customers`: Tenant CRM with archive-preserving financial integrity
- `tenants/$uid/invoices`: GST/Non-GST invoices (immutable once finalized; cancellation preserves audit trail)
- `tenants/$uid/quotations`: Quotations with one-time conversion to invoices
- `tenants/$uid/payments`: Payment ledger with duplicate reference protection and overpayment guard
- `tenants/$uid/notifications`: Real-time tenant notification feed
- `tenants/$uid/activityLogs` & `activityLogs`: Immutable audit trail tagging impersonated mutations
- `impersonationSessions`: Bounded Super Admin impersonation sessions ("Login as Customer")

## 3. Publishing Realtime Database Security Rules
In the Firebase Console for project **`dronainvoicehub`**:
1. Enable **Authentication → Sign-in method → Email/Password**.
2. Create / enable **Realtime Database** (`https://dronainvoicehub-default-rtdb.firebaseio.com`).
3. Publish the contents of `/database.rules.json` in **Realtime Database → Rules**.

## 4. Build, Verification & Start
```bash
npm install
npm run lint     # TypeScript strict check
npm run build    # Vite production bundle -> dist/
npm start        # Serves production app on port 3000
```

## 5. Deploying to Vercel
The repository includes `/vercel.json` configured for Vite (`dist/` output) with SPA history fallback rewrites (`/(.*) -> /index.html`) for all customer and admin routes (`/dashboard`, `/invoices/*`, `/quotations/*`, `/customers/*`, `/admin/*`).

1. Import the repository in Vercel or run `vercel --prod`.
2. Vercel will automatically detect `framework: vite`, run `npm run build`, and serve `dist/`.
3. Add your production Vercel domain (`*.vercel.app` or custom domain) to **Firebase Console → Authentication → Settings → Authorized domains**.

