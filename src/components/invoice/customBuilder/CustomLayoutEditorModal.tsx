import * as React from 'react';
import {
  X,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Settings,
  Eye,
  EyeOff,
  Calculator,
  Layers,
  Sparkles,
} from 'lucide-react';
import type {
  CustomInvoiceLayout,
  CustomColumnDef,
  CustomColumnDataType,
  CustomColumnAlign,
  CoreFieldMapping,
} from '../../../shared/customLayoutTypes';
import { FormulaBuilderControl } from './FormulaBuilderControl';
import { evaluateFormula } from '../../../lib/formulaEngine';

export interface CustomLayoutEditorModalProps {
  layout?: CustomInvoiceLayout | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (layout: CustomInvoiceLayout) => Promise<void>;
}

const DATA_TYPES: Array<{ type: CustomColumnDataType; label: string; desc: string }> = [
  { type: 'text', label: 'Text', desc: 'Standard alphanumeric string (e.g. Particulars, Material)' },
  { type: 'number', label: 'Number', desc: 'Integer value without decimals' },
  { type: 'decimal', label: 'Decimal', desc: 'Floating-point number with precision (e.g. 384.50)' },
  { type: 'currency', label: 'Currency (₹)', desc: 'Monetary rate or price formatted with ₹' },
  { type: 'quantity', label: 'Quantity', desc: 'Units or item counts (e.g. 24 Nos)' },
  { type: 'measurement', label: 'Measurement', desc: 'Dimensions with custom unit (e.g. Length in ft, mm)' },
  { type: 'formula', label: 'Calculated / Formula', desc: 'Computed mathematically (e.g. Sq. Ft. × Rate)' },
  { type: 'percentage', label: 'Percentage (%)', desc: 'Percent discount, commission or margin' },
  { type: 'dropdown', label: 'Dropdown', desc: 'Select from pre-defined choices' },
  { type: 'date', label: 'Date', desc: 'Calendar date value' },
];

