import * as React from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { adminApi, authApi, setStoredToken } from '../lib/api';
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
  }) => Promise<AuthSessionState>;
  logout: () => Promise<void>;
  impersonate: (uid: string) => Promise<void>;
  exitImpersonation: () => Promise<void>;
  updateLocalBusinessProfile: (profile: BusinessProfile) => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<AuthSessionState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const authBusyRef = React.useRef(false);

  const refreshSession = React.useCallback(async () => {
    try {
      const res = await authApi.me();
      setStoredToken(res.session.actorUser.uid);
      setSession(res.session);
    } catch {
      setStoredToken(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    initFirebaseAnalytics();
    const unsub = onAuthStateChanged(firebaseAuth, async (fbUser) => {
      if (authBusyRef.current) return;
      if (!fbUser) {
        setStoredToken(null);
        setSession(null);
        setLoading(false);
        return;
      }
      await refreshSession();
    });
    return () => unsub();
  }, [refreshSession]);

  // Live RTDB sync for active user record, effective user record, and business profile
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
          setSession(null);
          return;
        }
        const val = snap.val() as Record<string, unknown>;
        if (val.status && val.status !== 'active') {
          await signOut(firebaseAuth);
          setStoredToken(null);
          setSession(null);
          return;
        }
        refreshSession();
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
          refreshSession();
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
            const prof = snap.val() as BusinessProfile;
            setSession((prev) => (prev ? { ...prev, businessProfile: prof } : prev));
          }
        })
      );
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [actorUid, effectiveUid, effectiveRole, refreshSession]);

  const login = React.useCallback(
    async (email: string, password: string, portal?: 'admin' | 'customer') => {
      authBusyRef.current = true;
      try {
        const next = await authApi.login(email, password, portal);
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
    }) => {
      authBusyRef.current = true;
      try {
        const next = await authApi.register(payload);
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
    setSession(null);
  }, []);

  const impersonate = React.useCallback(async (uid: string) => {
    const res = await adminApi.impersonate(uid);
    setSession(res.session);
  }, []);

  const exitImpersonation = React.useCallback(async () => {
    const res = await adminApi.exitImpersonation();
    setSession(res.session);
  }, []);

  const updateLocalBusinessProfile = React.useCallback((profile: BusinessProfile) => {
    setSession((prev) => (prev ? { ...prev, businessProfile: profile } : prev));
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
