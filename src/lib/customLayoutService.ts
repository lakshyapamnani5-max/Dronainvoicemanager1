import { rtdb } from './firebase';
import { ref, get, set, remove } from 'firebase/database';
import type { CustomInvoiceLayout } from '../shared/customLayoutTypes';
import { BUILT_IN_LAYOUT_PRESETS, PRESET_DOOR_FURNITURE_SUPPLIER } from './customLayoutPresets';

const LAYOUTS_STORAGE_KEY_PREFIX = 'drona_custom_layouts_';

// In-memory cache & listeners
const memoryLayouts = new Map<string, CustomInvoiceLayout[]>();
const layoutListeners = new Map<string, Set<(layouts: CustomInvoiceLayout[]) => void>>();

function getStorageKey(tenantUid: string): string {
  return `${LAYOUTS_STORAGE_KEY_PREFIX}${tenantUid}`;
}

function readLocalLayouts(tenantUid: string): CustomInvoiceLayout[] | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(tenantUid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalLayouts(tenantUid: string, layouts: CustomInvoiceLayout[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(getStorageKey(tenantUid), JSON.stringify(layouts));
  } catch (err) {
    console.warn('Failed to cache invoice layouts in localStorage', err);
  }
}

function notifyLayoutListeners(tenantUid: string, layouts: CustomInvoiceLayout[]): void {
  const setForTenant = layoutListeners.get(tenantUid);
  if (!setForTenant) return;
  for (const listener of setForTenant) {
    try {
      listener(layouts);
    } catch (e) {
      console.warn('Error in custom layout listener', e);
    }
  }
}

/**
 * Get all available presets for a tenant.
 * Merges built-in system presets with the tenant's saved custom presets.
 */
export async function listCustomLayouts(tenantUid: string): Promise<CustomInvoiceLayout[]> {
  if (!tenantUid) return [...BUILT_IN_LAYOUT_PRESETS];

  // 1. Check in-memory cache
  if (memoryLayouts.has(tenantUid)) {
    return memoryLayouts.get(tenantUid)!;
  }

  // 2. Check localStorage
  const local = readLocalLayouts(tenantUid);
  if (local && local.length > 0) {
    memoryLayouts.set(tenantUid, local);
    // Background sync with RTDB
    syncFromRtdb(tenantUid).catch(() => {});
    return local;
  }

  // 3. Fallback to RTDB or seed with built-in presets
  const fetched = await syncFromRtdb(tenantUid);
  return fetched;
}

/**
 * Sync presets from Firebase Realtime Database
 */
async function syncFromRtdb(tenantUid: string): Promise<CustomInvoiceLayout[]> {
  try {
    const db = rtdb;
    // Check both standard user path and tenant path
    const userRef = ref(db, `users/${tenantUid}/invoiceLayouts`);
    const snap = await get(userRef);

    let customList: CustomInvoiceLayout[] = [];
    if (snap.exists()) {
      const val = snap.val();
      if (val && typeof val === 'object') {
        customList = Object.values(val) as CustomInvoiceLayout[];
      }
    }

    // Combine built-in presets with user presets
    // If user has custom presets, ensure built-in presets without matching IDs are also available
    const existingIds = new Set(customList.map((l) => l.id));
    const combined = [
      ...customList,
      ...BUILT_IN_LAYOUT_PRESETS.filter((p) => !existingIds.has(p.id)),
    ];

    memoryLayouts.set(tenantUid, combined);
    writeLocalLayouts(tenantUid, combined);
    notifyLayoutListeners(tenantUid, combined);
    return combined;
  } catch (err) {
    console.warn('Error loading custom invoice layouts from RTDB, using defaults:', err);
    const defaults = [...BUILT_IN_LAYOUT_PRESETS];
    memoryLayouts.set(tenantUid, defaults);
    return defaults;
  }
}

/**
 * Save or update a custom layout preset.
 */
export async function saveCustomLayout(
  tenantUid: string,
  layout: CustomInvoiceLayout
): Promise<CustomInvoiceLayout> {
  const now = new Date().toISOString();
  const toSave: CustomInvoiceLayout = {
    ...layout,
    id: layout.id || `layout_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userUid: tenantUid,
    updatedAt: now,
    createdAt: layout.createdAt || now,
  };

  // Get current list
  const current = await listCustomLayouts(tenantUid);
  let updatedList: CustomInvoiceLayout[];

  if (toSave.isDefault) {
    // Unset default on other layouts
    updatedList = current.map((item) =>
      item.id === toSave.id ? toSave : { ...item, isDefault: false }
    );
  } else {
    const exists = current.some((item) => item.id === toSave.id);
    if (exists) {
      updatedList = current.map((item) => (item.id === toSave.id ? toSave : item));
    } else {
      updatedList = [toSave, ...current];
    }
  }

  // Update memory & local storage immediately
  memoryLayouts.set(tenantUid, updatedList);
  writeLocalLayouts(tenantUid, updatedList);
  notifyLayoutListeners(tenantUid, updatedList);

  // Persist to Firebase Realtime Database
  try {
    const db = rtdb;
    const layoutRef = ref(db, `users/${tenantUid}/invoiceLayouts/${toSave.id}`);
    await set(layoutRef, toSave);
  } catch (err) {
    console.error('Failed to persist custom layout to Firebase RTDB:', err);
  }

  return toSave;
}

/**
 * Delete a custom preset.
 */
export async function deleteCustomLayout(tenantUid: string, layoutId: string): Promise<void> {
  const current = await listCustomLayouts(tenantUid);
  const updatedList = current.filter((item) => item.id !== layoutId);

  memoryLayouts.set(tenantUid, updatedList);
  writeLocalLayouts(tenantUid, updatedList);
  notifyLayoutListeners(tenantUid, updatedList);

  try {
    const db = rtdb;
    const layoutRef = ref(db, `users/${tenantUid}/invoiceLayouts/${layoutId}`);
    await remove(layoutRef);
  } catch (err) {
    console.warn('Failed to delete custom layout from Firebase RTDB:', err);
  }
}

/**
 * Mark a layout as default.
 */
export async function setDefaultCustomLayout(tenantUid: string, layoutId: string): Promise<void> {
  const current = await listCustomLayouts(tenantUid);
  const target = current.find((item) => item.id === layoutId);
  if (!target) return;

  const updatedList = current.map((item) => ({
    ...item,
    isDefault: item.id === layoutId,
  }));

  memoryLayouts.set(tenantUid, updatedList);
  writeLocalLayouts(tenantUid, updatedList);
  notifyLayoutListeners(tenantUid, updatedList);

  try {
    const db = rtdb;
    for (const item of updatedList) {
      if (!item.id.startsWith('preset_')) {
        const layoutRef = ref(db, `users/${tenantUid}/invoiceLayouts/${item.id}`);
        await set(layoutRef, item);
      }
    }
  } catch (err) {
    console.warn('Failed to set default custom layout in RTDB:', err);
  }
}

/**
 * Duplicate an existing layout preset.
 */
export async function duplicateCustomLayout(
  tenantUid: string,
  layoutId: string
): Promise<CustomInvoiceLayout> {
  const current = await listCustomLayouts(tenantUid);
  const source = current.find((l) => l.id === layoutId) || PRESET_DOOR_FURNITURE_SUPPLIER;

  const duplicated: CustomInvoiceLayout = {
    ...JSON.parse(JSON.stringify(source)),
    id: `layout_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: `${source.name} (Copy)`,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return await saveCustomLayout(tenantUid, duplicated);
}

/**
 * Get layout by ID.
 */
export async function getCustomLayoutById(
  tenantUid: string,
  layoutId: string
): Promise<CustomInvoiceLayout | null> {
  const list = await listCustomLayouts(tenantUid);
  return list.find((item) => item.id === layoutId) || null;
}

/**
 * Subscribe to custom layout changes for real-time reactivity in components.
 */
export function subscribeCustomLayouts(
  tenantUid: string,
  callback: (layouts: CustomInvoiceLayout[]) => void
): () => void {
  if (!tenantUid) return () => {};

  let setForTenant = layoutListeners.get(tenantUid);
  if (!setForTenant) {
    setForTenant = new Set();
    layoutListeners.set(tenantUid, setForTenant);
  }
  setForTenant.add(callback);

  // Emit current data if available
  if (memoryLayouts.has(tenantUid)) {
    callback(memoryLayouts.get(tenantUid)!);
  } else {
    listCustomLayouts(tenantUid).then((layouts) => callback(layouts));
  }

  return () => {
    const set = layoutListeners.get(tenantUid);
    if (set) {
      set.delete(callback);
      if (set.size === 0) layoutListeners.delete(tenantUid);
    }
  };
}
