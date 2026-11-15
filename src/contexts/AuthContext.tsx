import * as React from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import {
  adminApi,
  authApi,
  cachedRead,
  ensureTenantMetaListener,
  getStoredToken,
  setStoredToken,
  updateRuntimeSessionCache,
} from '../lib/api';
import { firebaseAuth, initFirebaseAnalytics, rtdb } from '../lib/firebase';
import type { AuthSessionState, BusinessProfile } from '../shared/types';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
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
    } catch {
      setStoredToken(null);
      updateRuntimeSessionCache(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

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

  // Live RTDB sync for active user record, effective user record, business profile, and lightweight _meta
  const actorUid = session?.actorUser.uid;
  const effectiveUid = session?.effectiveUser.uid;
  const effectiveRole = session?.effectiveUser.role;

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
          return;
        }
        void runRefreshSession(true);
      })
    );

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
  }, [actorUid, effectiveUid, effectiveRole, runRefreshSession]);

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
