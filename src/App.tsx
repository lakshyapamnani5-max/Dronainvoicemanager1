import * as React from 'react';
import { AppShell } from './components/AppShell';
import { DocumentEditor } from './components/DocumentEditor';
import { ToastProvider } from './components/ui/toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AdminDashboardPage } from './pages/admin/AdminDashboard';
import {
  AdminActivityLogsPage,
  AdminImpersonationHistoryPage,
  AdminPlatformSettingsPage,
  PlatformInvoicesPage,
  PlatformQuotationsPage,
} from './pages/admin/AdminMonitoringPages';
import {
  AdminCreateUserPage,
  AdminUserDetailsPage,
  AdminUsersListPage,
} from './pages/admin/AdminUsersPages';
import { AuthPages } from './pages/auth/AuthPages';
import { CustomerDashboard } from './pages/customer/CustomerDashboard';
import { CustomerDetailsPage, CustomersPage } from './pages/customer/CustomersPage';
import { InvoiceDetailsPage, InvoicesListPage } from './pages/customer/InvoicesPages';
import { PaymentsPage } from './pages/customer/PaymentsPage';
import { QuotationDetailsPage, QuotationsListPage } from './pages/customer/QuotationsPages';
import { OutstandingReportPage, SalesReportsPage } from './pages/customer/ReportsPages';
import {
  BusinessProfilePage,
  CustomerSettingsPage,
  TemplatesGalleryPage,
} from './pages/customer/WorkspaceSettingsPages';

