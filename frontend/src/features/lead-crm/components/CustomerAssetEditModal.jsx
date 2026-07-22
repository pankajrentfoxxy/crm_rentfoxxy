import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateCustomerAsset } from '../leadCrmApi';

function toDateInputValue(value) {
  if (!value) return '';
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

const SPEC_FIELDS = [
  ['Brand', 'brand'],
  ['Model', 'model'],
  ['Processor', 'processor'],
  ['Generation', 'generation'],
  ['RAM', 'ram'],
  ['Storage', 'storage'],
  ['GPU', 'gpu'],
  ['Screen size', 'screen_size'],
];

export default function CustomerAssetEditModal({ open, customerId, asset, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    brand: '',
    model: '',
    processor: '',
    generation: '',
    ram: '',
    storage: '',
    gpu: '',
    screen_size: '',
    rent_monthly_rate: '',
    dc_number: '',
    delivered_at: '',
  });

  useEffect(() => {
    if (!open || !asset) return;
    setForm({
      brand: asset.brand || '',
      model: asset.model_name || asset.model || '',
      processor: asset.processor || '',
      generation: asset.generation || '',
      ram: asset.ram || '',
      storage: asset.storage || '',
      gpu: asset.gpu || '',
      screen_size: asset.screen_size || '',
      rent_monthly_rate:
        asset.rent_monthly_rate != null && asset.rent_monthly_rate !== ''
          ? String(asset.rent_monthly_rate)
          : '',
      dc_number: asset.dc_number || '',
      delivered_at: toDateInputValue(asset.delivered_at || asset.dispatch_date),
    });
  }, [open, asset]);

  if (!open || !asset) return null;

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        brand: form.brand.trim(),
        model: form.model.trim(),
        processor: form.processor.trim(),
        generation: form.generation.trim(),
        ram: form.ram.trim(),
        storage: form.storage.trim(),
        gpu: form.gpu.trim(),
        screen_size: form.screen_size.trim(),
        dc_number: form.dc_number.trim(),
      };
      if (form.delivered_at.trim() !== '') {
        body.delivered_at = form.delivered_at.trim();
      } else {
        body.delivered_at = null;
      }
      if (form.rent_monthly_rate.trim() !== '') {
        body.rent_monthly_rate = form.rent_monthly_rate.trim();
      } else {
        body.rent_monthly_rate = null;
      }
      const { data } = await updateCustomerAsset(customerId, asset.serial_id, body);
      if (data.success) {
        toast.success(data.message || 'Asset updated');
        onSaved?.();
        onClose?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900">Edit asset</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              {asset.ttspl_id || asset.serial_number}
            </p>
          </div>
          <button type="button" className="p-2 rounded-lg hover:bg-slate-100" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
          {SPEC_FIELDS.map(([label, key]) => (
            <label key={key} className="block text-sm">
              <span className="text-xs font-medium text-slate-600">{label}</span>
              <input
                type="text"
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          ))}
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">DC number</span>
            <input
              type="text"
              value={form.dc_number}
              onChange={(e) => setForm((f) => ({ ...f, dc_number: e.target.value }))}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
              placeholder="e.g. DC/26-27/0910"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Delivery date</span>
            <input
              type="date"
              value={form.delivered_at}
              onChange={(e) => setForm((f) => ({ ...f, delivered_at: e.target.value }))}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-xs font-medium text-slate-600">Monthly rate (₹)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.rent_monthly_rate}
              onChange={(e) => setForm((f) => ({ ...f, rent_monthly_rate: e.target.value }))}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Leave blank to clear"
            />
          </label>
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
          <button
            type="button"
            className="flex-1 rounded-lg border border-slate-200 py-2 text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg bg-teal-700 text-white py-2 text-sm font-semibold disabled:opacity-50"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
