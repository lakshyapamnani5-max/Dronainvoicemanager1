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
  Home,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  Moon,
  Package,
  Plus,
  Receipt,
  Settings,
  ShieldAlert,
  Sun,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { notificationsApi, subscribeRtdbPath } from '../lib/api';
import { formatDateTime } from '../lib/utils';
import type { NotificationItem } from '../shared/types';
import { PWAInstallButton } from './PWAComponents';
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
      { label: 'Rate Card', path: '/rate-card', icon: Package },
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
  const [moreSheetOpen, setMoreSheetOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [exitingImp, setExitingImp] = React.useState(false);
  const [inputFocused, setInputFocused] = React.useState(false);

  const isAdminView =
    session?.effectiveUser.role === 'super_admin' && !session.isImpersonating;
  const navGroups = isAdminView ? ADMIN_NAV : CUSTOMER_NAV;

  // Hide mobile bottom bar while typing on small touch screens so soft keyboard never overlaps nav
  React.useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA') return true;
      if (tag === 'INPUT') {
        const type = (el as HTMLInputElement).type;
        return !['checkbox', 'radio', 'file', 'button', 'submit'].includes(type);
      }
      return el.isContentEditable;
    };

    const onFocusIn = (e: FocusEvent) => {
      if (window.innerWidth < 1024 && isEditable(e.target)) {
        setInputFocused(true);
      }
    };
    const onFocusOut = () => {
      setTimeout(() => {
        if (!isEditable(document.activeElement)) {
          setInputFocused(false);
        }
      }, 120);
    };

    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  React.useEffect(() => {
    setMoreSheetOpen(false);
    setMobileOpen(false);
    setNotifOpen(false);
  }, [currentPath]);

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

  const isNavItemActive = (itemPath: string) =>
    currentPath === itemPath ||
    (itemPath !== '/admin' &&
      itemPath !== '/dashboard' &&
      currentPath.startsWith(itemPath + '/'));

  const mobileBottomPrimary = isAdminView
    ? [
        { label: 'Home', path: '/admin', icon: Home },
        { label: 'Businesses', path: '/admin/users', icon: Users },
        { label: 'Invoices', path: '/admin/invoices', icon: Receipt },
        { label: 'Activity', path: '/admin/activity', icon: Activity },
      ]
    : [
        { label: 'Home', path: '/dashboard', icon: Home },
        { label: 'Invoices', path: '/invoices', icon: Receipt },
        { label: 'Quotes', path: '/quotations', icon: FileCheck2 },
        { label: 'Customers', path: '/customers', icon: Users },
      ];

  const isMoreActive = isAdminView
    ? [
        '/admin/analytics',
        '/admin/quotations',
        '/admin/impersonation',
        '/admin/settings',
      ].some((p) => currentPath === p || currentPath.startsWith(p + '/'))
    : [
        '/rate-card',
        '/payments',
        '/reports/outstanding',
        '/reports/sales',
        '/business-profile',
        '/templates/invoices',
        '/templates/quotations',
        '/settings',
      ].some((p) => currentPath === p || currentPath.startsWith(p + '/'));

  const moreSheetItems: NavItem[] = isAdminView
    ? [
        { label: 'Platform Analytics', path: '/admin/analytics', icon: BarChart3 },
        { label: 'Platform Quotations', path: '/admin/quotations', icon: FileCheck2 },
        { label: 'Impersonation History', path: '/admin/impersonation', icon: History },
        { label: 'Platform Settings', path: '/admin/settings', icon: Settings },
      ]
    : [
        { label: 'Rate Card', path: '/rate-card', icon: Package },
        { label: 'Payments', path: '/payments', icon: CreditCard },
        { label: 'Outstanding Reports', path: '/reports/outstanding', icon: FileSpreadsheet },
        { label: 'Sales Reports', path: '/reports/sales', icon: BarChart3 },
        { label: 'Business Profile', path: '/business-profile', icon: Building2 },
        { label: 'Invoice Templates', path: '/templates/invoices', icon: LayoutTemplate },
        { label: 'Quotation Templates', path: '/templates/quotations', icon: FileText },
        { label: 'Workspace Settings', path: '/settings', icon: Settings },
      ];

  const sidebarContent = (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      <div className="flex h-16 items-center justify-between px-5 border-b border-zinc-800/80">
        <button
          type="button"
          onClick={() => navigate(isAdminView ? '/admin' : '/dashboard')}
          className="flex items-center gap-2.5 text-left cursor-pointer focus-visible:outline-none"
        >
          <img
            src="/drona-logo.png"
            alt="DRONA Invoice"
            className="h-9 w-9 rounded-lg object-contain shrink-0"
          />
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            DRONA
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden text-zinc-400 hover:text-white p-2 -mr-2"
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
              const active = isNavItemActive(item.path);
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
        <PWAInstallButton variant="sidebar" />
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
          <div className="relative z-10 w-72 max-w-[82vw] h-full">{sidebarContent}</div>
        </div>
      ) : null}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Persistent Admin Impersonation Warning Banner */}
        {session?.isImpersonating ? (
          <div className="no-print sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-3 sm:px-4 py-2 text-zinc-950 shadow-sm">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold min-w-0">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span className="truncate">
                ADMIN MODE — {session.effectiveUser.businessName}
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
              className="bg-zinc-950 text-white hover:bg-zinc-800 h-8 text-xs shrink-0"
            >
              {exitingImp ? 'Exiting...' : 'Exit Customer Mode'}
            </Button>
          </div>
        ) : null}

        {/* Top Bar */}
        <header className="no-print sticky top-0 z-30 flex h-14 lg:h-16 items-center justify-between gap-2 sm:gap-4 border-b border-zinc-200 bg-white/95 px-3 sm:px-6 backdrop-blur-xs dark:border-zinc-800 dark:bg-zinc-900/95">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden flex h-10 w-10 -ml-1 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
                {breadcrumbs.map((b, i) => (
                  <React.Fragment key={i}>
                    {i > 0 ? <span aria-hidden="true">/</span> : null}
                    <span className="truncate">{b}</span>
                  </React.Fragment>
                ))}
              </div>
              <h1 className="text-sm sm:text-base lg:text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 truncate">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {session?.effectiveUser.role === 'business' ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((o) => !o)}
                  className="relative flex h-10 w-10 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
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
                    <div className="absolute right-0 mt-2 z-40 w-[min(calc(100vw-1.5rem),24rem)] rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
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

            <PWAInstallButton variant="header" />

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle light or dark theme"
              className="flex h-10 w-10 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {primaryAction ? (
              <Button size="sm" onClick={primaryAction.onClick} className="h-10 sm:h-9 px-2.5 sm:px-3">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{primaryAction.label}</span>
                <span className="sm:hidden">New</span>
              </Button>
            ) : null}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 flex flex-col p-3.5 sm:p-6 lg:p-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-8 max-w-[1440px] w-full mx-auto min-w-0">
          <div className="flex-1">{children}</div>
          <footer className="no-print mt-8 pt-4 border-t border-zinc-200/80 dark:border-zinc-800/80 text-center text-xs text-zinc-400">
            Generated by DronaInvoice
          </footer>
        </main>
      </div>

      {/* Instagram-Style Fixed Bottom Navigation Bar (Mobile & Tablet < lg only) */}
      {!inputFocused ? (
        <nav
          aria-label="Mobile navigation"
          className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200/90 bg-white/95 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="grid grid-cols-5 h-16 items-center max-w-lg mx-auto">
            {mobileBottomPrimary.map((item) => {
              const Icon = item.icon;
              const active = isNavItemActive(item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    setMoreSheetOpen(false);
                    navigate(item.path);
                  }}
                  className={`flex flex-col items-center justify-center h-full min-h-[44px] gap-0.5 transition-colors cursor-pointer ${
                    active
                      ? 'text-[#F57C00]'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  <div className="relative flex items-center justify-center">
                    <Icon className={`h-5 w-5 ${active ? 'stroke-[2.4]' : 'stroke-[1.9]'}`} />
                  </div>
                  <span className={`text-[10px] tracking-tight ${active ? 'font-semibold' : 'font-medium'}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setMoreSheetOpen((o) => !o)}
              className={`flex flex-col items-center justify-center h-full min-h-[44px] gap-0.5 transition-colors cursor-pointer ${
                moreSheetOpen || isMoreActive
                  ? 'text-[#F57C00]'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
              aria-expanded={moreSheetOpen}
              aria-label="More workspace options"
            >
              <UserCircle2
                className={`h-5 w-5 ${moreSheetOpen || isMoreActive ? 'stroke-[2.4]' : 'stroke-[1.9]'}`}
              />
              <span
                className={`text-[10px] tracking-tight ${
                  moreSheetOpen || isMoreActive ? 'font-semibold' : 'font-medium'
                }`}
              >
                More
              </span>
            </button>
          </div>
        </nav>
      ) : null}

      {/* Mobile Profile & More Bottom Sheet */}
      {moreSheetOpen ? (
        <div
          className="no-print lg:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label="Workspace menu"
        >
          <div className="fixed inset-0" onClick={() => setMoreSheetOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-t-3xl border-t border-zinc-200 bg-white px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 max-h-[85dvh] overflow-y-auto">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />

            <div className="flex items-center justify-between gap-3 pb-4 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src="/drona-logo.png"
                  alt="DRONA Invoice"
                  className="h-10 w-10 rounded-xl object-contain shrink-0"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {session?.effectiveUser.businessName || session?.effectiveUser.ownerName}
                  </div>
                  <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {session?.effectiveUser.email}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMoreSheetOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="py-4 grid grid-cols-2 gap-2.5">
              {moreSheetItems.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => {
                      setMoreSheetOpen(false);
                      navigate(item.path);
                    }}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-xs font-medium transition-colors min-h-[48px] cursor-pointer ${
                      active
                        ? 'border-[#F57C00] bg-orange-50/70 text-[#F57C00] dark:bg-orange-950/20'
                        : 'border-zinc-200 bg-zinc-50/60 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2.5">
              <PWAInstallButton variant="card" className="w-full" />
              <div className="flex items-center gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={toggleTheme}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 text-red-600 hover:text-red-700"
                  onClick={async () => {
                    setMoreSheetOpen(false);
                    await logout();
                    navigate('/login');
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