function useRouter() {
  const [path, setPath] = React.useState<string>(() => window.location.pathname || '/');

  React.useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = React.useCallback((nextPath: string) => {
    if (nextPath !== window.location.pathname) {
      window.history.pushState({}, '', nextPath);
    }
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  return { path, navigate };
}

function AppRouter() {
  const { path, navigate } = useRouter();
  const { session, loading } = useAuth();

  const publicPaths = ['/login', '/admin/login', '/register', '/forgot-password'];
  const isPublicPath = publicPaths.includes(path);

  React.useEffect(() => {
    if (loading) return;
    if (!session && !isPublicPath) {
      navigate(path.startsWith('/admin') ? '/admin/login' : '/login');
      return;
    }
    if (session && (path === '/' || isPublicPath)) {
      const target =
        session.effectiveUser.role === 'super_admin' && !session.isImpersonating
          ? '/admin'
          : '/dashboard';
      navigate(target);
    }
  }, [loading, session, path, isPublicPath, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex items-center gap-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
          <div className="h-8 w-8 rounded-lg bg-[#F57C00] text-white flex items-center justify-center font-display font-bold">
            D
          </div>
          <span>Loading DRONA Workspace...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    if (path === '/admin/login') return <AuthPages mode="admin-login" navigate={navigate} />;
    if (path === '/register') return <AuthPages mode="register" navigate={navigate} />;
    if (path === '/forgot-password') return <AuthPages mode="forgot" navigate={navigate} />;
    return <AuthPages mode="login" navigate={navigate} />;
  }

  const isAdminSession =
    session.effectiveUser.role === 'super_admin' && !session.isImpersonating;

  // Enforce strict client-side route boundary matching backend RBAC
  if (path.startsWith('/admin') && !isAdminSession) {
    navigate('/dashboard');
    return null;
  }
  if (!path.startsWith('/admin') && isAdminSession) {
    navigate('/admin');
    return null;
  }

  // ==================== ADMIN ROUTES ====================
  if (isAdminSession) {
    if (path === '/admin') {
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="Admin Dashboard"
          breadcrumbs={['DRONA Platform', 'Dashboard']}
          primaryAction={{
            label: 'Create User',
            onClick: () => navigate('/admin/users/new'),
          }}
        >
          <AdminDashboardPage navigate={navigate} />
        </AppShell>
      );
    }
    if (path === '/admin/analytics') {
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="Platform Analytics"
          breadcrumbs={['DRONA Platform', 'Analytics']}
        >
          <AdminDashboardPage navigate={navigate} analyticsOnly />
        </AppShell>
      );
    }
    if (path === '/admin/users') {
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="User Management"
          breadcrumbs={['DRONA Platform', 'Users']}
          primaryAction={{
            label: 'Create User',
            onClick: () => navigate('/admin/users/new'),
          }}
        >
          <AdminUsersListPage navigate={navigate} />
        </AppShell>
      );
    }
    if (path === '/admin/users/new') {
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="Create Customer Account"
          breadcrumbs={['DRONA Platform', 'Users', 'Create']}
        >
          <AdminCreateUserPage navigate={navigate} />
        </AppShell>
      );
    }
    if (path.startsWith('/admin/users/')) {
      const uid = path.replace('/admin/users/', '');
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="Business Account Details"
          breadcrumbs={['DRONA Platform', 'Users', uid]}
        >
          <AdminUserDetailsPage uid={uid} navigate={navigate} />
        </AppShell>
      );
    }
    if (path === '/admin/invoices') {
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="Platform Invoices"
          breadcrumbs={['DRONA Platform', 'Invoices']}
        >
          <PlatformInvoicesPage navigate={navigate} />
        </AppShell>
      );
    }
    if (path === '/admin/quotations') {
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="Platform Quotations"
          breadcrumbs={['DRONA Platform', 'Quotations']}
        >
          <PlatformQuotationsPage navigate={navigate} />
        </AppShell>
      );
    }
    if (path === '/admin/activity') {
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="Activity Logs"
          breadcrumbs={['DRONA Platform', 'Security', 'Activity Logs']}
        >
          <AdminActivityLogsPage />
        </AppShell>
      );
    }
    if (path === '/admin/impersonation') {
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="Impersonation History"
          breadcrumbs={['DRONA Platform', 'Security', 'Impersonation']}
        >
          <AdminImpersonationHistoryPage />
        </AppShell>
      );
    }
    if (path === '/admin/settings') {
      return (
        <AppShell
          currentPath={path}
          navigate={navigate}
          title="Platform Settings"
          breadcrumbs={['DRONA Platform', 'Settings']}
        >
          <AdminPlatformSettingsPage />
        </AppShell>
      );
    }
    return (
      <AppShell
        currentPath="/admin"
        navigate={navigate}
        title="Admin Dashboard"
        breadcrumbs={['DRONA Platform', 'Dashboard']}
      >
        <AdminDashboardPage navigate={navigate} />
      </AppShell>
    );
  }

  // ==================== CUSTOMER WORKSPACE ROUTES ====================
  const bizName = session.effectiveUser.businessName || 'Workspace';

  if (path === '/dashboard') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Sales & Billing Dashboard"
        breadcrumbs={[bizName, 'Dashboard']}
        primaryAction={{
          label: 'New Invoice',
          onClick: () => navigate('/invoices/new'),
        }}
      >
        <CustomerDashboard navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/invoices') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Invoices"
        breadcrumbs={[bizName, 'Invoices']}
        primaryAction={{
          label: 'Create Invoice',
          onClick: () => navigate('/invoices/new'),
        }}
      >
        <InvoicesListPage navigate={navigate} />
      </AppShell>
    );
  }
  if (path === '/invoices/new') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Create Invoice"
        breadcrumbs={[bizName, 'Invoices', 'Create']}
      >
        <DocumentEditor docType="invoice" navigate={navigate} />
      </AppShell>
    );
  }
  if (path.startsWith('/invoices/') && path.endsWith('/edit')) {
    const id = path.replace('/invoices/', '').replace('/edit', '');
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Edit Draft Invoice"
        breadcrumbs={[bizName, 'Invoices', 'Edit Draft']}
      >
        <DocumentEditor docType="invoice" editId={id} navigate={navigate} />
      </AppShell>
    );
  }
  if (path.startsWith('/invoices/')) {
    const id = path.replace('/invoices/', '');
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Invoice Details"
        breadcrumbs={[bizName, 'Invoices', id]}
      >
        <InvoiceDetailsPage invoiceId={id} navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/quotations') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Quotations"
        breadcrumbs={[bizName, 'Quotations']}
        primaryAction={{
          label: 'Create Quotation',
          onClick: () => navigate('/quotations/new'),
        }}
      >
        <QuotationsListPage navigate={navigate} />
      </AppShell>
    );
  }
  if (path === '/quotations/new') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Create Quotation"
        breadcrumbs={[bizName, 'Quotations', 'Create']}
      >
        <DocumentEditor docType="quotation" navigate={navigate} />
      </AppShell>
    );
  }
  if (path.startsWith('/quotations/') && path.endsWith('/edit')) {
    const id = path.replace('/quotations/', '').replace('/edit', '');
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Edit Draft Quotation"
        breadcrumbs={[bizName, 'Quotations', 'Edit Draft']}
      >
        <DocumentEditor docType="quotation" editId={id} navigate={navigate} />
      </AppShell>
    );
  }
  if (path.startsWith('/quotations/')) {
    const id = path.replace('/quotations/', '');
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Quotation Details"
        breadcrumbs={[bizName, 'Quotations', id]}
      >
        <QuotationDetailsPage quotationId={id} navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/customers') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Customers"
        breadcrumbs={[bizName, 'Customers']}
      >
        <CustomersPage navigate={navigate} />
      </AppShell>
    );
  }
  if (path.startsWith('/customers/')) {
    const id = path.replace('/customers/', '');
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Customer Ledger"
        breadcrumbs={[bizName, 'Customers', 'Ledger']}
      >
        <CustomerDetailsPage customerId={id} navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/payments') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Payments"
        breadcrumbs={[bizName, 'Payments']}
      >
        <PaymentsPage navigate={navigate} />
      </AppShell>
    );
  }

  if (path === '/reports/outstanding') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Outstanding Reports"
        breadcrumbs={[bizName, 'Reports', 'Outstanding']}
      >
        <OutstandingReportPage navigate={navigate} />
      </AppShell>
    );
  }
  if (path === '/reports/sales') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Sales Reports"
        breadcrumbs={[bizName, 'Reports', 'Sales']}
      >
        <SalesReportsPage />
      </AppShell>
    );
  }

  if (path === '/business-profile') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Business Profile & Branding"
        breadcrumbs={[bizName, 'Business Profile']}
      >
        <BusinessProfilePage />
      </AppShell>
    );
  }
  if (path === '/templates/invoices') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Invoice Templates"
        breadcrumbs={[bizName, 'Templates', 'Invoices']}
      >
        <TemplatesGalleryPage docType="invoice" />
      </AppShell>
    );
  }
  if (path === '/templates/quotations') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Quotation Templates"
        breadcrumbs={[bizName, 'Templates', 'Quotations']}
      >
        <TemplatesGalleryPage docType="quotation" />
      </AppShell>
    );
  }
  if (path === '/settings') {
    return (
      <AppShell
        currentPath={path}
        navigate={navigate}
        title="Workspace Settings"
        breadcrumbs={[bizName, 'Settings']}
      >
        <CustomerSettingsPage />
      </AppShell>
    );
  }

  return (
    <AppShell
      currentPath="/dashboard"
      navigate={navigate}
      title="Sales & Billing Dashboard"
      breadcrumbs={[bizName, 'Dashboard']}
      primaryAction={{
        label: 'New Invoice',
        onClick: () => navigate('/invoices/new'),
      }}
    >
      <CustomerDashboard navigate={navigate} />
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
