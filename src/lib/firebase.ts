import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

export const firebaseConfig = {
  apiKey: 'AIzaSyC10Z7Y1nK4NERtF-oHBaac8-UZ0mB6mK0',
  authDomain: 'dronainvoicehub.firebaseapp.com',
  databaseURL: 'https://dronainvoicehub-default-rtdb.firebaseio.com',
  projectId: 'dronainvoicehub',
  storageBucket: 'dronainvoicehub.firebasestorage.app',
  messagingSenderId: '853278373008',
  appId: '1:853278373008:web:380802b71131da8ebe5415',
  measurementId: 'G-6K4L7P41M5',
};

const existingPrimary = getApps().find((a) => a.name === '[DEFAULT]');
export const firebaseApp: FirebaseApp = existingPrimary || initializeApp(firebaseConfig);
export const firebaseAuth: Auth = getAuth(firebaseApp);
export const rtdb: Database = getDatabase(firebaseApp);

let analyticsPromise: Promise<Analytics | null> | null = null;
export function initFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then((supported) => (supported ? getAnalytics(firebaseApp) : null))
      .catch(() => null);
  }
  return analyticsPromise;
}

export function getSecondaryAuth(): Auth {
  const existing = getApps().find((a) => a.name === 'drona-admin-provisioner');
  const secondaryApp = existing || initializeApp(firebaseConfig, 'drona-admin-provisioner');
  return getAuth(secondaryApp);
}
