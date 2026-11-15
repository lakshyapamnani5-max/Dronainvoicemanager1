import * as React from 'react';
import { ArrowLeft, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { authApi, cachedRead } from '../../lib/api';
import { INDIAN_STATES } from '../../shared/indianStates';
import { PWAInstallButton } from '../../components/PWAComponents';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Label, Select } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';

interface AuthPageProps {
  mode: 'login' | 'admin-login' | 'register' | 'forgot';
  navigate: (path: string) => void;
}

export function AuthPages({ mode, navigate }: AuthPageProps) {
  const { login, register } = useAuth();
  const { notify } = useToast();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [ownerName, setOwnerName] = React.useState('');
  const [businessName, setBusinessName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [gstin, setGstin] = React.useState('');
  const [state, setState] = React.useState('Maharashtra');
  const [defaultIsGst, setDefaultIsGst] = React.useState(true);

  const [resetSent, setResetSent] = React.useState(false);

  const [allowSelfReg, setAllowSelfReg] = React.useState(
    () => cachedRead.getCachedPublicSettings()?.allowSelfRegistration ?? true
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    authApi
      .getPublicSettings()
      .then((s) => setAllowSelfReg(s.allowSelfRegistration))
      .catch(() => {});
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await login(email, password, mode === 'admin-login' ? 'admin' : 'customer');
      notify('success', `Welcome back, ${session.actorUser.ownerName}`);
      navigate(session.actorUser.role === 'super_admin' ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({
        email,
        password,
        ownerName,
        businessName,
        phone,
        gstin: defaultIsGst ? gstin : '',
        state,
        defaultIsGst,
      });
      notify('success', 'Business workspace provisioned');
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authApi.forgotPassword(email);
      setResetSent(true);
      notify('success', res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950 flex flex-col lg:flex-row">
      {/* Left Brand Panel (compact bar on mobile, full hero panel on desktop) */}
      <div className="lg:w-[44%] bg-zinc-950 text-zinc-100 px-5 py-4 sm:px-8 sm:py-6 lg:p-12 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-zinc-800">
        <div>
          <div className="flex items-center justify-between lg:justify-start gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <img
                src="/drona-logo.png"
                alt="DRONA Invoice"
                className="h-9 w-9 sm:h-11 sm:w-11 rounded-xl object-contain shrink-0"
              />
              <span className="font-display text-xl sm:text-2xl font-bold tracking-tight text-white">
                DRONA
              </span>
            </div>
            <div className="lg:hidden flex items-center gap-2">
              <span className="text-[11px] font-medium text-zinc-400 hidden sm:inline">
                GST Invoice &amp; Billing SaaS
              </span>
              <PWAInstallButton variant="header" />
            </div>
          </div>
          <h1 className="hidden lg:block mt-12 text-3xl sm:text-4xl font-semibold tracking-tight text-white leading-tight max-w-md [text-wrap:balance]">
            Precision GST Invoicing & Revenue Operations for Modern Indian Businesses
          </h1>
          <p className="hidden lg:block mt-4 text-sm text-zinc-400 max-w-md leading-relaxed">
            Isolated multi-tenant workspaces for creating compliant tax invoices, tracking customer quotations, reconciling partial payments, and exporting A4 GST documents.
          </p>
          <div className="hidden lg:block mt-6 max-w-xs">
            <PWAInstallButton variant="sidebar" />
          </div>
        </div>

        <div className="hidden lg:grid mt-10 pt-8 border-t border-zinc-800/80 grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <div className="font-semibold text-zinc-200">GST & Non-GST Ready</div>
            <p className="mt-1 text-zinc-400 leading-relaxed">
              Automated CGST/SGST & IGST calculation, HSN/SAC line items, and A4 PDF export.
            </p>
          </div>
          <div>
            <div className="font-semibold text-zinc-200">Isolated Workspaces</div>
            <p className="mt-1 text-zinc-400 leading-relaxed">
              Dedicated business ledgers, dynamic UPI QR codes, and real-time analytics.
            </p>
          </div>
        </div>
      </div>

      {/* Right Auth Form */}
      <div className="flex-1 flex items-center justify-center p-4 py-6 sm:p-12">
        <div className="w-full max-w-md space-y-4 sm:space-y-6">
          <div className="flex items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={() => navigate(mode === 'admin-login' ? '/login' : '/admin/login')}
              className="inline-flex min-h-[36px] items-center gap-1.5 font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
            >
              {mode === 'admin-login' ? (
                <>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Switch to Customer Login
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3.5 w-3.5 text-[#F57C00]" />
                  Drona Admin Portal
                </>
              )}
            </button>

            {mode === 'login' && allowSelfReg ? (
              <button
                type="button"
                onClick={() => navigate('/register')}
                className="min-h-[36px] font-medium text-[#F57C00] hover:underline cursor-pointer"
              >
                Register Business
              </button>
            ) : null}
          </div>

          <Card>
            <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-3">
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                {mode === 'admin-login' ? (
                  <ShieldCheck className="h-5 w-5 text-[#F57C00]" />
                ) : mode === 'forgot' ? (
                  <KeyRound className="h-5 w-5 text-[#F57C00]" />
                ) : (
                  <Lock className="h-5 w-5 text-[#F57C00]" />
                )}
                {mode === 'admin-login'
                  ? 'Drona Admin Console'
                  : mode === 'register'
                    ? 'Create Business Workspace'
                    : mode === 'forgot'
                      ? 'Reset Password'
                      : 'Sign in to DRONA'}
              </CardTitle>
              <CardDescription>
                {mode === 'admin-login'
                  ? 'Centralized multi-tenant platform administration'
                  : mode === 'register'
                    ? 'Provision an isolated GST billing workspace for your company'
                  : mode === 'forgot'
                    ? 'Enter your email to receive a Firebase password reset link'
                    : 'Access your invoices, quotations, customers, and analytics'}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {error ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              ) : null}

              {mode === 'login' || mode === 'admin-login' ? (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="login-email">Email Address</Label>
                    <Input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="name@company.in"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="login-password">Password</Label>
                      {mode === 'login' ? (
                        <button
                          type="button"
                          onClick={() => navigate('/forgot-password')}
                          className="text-xs text-[#F57C00] hover:underline cursor-pointer"
                        >
                          Forgot password?
                        </button>
                      ) : null}
                    </div>
                    <Input
                      id="login-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? 'Signing in...' : mode === 'admin-login' ? 'Sign in as Drona Admin' : 'Sign in to Workspace'}
                  </Button>
                </form>
              ) : null}

              {mode === 'register' ? (
                <form onSubmit={handleRegister} className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Owner Name</Label>
                      <Input
                        required
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        placeholder="Full name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Phone</Label>
                      <Input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+91 98..."
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Business / Legal Name</Label>
                    <Input
                      required
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Acme Industries Pvt Ltd"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Business Tax Type</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDefaultIsGst(true)}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors cursor-pointer ${
                          defaultIsGst
                            ? 'border-[#F57C00] bg-orange-50/70 text-[#F57C00] dark:bg-orange-950/20'
                            : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300'
                        }`}
                      >
                        GST Registered
                      </button>
                      <button
                        type="button"
                        onClick={() => setDefaultIsGst(false)}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors cursor-pointer ${
                          !defaultIsGst
                            ? 'border-[#F57C00] bg-orange-50/70 text-[#F57C00] dark:bg-orange-950/20'
                            : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300'
                        }`}
                      >
                        Non-GST Business
                      </button>
                    </div>
                  </div>
                  <div className={`grid grid-cols-1 ${defaultIsGst ? 'sm:grid-cols-2' : ''} gap-3`}>
                    {defaultIsGst ? (
                      <div className="space-y-1">
                        <Label>GSTIN (Optional)</Label>
                        <Input
                          value={gstin}
                          onChange={(e) => setGstin(e.target.value.toUpperCase())}
                          placeholder="27AABCU9603R1ZM"
                          className="font-mono uppercase"
                        />
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <Label>Registered State</Label>
                      <Select value={state} onChange={(e) => setState(e.target.value)}>
                        {INDIAN_STATES.map((s) => (
                          <option key={s.code} value={s.name}>
                            {s.code} - {s.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Work Email</Label>
                    <Input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="billing@company.in"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Password (min 8 chars)</Label>
                    <Input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? 'Creating Workspace...' : 'Create Account'}
                  </Button>
                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => navigate('/login')}
                      className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      Already have an account? Sign in
                    </button>
                  </div>
                </form>
              ) : null}

              {mode === 'forgot' ? (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  {!resetSent ? (
                    <>
                      <div className="space-y-1.5">
                        <Label>Registered Email</Label>
                        <Input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="name@company.in"
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={submitting}>
                        {submitting ? 'Sending Reset Link...' : 'Send Password Reset Email'}
                      </Button>
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200 leading-relaxed">
                        A Firebase password reset link has been sent to{' '}
                        <span className="font-mono font-semibold">{email}</span>. Check your inbox and follow the link to choose a new password.
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => setResetSent(false)}
                      >
                        Send to a Different Email
                      </Button>
                    </div>
                  )}
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => navigate('/login')}
                      className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      Back to Login
                    </button>
                  </div>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-zinc-400 pt-1">
            Generated by DronaInvoice
          </p>
        </div>
      </div>
    </div>
  );
}
