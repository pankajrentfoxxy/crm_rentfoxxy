import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listBluedartDeclaredValues,
  createBluedartDeclaredValue,
  updateBluedartDeclaredValue,
  deleteBluedartDeclaredValue,
  setBluedartDeclaredValueStatus,
} from '../../../../utils/assetConfigurationApi';
import { invalidateDeclaredValueMatrixCache } from '../../../../features/sales-pipeline/bluedartDeclaredValue';

const emptyForm = () => ({
  category: 'i5',
  grade: '',
  amount: '',
  label: '',
  active: true,
});

export default function BluedartDeclaredValuePanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listBluedartDeclaredValues({ include_inactive: 'true' });
      setItems(res.data?.items || []);
    } catch {
      toast.error('Failed to load BlueDart declared values');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      category: row.category || '',
      grade: row.grade || '',
      amount: String(row.amount ?? ''),
      label: row.label || '',
      active: row.active !== false,
    });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.category.trim() || !form.grade.trim()) {
      toast.error('Processor and generation are required');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Amount must be a positive number');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category: form.category.trim(),
        grade: form.grade.trim(),
        amount,
        label: form.label.trim() || undefined,
        sort_order: editing?.sort_order ?? 0,
        active: form.active,
      };
      if (editing) {
        await updateBluedartDeclaredValue(editing.id, payload);
        toast.success('Updated');
      } else {
        await createBluedartDeclaredValue(payload);
        toast.success('Added');
      }
      invalidateDeclaredValueMatrixCache();
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete ${row.category} · ${row.grade}?`)) return;
    try {
      await deleteBluedartDeclaredValue(row.id);
      invalidateDeclaredValueMatrixCache();
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Delete failed');
    }
  };

  const toggleActive = async (row) => {
    try {
      await setBluedartDeclaredValueStatus(row.id, !row.active);
      invalidateDeclaredValueMatrixCache();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Status update failed');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">BlueDart Declared Value</h2>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Amounts used when generating BlueDart AWB (₹). Matched by processor
            (i5 / i7 / R7 / APPLE) and generation (Intel gen or Apple chip). Add rows here — they are not hardcoded.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          <Plus size={16} /> Add row
        </button>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Processor</th>
              <th className="px-3 py-2 font-medium">Generation</th>
              <th className="px-3 py-2 font-medium">Amount (₹)</th>
              <th className="px-3 py-2 font-medium">Label</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-400">Loading…</td>
              </tr>
            ) : !items.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-400">No rows yet. Add the first declared value.</td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50/80">
                  <td className="px-3 py-2 font-medium text-gray-900">{row.category}</td>
                  <td className="px-3 py-2 text-gray-700">{row.grade}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {Number(row.amount).toLocaleString('en-IN')}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{row.label || '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleActive(row)}
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        row.active
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {row.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="p-1.5 text-gray-500 hover:text-blue-600 rounded"
                        title="Edit"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        className="p-1.5 text-gray-500 hover:text-red-600 rounded"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Tips: use generation <code className="bg-gray-100 px-1 rounded">ALL</code> for R7;
        Apple chips like <code className="bg-gray-100 px-1 rounded">m1-air</code>, <code className="bg-gray-100 px-1 rounded">m4</code>;
        Intel like <code className="bg-gray-100 px-1 rounded">12th</code>.
      </p>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={save}
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3"
          >
            <h3 className="text-lg font-semibold">
              {editing ? 'Edit declared value' : 'Add declared value'}
            </h3>
            <label className="block text-sm">
              <span className="text-gray-600">Processor</span>
              <input
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="i5 / i7 / R7 / APPLE"
                list="bd-dv-processors"
              />
              <datalist id="bd-dv-processors">
                <option value="i5" />
                <option value="i7" />
                <option value="R7" />
                <option value="APPLE" />
              </datalist>
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">Generation</span>
              <input
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                value={form.grade}
                onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                placeholder="12th / ALL / m1-air / u7"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">Amount (₹)</span>
              <input
                type="number"
                min="1"
                step="1"
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">Label (optional)</span>
              <input
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              Active (used for AWB autofill)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
