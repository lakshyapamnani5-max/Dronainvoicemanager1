import * as React from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  CreditCard,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  History,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  Moon,
  Plus,
  Receipt,
  Settings,
  ShieldAlert,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { notificationsApi, subscribeRtdbPath } from '../lib/api';
import { formatDateTime } from '../lib/utils';
import type { NotificationItem } from '../shared/types';
import { Button } from './ui/button';
import { useToast } from './ui/toast';

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CUSTOMER_NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Overview',
    items: [{ label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard }],
  },
  {
    group: 'Billing & Sales',
    items: [
      { label: 'Invoices', path: '/invoices', icon: Receipt },
      { label: 'Quotations', path: '/quotations', icon: FileCheck2 },
      { label: 'Customers', path: '/customers', icon: Users },
      { label: 'Payments', path: '/payments', icon: CreditCard },
    ],
  },
  {
    group: 'Reports',
    items: [
      { label: 'Outstanding Reports', path: '/reports/outstanding', icon: FileSpreadsheet },
      { label: 'Sales Reports', path: '/reports/sales', icon: BarChart3 },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { label: 'Business Profile', path: '/business-profile', icon: Building2 },
      { label: 'Invoice Templates', path: '/templates/invoices', icon: LayoutTemplate },
      { label: 'Quotation Templates', path: '/templates/quotations', icon: FileText },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
];

const ADMIN_NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Platform',
    items: [
      { label: 'Admin Dashboard', path: '/admin', icon: LayoutDashboard },
      { label: 'User Management', path: '/admin/users', icon: Users },
      { label: 'Platform Analytics', path: '/admin/analytics', icon: BarChart3 },
    ],
  },
  {
    group: 'Documents',
    items: [
      { label: 'Platform Invoices', path: '/admin/invoices', icon: Receipt },
      { label: 'Platform Quotations', path: '/admin/quotations', icon: FileCheck2 },
    ],
  },
  {
    group: 'Security & Audit',
    items: [
      { label: 'Activity Logs', path: '/admin/activity', icon: Activity },
      { label: 'Impersonation History', path: '/admin/impersonation', icon: History },
      { label: 'Platform Settings', path: '/admin/settings', icon: Settings },
    ],
  },
];

interface AppShellProps {
  currentPath: string;
  navigate: (path: string) => void;
  title: string;
  breadcrumbs: string[];
  primaryAction?: { label: string; onClick: () => void };
  children: React.ReactNode;
}

