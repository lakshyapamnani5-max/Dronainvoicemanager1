import * as React from 'react';
import { Edit2, Package, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cachedRead, rateCardApi } from '../../lib/api';
import { exportToExcel } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type { DiscountType, RateCardItem } from '../../shared/types';
import { EmptyState } from '../../components/AppShell';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

const DEFAULT_CATEGORIES = ['Services', 'Products', 'Consulting', 'Software', 'Maintenance', 'Hardware'];
const DEFAULT_UNITS = ['Nos', 'Hrs', 'Days', 'Months', 'Years', 'Kg', 'Box', 'Set', 'Sq.ft'];

export function RateCardPage() {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const profile = session?.businessProfile;
  const isGstBusiness = profile?.defaultIsGst !== false;
  const { notify } = useToast();

  const initialItems = React.useMemo(() => {
    if (!tenantUid || !cachedRead.hasTenantCollectionData(tenantUid, 'rateCard')) return null;
    return cachedRead.getTenantEntry(tenantUid).rateCard;
  }, [tenantUid]);

  const [items, setItems] = React.useState<RateCardItem[]>(() => initialItems || []);
  const [loading, setLoading] = React.useState(() => !initialItems);
  const [search, setSearch] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'inactive'>('all');

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<RateCardItem | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<RateCardItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const [form, setForm] = React.useState({
    name: '',
    description: '',
    category: 'Services',
    hsnSac: '',
    unit: 'Nos',
    rate: 0,
    discountType: 'percent' as DiscountType,
    discountValue: 0,
    taxRate: profile?.defaultTaxRate ?? 18,
    isActive: true,
  });

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await rateCardApi.list();
      setItems(res.items);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load rate card');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [notify]);

  React.useEffect(() => {
    if (initialItems) {
      setItems(initialItems);
      setLoading(false);
    }
    void load(Boolean(initialItems));
  }, [initialItems, load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (changed.has('rateCard')) {
        setItems(cachedRead.getTenantEntry(tenantUid).rateCard);
      }
    });
  }, [tenantUid]);

  const categories = React.useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES);
    items.forEach((it) => {
      if (it.category?.trim()) set.add(it.category.trim());
    });
    return Array.from(set);
  }, [items]);

  const filteredItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (statusFilter === 'active' && !it.isActive) return false;
      if (statusFilter === 'inactive' && it.isActive) return false;
      if (categoryFilter !== 'all' && it.category !== categoryFilter) return false;
      if (q) {
        const hay = `${it.name} ${it.description} ${it.hsnSac} ${it.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, categoryFilter, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      description: '',
      category: 'Services',
      hsnSac: '',
      unit: 'Nos',
      rate: 0,
      discountType: 'percent',
      discountValue: 0,
      taxRate: isGstBusiness ? (profile?.defaultTaxRate ?? 18) : 0,
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEdit = (item: RateCardItem) => {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description,
      category: item.category || 'Services',
      hsnSac: item.hsnSac || '',
      unit: item.unit || 'Nos',
      rate: item.rate,
      discountType: item.discountType || 'percent',
      discountValue: item.discountValue || 0,
      taxRate: item.taxRate ?? 18,
      isActive: item.isActive,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      notify('error', 'Item name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category.trim() || 'General',
        hsnSac: form.hsnSac.trim(),
        unit: form.unit.trim() || 'Nos',
        rate: Math.max(0, Number(form.rate) || 0),
        discountValue: Math.max(0, Number(form.discountValue) || 0),
        taxRate: isGstBusiness ? Number(form.taxRate) : 0,
      };
      if (editing) {
        await rateCardApi.update(editing.id, payload);
        notify('success', `"${payload.name}" updated in Rate Card`);
      } else {
        await rateCardApi.create(payload);
        notify('success', `"${payload.name}" added to Rate Card`);
      }
      setModalOpen(false);
      load(true);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save rate card item');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await rateCardApi.remove(deleteTarget.id);
      notify('success', `"${deleteTarget.name}" removed from Rate Card`);
      setDeleteTarget(null);
      load(true);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete item');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (item: RateCardItem) => {
    try {
      await rateCardApi.update(item.id, { isActive: !item.isActive });
      notify('success', item.isActive ? 'Item marked inactive' : 'Item marked active');
      load(true);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleExport = () => {
    exportToExcel(
      `drona-rate-card-${new Date().toISOString().slice(0, 10)}`,
      'Rate Card',
      filteredItems.map((it) => ({
        Name: it.name,
        Description: it.description,
        Category: it.category,
        'HSN/SAC': it.hsnSac || '-',
        Unit: it.unit,
        'Rate (INR)': it.rate,
        Discount: it.discountValue > 0 ? `${it.discountValue}${it.discountType === 'percent' ? '%' : ' INR'}` : '-',
        'GST %': it.taxRate,
        Status: it.isActive ? 'Active' : 'Inactive',
      }))
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 flex-1">
          <div className="relative col-span-2 sm:w-64">
            <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items, HSN/SAC, category..."
              className="pl-9"
            />
          </div>
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full sm:w-44"
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="w-full sm:w-36"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={handleExport}>
            Export Excel
          </Button>
          <Button size="sm" className="w-full sm:w-auto" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 sm:px-5 py-3 text-xs sm:text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-zinc-500">
          {filteredItems.length} catalog item{filteredItems.length === 1 ? '' : 's'} ready for quick insertion into invoices &amp; quotations
        </span>
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Tax Mode: <span className="font-semibold text-[#F57C00]">{isGstBusiness ? 'GST Registered' : 'Non-GST (Bill of Supply)'}</span>
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-zinc-500">Loading rate card...</div>
          ) : filteredItems.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Package}
                title="No rate card items found"
                description="Save your standard products, retainers, or services with preset rates so you can add them to invoices in one tap."
                actionLabel="Add Rate Card Item"
                onAction={openCreate}
              />
            </div>
          ) : (
            <>
              {/* Mobile Rate Card List */}
              <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredItems.map((item) => (
                  <div key={item.id} className={`p-4 space-y-2.5 ${!item.isActive ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                          {item.name}
                        </div>
                        {item.description ? (
                          <p className="text-xs text-zinc-500 line-clamp-2 mt-0.5">{item.description}</p>
                        ) : null}
                        <div className="text-[11px] font-mono text-zinc-500 mt-1">
                          {item.category || 'General'} · Unit: {item.unit}
                          {isGstBusiness && item.hsnSac ? ` · HSN: ${item.hsnSac}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-bold tabular-nums text-[#F57C00]">
                          {formatINR(item.rate)}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500">
                          {isGstBusiness ? `GST ${item.taxRate}%` : 'Non-GST'}
                          {item.discountValue > 0
                            ? ` · Disc ${item.discountValue}${item.discountType === 'percent' ? '%' : '₹'}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => openEdit(item)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleActive(item)}
                      >
                        {item.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setDeleteTarget(item)}
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item / Service</TableHead>
                      <TableHead>Category</TableHead>
                      {isGstBusiness ? <TableHead>HSN / SAC</TableHead> : null}
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Default Rate</TableHead>
                      <TableHead className="text-right">Discount</TableHead>
                      {isGstBusiness ? <TableHead className="text-right">GST %</TableHead> : null}
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.id} className={!item.isActive ? 'opacity-60' : ''}>
                        <TableCell>
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">
                            {item.name}
                          </div>
                          {item.description ? (
                            <div className="text-xs text-zinc-500 max-w-xs truncate">
                              {item.description}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs text-zinc-600 dark:text-zinc-400">
                          {item.category || 'General'}
                        </TableCell>
                        {isGstBusiness ? (
                          <TableCell className="font-mono text-xs text-zinc-500">
                            {item.hsnSac || '—'}
                          </TableCell>
                        ) : null}
                        <TableCell className="text-xs">{item.unit}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-semibold">
                          {formatINR(item.rate)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs text-zinc-500">
                          {item.discountValue > 0
                            ? `${item.discountValue}${item.discountType === 'percent' ? '%' : ' ₹'}`
                            : '—'}
                        </TableCell>
                        {isGstBusiness ? (
                          <TableCell className="text-right font-mono tabular-nums text-xs">
                            {item.taxRate}%
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(item)}
                            className={`text-xs font-medium cursor-pointer hover:underline ${
                              item.isActive
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-zinc-400'
                            }`}
                          >
                            {item.isActive ? 'Active' : 'Inactive'}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEdit(item)}
                              title="Edit Item"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => setDeleteTarget(item)}
                              title="Delete Item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Item Dialog */}
      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Rate Card Item' : 'Add Rate Card Item'}
        description="Preset rates, units, and tax defaults appear automatically when creating invoices or quotations."
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label>Item / Service Name *</Label>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Website Maintenance Retainer"
            />
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional scope or specifications shown on line items"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Category</Label>
              <Input
                list="rate-card-categories"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Services / Products"
              />
              <datalist id="rate-card-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label>Unit *</Label>
              <Input
                required
                list="rate-card-units"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="Nos / Hrs / Month"
              />
              <datalist id="rate-card-units">
                {DEFAULT_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Default Rate (INR) *</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label>Default Discount</Label>
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.discountValue}
                  onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
                  className="font-mono flex-1"
                />
                <Select
                  value={form.discountType}
                  onChange={(e) =>
                    setForm({ ...form, discountType: e.target.value as DiscountType })
                  }
                  className="w-20"
                >
                  <option value="percent">%</option>
                  <option value="fixed">₹</option>
                </Select>
              </div>
            </div>
          </div>

          {isGstBusiness ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>HSN / SAC Code</Label>
                <Input
                  value={form.hsnSac}
                  onChange={(e) => setForm({ ...form, hsnSac: e.target.value })}
                  placeholder="998314"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label>Default GST Rate (%)</Label>
                <Select
                  value={form.taxRate}
                  onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) })}
                  className="font-mono"
                >
                  {[0, 5, 12, 18, 28].map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              Your business profile is set to <span className="font-semibold">Non-GST</span>, so GST rate defaults to 0%. You can switch to GST Registered anytime in Business Profile.
            </div>
          )}

          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 accent-[#F57C00]"
            />
            Active in Rate Card picker on invoices &amp; quotations
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add to Rate Card'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Rate Card Item"
        description="Existing invoices and quotations using this item will not be affected."
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Remove <span className="font-semibold text-zinc-900 dark:text-zinc-100">{deleteTarget?.name}</span> from your Rate Card?
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? 'Deleting...' : 'Delete Item'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