function slugifyKey(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function CustomLayoutEditorModal({
  layout,
  isOpen,
  onClose,
  onSave,
}: CustomLayoutEditorModalProps) {
  const [name, setName] = React.useState(layout?.name || 'New Custom Layout');
  const [description, setDescription] = React.useState(layout?.description || '');
  const [isDefault, setIsDefault] = React.useState(Boolean(layout?.isDefault));
  const [columns, setColumns] = React.useState<CustomColumnDef[]>(layout?.columns || []);
  const [activeColumnId, setActiveColumnId] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (layout) {
      setName(layout.name);
      setDescription(layout.description || '');
      setIsDefault(Boolean(layout.isDefault));
      setColumns(layout.columns || []);
      setActiveColumnId(layout.columns?.[0]?.id || null);
    } else {
      setName('New Custom Layout');
      setDescription('');
      setIsDefault(false);
      // Default starter columns
      const starter: CustomColumnDef[] = [
        {
          id: 'col_qty',
          key: 'qty',
          label: 'Qty.',
          dataType: 'quantity',
          width: '10%',
          align: 'right',
          required: true,
          visible: true,
          mappingToCore: 'quantity',
          measurementUnit: 'Nos',
        },
        {
          id: 'col_particulars',
          key: 'particulars',
          label: 'Particulars',
          dataType: 'text',
          width: '30%',
          align: 'left',
          required: true,
          visible: true,
          mappingToCore: 'name',
        },
        {
          id: 'col_sq_ft',
          key: 'total_sq_ft',
          label: 'Total Sq. Ft.',
          dataType: 'decimal',
          width: '15%',
          align: 'right',
          required: true,
          visible: true,
          decimalPrecision: 2,
          measurementUnit: 'Sq. Ft.',
        },
        {
          id: 'col_rate',
          key: 'rate_sq_ft',
          label: 'Rate/Sq. Ft.',
          dataType: 'currency',
          width: '15%',
          align: 'right',
          required: true,
          visible: true,
          decimalPrecision: 2,
        },
        {
          id: 'col_amount',
          key: 'amount',
          label: 'Amount',
          dataType: 'formula',
          width: '15%',
          align: 'right',
          required: false,
          visible: true,
          formula: 'total_sq_ft * rate_sq_ft',
          mappingToCore: 'totalAmount',
          decimalPrecision: 2,
        },
      ];
      setColumns(starter);
      setActiveColumnId(starter[0].id);
    }
  }, [layout, isOpen]);

  if (!isOpen) return null;

  const handleAddColumn = () => {
    const id = `col_${Date.now()}`;
    const newCol: CustomColumnDef = {
      id,
      key: `field_${columns.length + 1}`,
      label: `Field ${columns.length + 1}`,
      dataType: 'text',
      width: '12%',
      align: 'left',
      required: false,
      visible: true,
    };
    const next = [...columns, newCol];
    setColumns(next);
    setActiveColumnId(id);
  };

  const handleRemoveColumn = (id: string) => {
    if (columns.length <= 1) {
      setError('Layout must have at least one column');
      return;
    }
    const next = columns.filter((c) => c.id !== id);
    setColumns(next);
    if (activeColumnId === id) {
      setActiveColumnId(next[0]?.id || null);
    }
  };

  const handleMoveColumn = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= columns.length) return;
    const next = [...columns];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    setColumns(next);
  };

  const handleUpdateActiveColumn = (patch: Partial<CustomColumnDef>) => {
    if (!activeColumnId) return;
    setColumns((prev) =>
      prev.map((c) => {
        if (c.id === activeColumnId) {
          const updated = { ...c, ...patch };
          // If label changed and key is empty or default, update key
          if (patch.label && (!c.key || c.key.startsWith('field_'))) {
            updated.key = slugifyKey(patch.label) || updated.key;
          }
          return updated;
        }
        return c;
      })
    );
  };

  const activeColumn = columns.find((c) => c.id === activeColumnId) || columns[0];

  const handleSaveLayout = async () => {
    if (!name.trim()) {
      setError('Layout name is required');
      return;
    }
    if (columns.length === 0) {
      setError('Layout must have at least one column');
      return;
    }

    // Verify key uniqueness
    const keys = new Set<string>();
    for (const c of columns) {
      const cleanKey = c.key.trim().toLowerCase();
      if (!cleanKey) {
        setError(`Column "${c.label}" is missing an internal key`);
        return;
      }
      if (keys.has(cleanKey)) {
        setError(`Column key "${cleanKey}" is used multiple times. Field keys must be unique.`);
        return;
      }
      keys.add(cleanKey);
    }

    setIsSaving(true);
    setError(null);
    try {
      const layoutToSave: CustomInvoiceLayout = {
        id: layout?.id || `layout_${Date.now()}`,
        userUid: layout?.userUid || 'user',
        name: name.trim(),
        description: description.trim(),
        isDefault,
        columns,
        createdAt: layout?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await onSave(layoutToSave);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save custom layout');
    } finally {
      setIsSaving(false);
    }
  };

  // Sample row data for live table preview
  const sampleRow: Record<string, any> = {
    qty: 24,
    particulars: 'Commercial Plywood 12mm',
    item_name: 'Commercial Plywood',
    hsn_acs: '4412',
    hsn_sac: '4412',
    total_sq_ft: 384,
    length_ft: 8,
    width_ft: 4,
    thickness: '12mm',
    rate_sq_ft: 39,
    rate_per_unit: 39,
    unit_rate: 39,
    unit: 'Nos',
    hours: 8,
    hourly_rate: 450,
    material_cost: 0,
    labour_charges: 0,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-5xl my-auto flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-zinc-50/80 dark:bg-zinc-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {layout ? `Edit Preset: ${layout.name}` : 'Create Custom Invoice Layout'}
              </h2>
              <p className="text-xs text-zinc-500">
                Design custom invoice item columns with formulas, units, widths, and alignments.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {error && (
            <div className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 font-medium">
              {error}
            </div>
          )}

          {/* Preset Meta Info */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 bg-zinc-50/60 dark:bg-zinc-800/30 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800">
            <div className="sm:col-span-6 space-y-1">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Layout Preset Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Door & Furniture Supplier"
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="sm:col-span-6 space-y-1">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Description / Industry Note
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Columns for Plywood, Sq. Ft. and Rate calculations"
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="sm:col-span-12 flex items-center justify-between pt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Set as default preset for all new invoices</span>
              </label>
            </div>
          </div>

          {/* Builder Workspace: Columns List on Left, Properties on Right */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Columns List (5 Cols) */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                  Configured Columns ({columns.length})
                </span>
                <button
                  type="button"
                  onClick={handleAddColumn}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Column
                </button>
              </div>

              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {columns.map((col, idx) => {
                  const isActive = col.id === activeColumnId;
                  return (
                    <div
                      key={col.id}
                      onClick={() => setActiveColumnId(col.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                        isActive
                          ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 shadow-xs ring-1 ring-indigo-500/30'
                          : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-mono font-bold text-zinc-400 w-4 text-center">
                          {idx + 1}
                        </span>
                        <div className="truncate">
                          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {col.label}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                              {col.dataType}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              {col.width || 'auto'}
                            </span>
                            {col.dataType === 'formula' && (
                              <Calculator className="h-3 w-3 text-indigo-500" />
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveColumn(idx, 'up')}
                          className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-20"
                          title="Move Up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === columns.length - 1}
                          onClick={() => handleMoveColumn(idx, 'down')}
                          className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-20"
                          title="Move Down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveColumn(col.id)}
                          className="p-1 rounded text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                          title="Delete Column"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Column Properties Panel (7 Cols) */}
            <div className="lg:col-span-7 bg-zinc-50/70 dark:bg-zinc-800/40 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-4">
              {activeColumn ? (
                <>
                  <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        Column Properties: {activeColumn.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateActiveColumn({ visible: activeColumn.visible === false })
                        }
                        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded ${
                          activeColumn.visible !== false
                            ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30'
                            : 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800'
                        }`}
                      >
                        {activeColumn.visible !== false ? (
                          <>
                            <Eye className="h-3 w-3" /> Visible
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3 w-3" /> Hidden
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* Column Heading */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Column Heading (Display) *
                      </label>
                      <input
                        type="text"
                        value={activeColumn.label}
                        onChange={(e) => handleUpdateActiveColumn({ label: e.target.value })}
                        placeholder="e.g. Total Sq. Ft."
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {/* Internal Field ID / Key */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Internal Field Key (Variable) *
                      </label>
                      <input
                        type="text"
                        value={activeColumn.key}
                        onChange={(e) =>
                          handleUpdateActiveColumn({ key: slugifyKey(e.target.value) })
                        }
                        placeholder="e.g. total_sq_ft"
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {/* Data Type */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Data Type
                      </label>
                      <select
                        value={activeColumn.dataType}
                        onChange={(e) =>
                          handleUpdateActiveColumn({
                            dataType: e.target.value as CustomColumnDataType,
                          })
                        }
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      >
                        {DATA_TYPES.map((dt) => (
                          <option key={dt.type} value={dt.type}>
                            {dt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Alignment */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Alignment
                      </label>
                      <div className="grid grid-cols-3 gap-1">
                        {(['left', 'center', 'right'] as CustomColumnAlign[]).map((align) => (
                          <button
                            key={align}
                            type="button"
                            onClick={() => handleUpdateActiveColumn({ align })}
                            className={`py-1.5 text-xs font-semibold capitalize rounded-md border transition-colors ${
                              activeColumn.align === align
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50'
                            }`}
                          >
                            {align}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Width */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Column Width
                      </label>
                      <input
                        type="text"
                        value={activeColumn.width || ''}
                        onChange={(e) => handleUpdateActiveColumn({ width: e.target.value })}
                        placeholder="e.g. 14% or 110px"
                        className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {/* Measurement Unit */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Unit / Suffix (Optional)
                      </label>
                      <input
                        type="text"
                        value={activeColumn.measurementUnit || ''}
                        onChange={(e) =>
                          handleUpdateActiveColumn({ measurementUnit: e.target.value })
                        }
                        placeholder="e.g. Sq. Ft., mm, Kg, Nos, Mtr"
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {/* Decimal Precision */}
                    {['decimal', 'currency', 'formula', 'measurement'].includes(
                      activeColumn.dataType
                    ) && (
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                          Decimal Precision
                        </label>
                        <select
                          value={activeColumn.decimalPrecision ?? 2}
                          onChange={(e) =>
                            handleUpdateActiveColumn({
                              decimalPrecision: Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value={0}>0 (Whole numbers)</option>
                          <option value={1}>1 decimal (0.0)</option>
                          <option value={2}>2 decimals (0.00 - Standard)</option>
                          <option value={3}>3 decimals (0.000)</option>
                        </select>
                      </div>
                    )}

                    {/* Core Financial Field Mapping */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Connect to Core Field
                      </label>
                      <select
                        value={activeColumn.mappingToCore || 'none'}
                        onChange={(e) =>
                          handleUpdateActiveColumn({
                            mappingToCore: e.target.value as CoreFieldMapping,
                          })
                        }
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="none">Custom field only</option>
                        <option value="name">Line Item Name / Particulars</option>
                        <option value="description">Description</option>
                        <option value="hsnSac">HSN / SAC Code</option>
                        <option value="quantity">Quantity</option>
                        <option value="rate">Unit Rate</option>
                        <option value="totalAmount">Line Item Total Amount</option>
                      </select>
                    </div>
                  </div>

                  {/* Dropdown Options if dataType === 'dropdown' */}
                  {activeColumn.dataType === 'dropdown' && (
                    <div className="space-y-1.5 pt-1">
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Dropdown Options (Comma separated)
                      </label>
                      <input
                        type="text"
                        value={(activeColumn.dropdownOptions || []).join(', ')}
                        onChange={(e) =>
                          handleUpdateActiveColumn({
                            dropdownOptions: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Option 1, Option 2, Option 3"
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  )}

                  {/* Formula Builder if dataType === 'formula' */}
                  {activeColumn.dataType === 'formula' && (
                    <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-400">
                        <Calculator className="h-4 w-4" />
                        <span>Interactive Formula Builder</span>
                      </div>
                      <FormulaBuilderControl
                        formula={activeColumn.formula || ''}
                        columns={columns}
                        currentColumnKey={activeColumn.key}
                        onChange={(newFormula) =>
                          handleUpdateActiveColumn({ formula: newFormula })
                        }
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="py-12 text-center text-xs text-zinc-400">
                  Select a column to configure its properties.
                </div>
              )}
            </div>
          </div>

          {/* Live Preview Table */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
                Live Invoice Table Preview
              </span>
            </div>
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#7B73D6] text-white font-semibold text-[11px]">
                    <th className="py-2.5 px-3 w-10 text-center border-r border-[#6961C2]">#</th>
                    {columns
                      .filter((c) => c.visible !== false)
                      .map((c, i) => {
                        const isLast = i === columns.length - 1;
                        const alignClass =
                          c.align === 'center'
                            ? 'text-center'
                            : c.align === 'right'
                              ? 'text-right'
                              : 'text-left';
                        return (
                          <th
                            key={c.id}
                            style={{ width: c.width || undefined }}
                            className={`py-2.5 px-3 border-r border-[#6961C2] ${alignClass} ${
                              isLast ? 'border-r-0' : ''
                            }`}
                          >
                            {c.label}
                          </th>
                        );
                      })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 bg-white dark:bg-zinc-900">
                  <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-2.5 px-3 text-center border-r border-zinc-200 dark:border-zinc-700 text-zinc-500 font-mono">
                      1
                    </td>
                    {columns
                      .filter((c) => c.visible !== false)
                      .map((c, i) => {
                        const isLast = i === columns.length - 1;
                        const alignClass =
                          c.align === 'center'
                            ? 'text-center'
                            : c.align === 'right'
                              ? 'text-right'
                              : 'text-left';

                        let val: any = sampleRow[c.key] ?? c.defaultValue ?? '-';
                        if (c.dataType === 'formula' && c.formula) {
                          val = evaluateFormula(c.formula, sampleRow, c.decimalPrecision ?? 2);
                        }

                        let formattedVal = String(val);
                        if (c.dataType === 'currency' || c.dataType === 'formula') {
                          formattedVal = `₹${Number(val).toLocaleString('en-IN', {
                            minimumFractionDigits: c.decimalPrecision ?? 2,
                          })}`;
                        } else if (c.measurementUnit) {
                          formattedVal = `${val} ${c.measurementUnit}`;
                        }

                        return (
                          <td
                            key={c.id}
                            className={`py-2.5 px-3 ${alignClass} ${
                              !isLast ? 'border-r border-zinc-200 dark:border-zinc-700' : ''
                            }`}
                          >
                            <span
                              className={`font-medium ${
                                c.dataType === 'formula'
                                  ? 'text-indigo-600 dark:text-indigo-400 font-bold font-mono'
                                  : 'text-zinc-800 dark:text-zinc-200'
                              }`}
                            >
                              {formattedVal}
                            </span>
                          </td>
                        );
                      })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2.5 bg-zinc-50 dark:bg-zinc-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveLayout}
            className="px-5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-xs transition-colors inline-flex items-center gap-1.5"
          >
            {isSaving ? 'Saving...' : 'Save Layout Preset'}
          </button>
        </div>
      </div>
    </div>
  );
}
