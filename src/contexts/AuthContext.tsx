import * as React from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import {
  adminApi,
  authApi,
  cachedRead,
  ensureTenantMetaListener,
  getLocalDeviceSessionId,
  getStoredToken,
  setStoredToken,
  updateRuntimeSessionCache,
} from '../lib/api';
import { firebaseAuth, initFirebaseAnalytics, rtdb } from '../lib/firebase';
import { useToast } from '../components/ui/toast';
import type { AuthSessionState, BusinessProfile, UserDeviceSession } from '../shared/types';

interface AuthContextValue {
  session: AuthSessionState | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
  login: (email: string, password: string, portal?: 'admin' | 'customer') => Promise<AuthSessionState>;
  register: (payload: {
    email: string;
    password: string;
    ownerName: string;
    businessName: string;
    phone: string;
    gstin: string;
    state: string;
    defaultIsGst?: boolean;
  }) => Promise<AuthSessionState>;
  logout: () => Promise<void>;
  impersonate: (uid: string) => Promise<void>;
  exitImpersonation: () => Promise<void>;
  updateLocalBusinessProfile: (profile: BusinessProfile) => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

function formatRevokedReasonMessage(reason?: string | null, maxLogins?: number): string {
  if (reason === 'admin_revoked') {
    return 'Your device session was signed out by Drona Admin.';
  }
  const limitText =
    typeof maxLogins === 'number' && maxLogins >= 1
      ? ` (max ${maxLogins} login${maxLogins === 1 ? '' : 's'} allowed)`
      : '';
  return `Signed out because your account logged in on another device${limitText}.`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useToast();
  const initialCachedSession = React.useMemo(() => {
    if (!getStoredToken()) return null;
    return cachedRead.getCachedSession();
  }, []);

  const [session, setSession] = React.useState<AuthSessionState | null>(initialCachedSession);
  const [loading, setLoading] = React.useState(!initialCachedSession);
  const authBusyRef = React.useRef(false);

  const runRefreshSession = React.useCallback(async (forceRefresh = true) => {
    try {
      const res = await authApi.me(forceRefresh);
      setStoredToken(res.session.actorUser.uid);
      updateRuntimeSessionCache(res.session);
      setSession(res.session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const isRevoked = msg.startsWith('SESSION_REVOKED:');
      const isFatalAuth =
        isRevoked ||
        !firebaseAuth.currentUser ||
        msg.includes('Authentication required') ||
        msg.includes('deactivated') ||
        msg.includes('not found');

      if (isFatalAuth) {
        if (isRevoked) {
          notify('error', msg.replace(/^SESSION_REVOKED:/, ''));
        } else if (msg.includes('deactivated')) {
          notify('error', msg);
        }
        setStoredToken(null);
        updateRuntimeSessionCache(null);
        setSession(null);
      }
      // On transient network/offline errors while Firebase user is still authenticated,
      // keep the cached session active so phones aren't unexpectedly logged out.
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const refreshSession = React.useCallback(() => runRefreshSession(true), [runRefreshSession]);

  React.useEffect(() => {
    initFirebaseAnalytics();
    const unsub = onAuthStateChanged(firebaseAuth, async (fbUser) => {
      if (authBusyRef.current) return;
      if (!fbUser) {
        setStoredToken(null);
        updateRuntimeSessionCache(null);
        setSession(null);
        setLoading(false);
        return;
      }
      const cached = cachedRead.getCachedSession();
      if (cached && cached.actorUser.uid === fbUser.uid) {
        setSession(cached);
        setLoading(false);
        // Validate against cache TTL silently without blocking initial render
        await runRefreshSession(false);
      } else {
        await runRefreshSession(true);
      }
    });
    return () => unsub();
  }, [runRefreshSession]);

  // Live RTDB sync for active user record, device session quota, effective user record, business profile, and lightweight _meta
  const actorUid = session?.actorUser.uid;
  const effectiveUid = session?.effectiveUser.uid;
  const effectiveRole = session?.effectiveUser.role;
  const isImpersonating = Boolean(session?.isImpersonating);
  const actorMaxLogins = session?.actorUser.maxLogins;

  React.useEffect(() => {
    if (!actorUid || !effectiveUid) return;

    const unsubs: Array<() => void> = [];

    let initializedActor = false;
    unsubs.push(
      onValue(ref(rtdb, `users/${actorUid}`), async (snap) => {
        if (!initializedActor) {
          initializedActor = true;
          return;
        }
        if (!snap.exists()) {
          await signOut(firebaseAuth);
          setStoredToken(null);
          updateRuntimeSessionCache(null);
          setSession(null);
          return;
        }
        const val = snap.val() as Record<string, unknown>;
        if (val.status && val.status !== 'active') {
          await signOut(firebaseAuth);
          setStoredToken(null);
          updateRuntimeSessionCache(null);
          setSession(null);
          notify('error', 'Your account has been deactivated by Drona Admin.');
          return;
        }
        void runRefreshSession(true);
      })
    );

    const localSessionId = getLocalDeviceSessionId();
    if (localSessionId && !isImpersonating) {
      let seenSessionOnce = false;
      unsubs.push(
        onValue(ref(rtdb, `userSessions/${actorUid}/${localSessionId}`), async (snap) => {
          if (snap.exists()) {
            seenSessionOnce = true;
            const sessVal = snap.val() as UserDeviceSession;
            if (sessVal.revoked) {
              await signOut(firebaseAuth).catch(() => {});
              setStoredToken(null);
              updateRuntimeSessionCache(null);
              setSession(null);
              notify('error', formatRevokedReasonMessage(sessVal.revokedReason, actorMaxLogins));
            }
          } else if (seenSessionOnce) {
            await signOut(firebaseAuth).catch(() => {});
            setStoredToken(null);
            updateRuntimeSessionCache(null);
            setSession(null);
            notify('error', formatRevokedReasonMessage(null, actorMaxLogins));
          }
        })
      );
    }

    if (effectiveUid !== actorUid) {
      let initializedEff = false;
      unsubs.push(
        onValue(ref(rtdb, `users/${effectiveUid}`), () => {
          if (!initializedEff) {
            initializedEff = true;
            return;
          }
          void runRefreshSession(true);
        })
      );
    }

    if (effectiveRole === 'business') {
      let initializedProf = false;
      unsubs.push(
        onValue(ref(rtdb, `businessProfiles/${effectiveUid}`), (snap) => {
          if (!initializedProf) {
            initializedProf = true;
            return;
          }
          if (snap.exists()) {
            const raw = snap.val() as Record<string, unknown>;
            const prof: BusinessProfile = {
              ...(raw as unknown as BusinessProfile),
              defaultIsGst: raw.defaultIsGst !== false,
            };
            cachedRead.setTenantProfileCache(effectiveUid, prof);
            setSession((prev) => {
              if (!prev) return prev;
              const next = { ...prev, businessProfile: prof };
              updateRuntimeSessionCache(next);
              return next;
            });
          }
        })
      );

      unsubs.push(ensureTenantMetaListener(effectiveUid));
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [actorUid, effectiveUid, effectiveRole, isImpersonating, actorMaxLogins, runRefreshSession, notify]);

  const login = React.useCallback(
    async (email: string, password: string, portal?: 'admin' | 'customer') => {
      authBusyRef.current = true;
      try {
        const next = await authApi.login(email, password, portal);
        updateRuntimeSessionCache(next);
        setSession(next);
        setLoading(false);
        return next;
      } finally {
        authBusyRef.current = false;
      }
    },
    []
  );

  const register = React.useCallback(
    async (payload: {
      email: string;
      password: string;
      ownerName: string;
      businessName: string;
      phone: string;
      gstin: string;
      state: string;
      defaultIsGst?: boolean;
    }) => {
      authBusyRef.current = true;
      try {
        const next = await authApi.register(payload);
        updateRuntimeSessionCache(next);
        setSession(next);
        setLoading(false);
        return next;
      } finally {
        authBusyRef.current = false;
      }
    },
    []
  );

  const logout = React.useCallback(async () => {
    await authApi.logout();
    updateRuntimeSessionCache(null);
    setSession(null);
  }, []);

  const impersonate = React.useCallback(async (uid: string) => {
    const res = await adminApi.impersonate(uid);
    updateRuntimeSessionCache(res.session);
    setSession(res.session);
  }, []);

  const exitImpersonation = React.useCallback(async () => {
    const res = await adminApi.exitImpersonation();
    updateRuntimeSessionCache(res.session);
    setSession(res.session);
  }, []);

  const updateLocalBusinessProfile = React.useCallback((profile: BusinessProfile) => {
    setSession((prev) => {
      if (!prev) return prev;
      cachedRead.setTenantProfileCache(prev.effectiveUser.uid, profile);
      const next = { ...prev, businessProfile: profile };
      updateRuntimeSessionCache(next);
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        refreshSession,
        login,
        register,
        logout,
        impersonate,
        exitImpersonation,
        updateLocalBusinessProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