export function AppShell({
  currentPath,
  navigate,
  title,
  breadcrumbs,
  primaryAction,
  children,
}: AppShellProps) {
  const { session, logout, exitImpersonation } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notify } = useToast();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [exitingImp, setExitingImp] = React.useState(false);

  const isAdminView =
    session?.effectiveUser.role === 'super_admin' && !session.isImpersonating;
  const navGroups = isAdminView ? ADMIN_NAV : CUSTOMER_NAV;

  const loadNotifications = React.useCallback(async () => {
    if (!session || session.effectiveUser.role !== 'business') return;
    try {
      const res = await notificationsApi.list();
      setNotifications(res.notifications);
    } catch {
      // ignore transient
    }
  }, [session]);

  React.useEffect(() => {
    loadNotifications();
  }, [loadNotifications, currentPath]);

  React.useEffect(() => {
    if (!session || session.effectiveUser.role !== 'business') return;
    return subscribeRtdbPath(`tenants/${session.effectiveUser.uid}/notifications`, () => {
      loadNotifications();
    });
  }, [session?.effectiveUser.uid, session?.effectiveUser.role, loadNotifications]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleExitImpersonation = async () => {
    setExitingImp(true);
    try {
      await exitImpersonation();
      notify('success', 'Returned to Drona Admin Console');
      navigate('/admin/users');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to exit impersonation');
    } finally {
      setExitingImp(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // ignore
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      <div className="flex h-16 items-center justify-between px-5 border-b border-zinc-800/80">
        <button
          type="button"
          onClick={() => navigate(isAdminView ? '/admin' : '/dashboard')}
          className="flex items-center gap-2.5 text-left cursor-pointer focus-visible:outline-none"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F57C00] text-white font-display font-bold text-sm">
            D
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            DRONA
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden text-zinc-400 hover:text-white p-1"
          aria-label="Close navigation menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navGroups.map((group) => (
          <div key={group.group} className="space-y-1">
            <div className="px-3 pb-1 text-[11px] font-medium text-zinc-500">
              {group.group}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active =
                currentPath === item.path ||
                (item.path !== '/admin' &&
                  item.path !== '/dashboard' &&
                  currentPath.startsWith(item.path + '/'));
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    navigate(item.path);
                    setMobileOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#F57C00] text-white'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-800/80 p-4 space-y-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-zinc-100">
            {session?.effectiveUser.businessName || session?.effectiveUser.ownerName}
          </div>
          <div className="truncate text-xs text-zinc-400">
            {session?.effectiveUser.email}
          </div>
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors cursor-pointer"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 no-print">
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden no-print">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-64 max-w-[80vw] h-full">{sidebarContent}</div>
        </div>
      ) : null}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Persistent Admin Impersonation Warning Banner */}
        {session?.isImpersonating ? (
          <div className="no-print sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 bg-amber-500 px-4 py-2.5 text-zinc-950 shadow-sm">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>
                ADMIN MODE — You are viewing {session.effectiveUser.businessName}
              </span>
              <span className="hidden md:inline font-normal text-zinc-900/80">
                · Signed in as {session.actorUser.email}
              </span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={exitingImp}
              onClick={handleExitImpersonation}
              className="bg-zinc-950 text-white hover:bg-zinc-800 h-8 text-xs"
            >
              {exitingImp ? 'Exiting...' : 'Exit Customer Mode'}
            </Button>
          </div>
        ) : null}

        {/* Top Bar */}
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-zinc-200 bg-white/95 px-4 sm:px-6 backdrop-blur-xs dark:border-zinc-800 dark:bg-zinc-900/95">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
                {breadcrumbs.map((b, i) => (
                  <React.Fragment key={i}>
                    {i > 0 ? <span aria-hidden="true">/</span> : null}
                    <span className="truncate">{b}</span>
                  </React.Fragment>
                ))}
              </div>
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 truncate">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {session?.effectiveUser.role === 'business' ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((o) => !o)}
                  className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
                  aria-label="Notifications"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 ? (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-md bg-[#F57C00] px-1 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </button>

                {notifOpen ? (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setNotifOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 z-40 w-80 sm:w-96 rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                        <span className="text-sm font-semibold">Notifications</span>
                        {unreadCount > 0 ? (
                          <button
                            type="button"
                            onClick={handleMarkAllRead}
                            className="text-xs font-medium text-[#F57C00] hover:underline cursor-pointer"
                          >
                            Mark all read
                          </button>
                        ) : null}
                      </div>
                      <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                        {notifications.length === 0 ? (
                          <div className="p-6 text-center text-xs text-zinc-500">
                            No notifications yet.
                          </div>
                        ) : (
                          notifications.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={async () => {
                                if (!n.isRead) {
                                  await notificationsApi.markRead(n.id);
                                  setNotifications((prev) =>
                                    prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x))
                                  );
                                }
                                setNotifOpen(false);
                                if (n.entityType === 'invoice' && n.entityId) {
                                  navigate(`/invoices/${n.entityId}`);
                                } else if (n.entityType === 'quotation' && n.entityId) {
                                  navigate(`/quotations/${n.entityId}`);
                                } else if (n.entityType === 'payment') {
                                  navigate('/payments');
                                }
                              }}
                              className={`w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer ${
                                !n.isRead ? 'bg-orange-50/40 dark:bg-orange-950/10' : ''
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                  {n.title}
                                </span>
                                <span className="text-[11px] text-zinc-400">
                                  {formatDateTime(n.createdAt)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-snug">
                                {n.message}
                              </p>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle light or dark theme"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {primaryAction ? (
              <Button size="sm" onClick={primaryAction.onClick}>
                <Plus className="h-4 w-4" />
                {primaryAction.label}
              </Button>
            ) : null}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon = AlertTriangle,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white px-6 py-14 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      {actionLabel && onAction ? (
        <Button size="sm" className="mt-5" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
