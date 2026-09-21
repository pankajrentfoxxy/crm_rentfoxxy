import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import {
  createSparePartsCatalogItem,
  fetchSparePartsCatalog,
  updateSparePartsCatalogItem,
} from '../vendorManagementApi';
import { fetchCascadeSpareModels } from '../../../utils/assetConfigurationApi';

const emptyForm = () => ({
  name: '',
  category: '',
  part_type: '',
  default_brand: '',
  default_model: '',
  specifications: '',
});

export default function SparePartsCatalogPanel({ onCatalogChange }) {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [form, setForm] = useState(emptyForm());
  const [editId, setEditId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchSparePartsCatalog({
        search: search || undefined,
        category: filterCategory || undefined,
      });
      if (!data.success) throw new Error(data.message || 'Load failed');
      setRows(data.data || []);
      setCategories(data.categories || []);
      setBrands(data.brands || []);
      onCatalogChange?.(data.data || []);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, [search, filterCategory, onCatalogChange]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const brand = (form.default_brand || '').trim();
    if (!brand) {
      setModels([]);
      return undefined;
    }
    setModelsLoading(true);
    fetchCascadeSpareModels(brand)
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data?.models) ? data.models : Array.isArray(data?.data) ? data.data : [];
        setModels(list.map((m) => (typeof m === 'string' ? m : m?.name)).filter(Boolean));
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.default_brand]);

  const resetForm = () => {
    setForm(emptyForm());
    setEditId(null);
  };

  const startEdit = (row) => {
    setEditId(row.id);
    setForm({
      name: row.name || '',
      category: row.category || '',
      part_type: row.part_type || '',
      default_brand: row.default_brand || '',
      default_model: row.default_model || '',
      specifications: row.specifications || '',
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.category) {
      toast.error('Part name and category are required');
      return;
    }
    if (form.default_model && !form.default_brand) {
      toast.error('Select a brand before model');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        part_type: form.part_type.trim() || null,
        default_brand: form.default_brand.trim() || null,
        default_model: form.default_model.trim() || null,
        specifications: form.specifications.trim() || null,
      };
      if (editId) {
        await updateSparePartsCatalogItem(editId, payload);
        toast.success('Catalog item updated');
      } else {
        await createSparePartsCatalogItem(payload);
        toast.success('Spare part added to catalog');
      }
      resetForm();
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">Spare parts catalog</h2>
          <p className="text-xs text-slate-500">
            Master list for raising spare POs — Brand → Model → Part on each PO line.
          </p>
        </div>
        <button type="button" className="inline-flex items-center gap-1 text-sm text-orange-700 font-semibold" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <form onSubmit={submit} className="p-4 border-b border-slate-100 bg-slate-50/80 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <label className="block text-sm md:col-span-2">
          <span className="text-xs font-semibold text-slate-600">Part name*</span>
          <input
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. 16 GB DDR4 RAM"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-slate-600">Category*</span>
          <select
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          >
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-slate-600">Type</span>
          <input
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={form.part_type}
            onChange={(e) => setForm((f) => ({ ...f, part_type: e.target.value }))}
            placeholder="DDR4, NVMe…"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-slate-600">Brand</span>
          <select
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={form.default_brand}
            onChange={(e) => setForm((f) => ({ ...f, default_brand: e.target.value, default_model: '' }))}
          >
            <option value="">Any / universal</option>
            {brands.map((b) => (
              <option key={b.id} value={b.name}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-slate-600">Model</span>
          <select
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            value={form.default_model}
            disabled={!form.default_brand || modelsLoading}
            onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))}
          >
            <option value="">{!form.default_brand ? 'Select brand first' : modelsLoading ? 'Loading…' : 'Any / optional'}</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 md:col-span-6">
          <button type="submit" disabled={saving} className="rounded-lg bg-orange-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {saving ? '…' : editId ? 'Update' : 'Add'}
          </button>
          {editId ? (
            <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onClick={resetForm}>Cancel</button>
          ) : null}
        </div>
        <label className="block text-sm md:col-span-6">
          <span className="text-xs font-semibold text-slate-600">Specifications</span>
          <input
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={form.specifications}
            onChange={(e) => setForm((f) => ({ ...f, specifications: e.target.value }))}
            placeholder="Optional details — capacity, connector, compatible models…"
          />
        </label>
      </form>

      <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-slate-100">
        <input
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm min-w-[180px]"
          placeholder="Search parts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 sticky top-0">
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Part name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2 w-16" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No parts in catalog — add one above.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-3 py-2 text-xs">{row.category_label || row.category}</td>
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{row.part_type || '—'}</td>
                <td className="px-3 py-2 text-xs">{row.default_brand || '—'}</td>
                <td className="px-3 py-2 text-xs">{row.default_model || '—'}</td>
                <td className="px-3 py-2 text-xs">{row.stock_qty ?? 0}</td>
                <td className="px-3 py-2">
                  <button type="button" className="text-xs text-orange-700 font-semibold" onClick={() => startEdit(row)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
