import * as React from 'react';
import {
  Plus,
  Edit2,
  Copy,
  Trash2,
  CheckCircle,
  Layers,
  Sparkles,
  Calculator,
  LayoutGrid,
} from 'lucide-react';
import type { CustomInvoiceLayout } from '../../../shared/customLayoutTypes';
import {
  listCustomLayouts,
  saveCustomLayout,
  deleteCustomLayout,
  setDefaultCustomLayout,
  duplicateCustomLayout,
  subscribeCustomLayouts,
} from '../../../lib/customLayoutService';
import { CustomLayoutEditorModal } from './CustomLayoutEditorModal';
import { getCachedSession } from '../../../lib/localCache';

export function CustomLayoutsManager() {
  const session = getCachedSession();
  const tenantUid = session?.effectiveUser.uid || '';

  const [layouts, setLayouts] = React.useState<CustomInvoiceLayout[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editingLayout, setEditingLayout] = React.useState<CustomInvoiceLayout | null>(null);
  const [isEditorOpen, setIsEditorOpen] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!tenantUid) return;
    setLoading(true);
    const unsubscribe = subscribeCustomLayouts(tenantUid, (data) => {
      setLayouts(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tenantUid]);

  const showStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleCreateNew = () => {
    setEditingLayout(null);
    setIsEditorOpen(true);
  };

  const handleEdit = (layout: CustomInvoiceLayout) => {
    setEditingLayout(layout);
    setIsEditorOpen(true);
  };

  const handleDuplicate = async (layoutId: string) => {
    try {
      const duplicated = await duplicateCustomLayout(tenantUid, layoutId);
      showStatus(`Duplicated "${duplicated.name}" successfully`);
    } catch {
      showStatus('Failed to duplicate layout');
    }
  };

  const handleDelete = async (layoutId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete preset "${name}"?`)) return;
    try {
      await deleteCustomLayout(tenantUid, layoutId);
      showStatus(`Deleted "${name}"`);
    } catch {
      showStatus('Failed to delete layout');
    }
  };

  const handleSetDefault = async (layoutId: string, name: string) => {
    try {
      await setDefaultCustomLayout(tenantUid, layoutId);
      showStatus(`"${name}" is now the default layout for new invoices`);
    } catch {
      showStatus('Failed to update default layout');
    }
  };

  const handleSaveLayout = async (saved: CustomInvoiceLayout) => {
    await saveCustomLayout(tenantUid, saved);
    showStatus(`Saved "${saved.name}" successfully`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-linear-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30 border border-indigo-100 dark:border-indigo-900/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-600 text-white">
              <LayoutGrid className="h-4 w-4" />
            </span>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              Custom Invoice Layouts &amp; Column Presets
            </h2>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
            Customize invoice item tables for your industry without developer intervention. Add, rename,
            reorder columns, configure custom formulas (like Shiv Hari Doors Sq. Ft. pricing), and save
            reusable presets.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreateNew}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all shrink-0 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Create Custom Layout
        </button>
      </div>

      {statusMessage && (
        <div className="p-3 text-xs rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-medium flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-emerald-600" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Preset Cards Grid */}
      {loading ? (
        <div className="py-12 text-center text-xs text-zinc-400">Loading invoice presets...</div>
      ) : layouts.length === 0 ? (
        <div className="py-12 text-center text-xs text-zinc-400">
          No layout presets found. Click "Create Custom Layout" to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {layouts.map((l) => {
            const isSystemPreset = l.id.startsWith('preset_');
            const formulaCount = l.columns.filter((c) => c.dataType === 'formula').length;

            return (
              <div
                key={l.id}
                className={`p-5 rounded-2xl border transition-all flex flex-col justify-between bg-white dark:bg-zinc-900 hover:shadow-md ${
                  l.isDefault
                    ? 'border-indigo-500/80 ring-2 ring-indigo-500/20 shadow-xs'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                          {l.name}
                        </h3>
                        {l.isDefault && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                            <Sparkles className="h-3 w-3" />
                            Default
                          </span>
                        )}
                      </div>
                      {l.description && (
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-relaxed">
                          {l.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Column Badges Preview */}
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider block">
                      Table Columns ({l.columns.length}):
                    </span>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {l.columns.map((c) => (
                        <span
                          key={c.id || c.key}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/60"
                        >
                          <span>{c.label}</span>
                          {c.dataType === 'formula' && (
                            <Calculator className="h-2.5 w-2.5 text-indigo-500" />
                          )}
                        </span>
                      ))}
                    </div>
                  </div>

                  {formulaCount > 0 && (
                    <div className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                      <Calculator className="h-3.5 w-3.5" />
                      <span>
                        {formulaCount} auto-calculated {formulaCount === 1 ? 'formula' : 'formulas'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-zinc-100 dark:border-zinc-800 text-xs">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleEdit(l)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium transition-colors"
                    >
                      <Edit2 className="h-3 w-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicate(l.id)}
                      className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      title="Duplicate Preset"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    {!isSystemPreset && (
                      <button
                        type="button"
                        onClick={() => handleDelete(l.id, l.name)}
                        className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                        title="Delete Preset"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {!l.isDefault ? (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(l.id, l.name)}
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Set Default
                    </button>
                  ) : (
                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Active
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Modal */}
      <CustomLayoutEditorModal
        layout={editingLayout}
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveLayout}
      />
    </div>
  );
}
