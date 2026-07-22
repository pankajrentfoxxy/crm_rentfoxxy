import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchParentOptions } from '../../../../utils/assetConfigurationApi';

export default function ConfigEntityPanel({
  label,
  parentEntity,
  parentKey,
  parentLabel,
  listFn,
  createFn,
  updateFn,
  deleteFn,
  setStatusFn,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', status: 'active', parentId: '' });
  const [parents, setParents] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20, search: search.trim() || undefined };
      if (statusFilter) params.status = statusFilter;
      const res = await listFn(params);
      setItems(res.data?.items || []);
      setPagination(res.data?.pagination || { totalPages: 1, total: 0 });
    } catch {
      toast.error(`Failed to load ${label}s`);
    } finally {
      setLoading(false);
    }
  }, [listFn, label, page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!parentEntity) return;
    fetchParentOptions(parentEntity)
      .then((r) => setParents(r.data?.options || []))
      .catch(() => setParents([]));
  }, [parentEntity]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', status: 'active', parentId: parents[0]?.id ? String(parents[0].id) : '' });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name,
      status: row.status || 'active',
      parentId: parentKey ? String(row[parentKey] || '') : '',
    });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (parentKey && !form.parentId) {
      toast.error(`${parentLabel} is required`);
      return;
    }
    setSaving(true);
    try {
      const body = { name: form.name.trim(), status: form.status };
      if (parentKey) body[parentKey] = parseInt(form.parentId, 10);
      if (editing) {
        await updateFn(editing.id, body);
        toast.success(`${label} updated`);
      } else {
        await createFn(body);
        toast.success(`${label} created`);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.name}"? This cannot be undone.`)) return;
    try {
      await deleteFn(row.id);
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed');
    }
  };

  const toggleStatus = async (row) => {
    const next = row.status === 'active' ? 'inactive' : 'active';
    try {
      await setStatusFn(row.id, next);
      toast.success(next === 'active' ? 'Activated' : 'Deactivated');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Status update failed');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-gray-500">Manage {label.toLowerCase()} values for asset details forms.</p>
        <button type="button" onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add {label}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder={`Search ${label.toLowerCase()}…`}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-full max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  {parentKey && <th className="px-4 py-3 text-left">{parentLabel}</th>}
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Updated</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.length === 0 ? (
                  <tr><td colSpan={parentKey ? 5 : 4} className="px-4 py-8 text-center text-gray-400">No records</td></tr>
                ) : items.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    {parentKey && (
                      <td className="px-4 py-3 text-gray-600">
                        {row.brand_name || row.processor_name || '—'}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => toggleStatus(row)}
                        className={`text-xs px-2 py-0.5 rounded-full ${row.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {row.status === 'active' ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => openEdit(row)} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="Edit">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => remove(row)} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border rounded text-sm disabled:opacity-40">Prev</button>
          <span className="text-sm text-gray-500 py-1">Page {page} of {pagination.totalPages}</span>
          <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded text-sm disabled:opacity-40">Next</button>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} aria-label="Close" />
          <form onSubmit={save} className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-semibold text-lg mb-4">{editing ? `Edit ${label}` : `Add ${label}`}</h3>
            {parentKey && (
              <label className="block text-sm mb-3">
                <span className="text-gray-600 text-xs">{parentLabel}*</span>
                <select
                  required
                  value={form.parentId}
                  onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select…</option>
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm mb-3">
              <span className="text-gray-600 text-xs">Name*</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm mb-4">
              <span className="text-gray-600 text-xs">Status</span>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
