import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Plus, X } from 'lucide-react';
import VendorSearchSelect from '../../vendor-management/components/VendorSearchSelect';
import { addLaptopToQcProcess } from '../inventoryManagementApi';
import { invalidateInventoryManagement } from '../inventoryCountsEvents';
import { invalidateQcCounts } from '../../qc-management/qcCountsEvents';

const PO_TYPES = [
  { value: 'rental_purchase', label: 'Rental Purchase' },
  { value: 'rent_to_own', label: 'Rent To Own' },
  { value: 'direct_purchase', label: 'Direct Purchase' }
];

const EMPTY_FORM = {
  inventory_asset_code: '',
  serial_number: '',
  brand: '',
  model: '',
  processor: '',
  generation: '',
  ram: '',
  storage: '',
  vendor_id: '',
  purchase_order_type: 'rental_purchase',
  purchase_order_date: new Date().toISOString().slice(0, 10),
  rental_start_date: new Date().toISOString().slice(0, 10),
  po_state: '',
  unit_price: '',
  purchase_order_number: '',
  remarks: ''
};

export default function AddLaptopToQcModal({ open, onClose, onSuccess, intakeTarget = 'pending' }) {
  const isQcPending = intakeTarget === 'qc_pending';
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const resetAndClose = () => {
    setForm(EMPTY_FORM);
    onClose?.();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        vendor_id: form.vendor_id ? Number(form.vendor_id) : undefined,
        unit_price: form.unit_price === '' ? undefined : Number(form.unit_price),
        intake_target: intakeTarget
      };
      const { data } = await addLaptopToQcProcess(payload);
      if (data.success) {
        toast.success(data.message || (isQcPending ? 'Laptop added to QC Pending' : 'Laptop added to QC Process'));
        invalidateInventoryManagement();
        invalidateQcCounts();
        resetAndClose();
        onSuccess?.(data.data);
      } else {
        toast.error(data.message || 'Failed to add laptop');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to add laptop');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-bold text-slate-900">
              {isQcPending ? 'Add Laptop to QC Pending' : 'Add Laptop to QC Process'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isQcPending
                ? 'Creates PO + GRN + serial in QC Pending (no floor ticket until moved to QC Process).'
                : 'Creates PO + GRN + pending serial and a floor Production ticket.'}
            </p>
          </div>
          <button type="button" onClick={resetAndClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Asset Tag (TTSPL)</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                value={form.inventory_asset_code}
                onChange={(e) => setField('inventory_asset_code', e.target.value.toUpperCase())}
                placeholder="Auto-assigned if blank"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Serial Number *</span>
              <input
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                value={form.serial_number}
                onChange={(e) => setField('serial_number', e.target.value.toUpperCase())}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Brand *</span>
              <input
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.brand}
                onChange={(e) => setField('brand', e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Model *</span>
              <input
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.model}
                onChange={(e) => setField('model', e.target.value)}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Processor *</span>
              <input
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.processor}
                onChange={(e) => setField('processor', e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Generation</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.generation}
                onChange={(e) => setField('generation', e.target.value)}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">RAM *</span>
              <input
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.ram}
                onChange={(e) => setField('ram', e.target.value)}
                placeholder="e.g. 16GB"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">SSD / Storage *</span>
              <input
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.storage}
                onChange={(e) => setField('storage', e.target.value)}
                placeholder="e.g. 512GB SSD"
              />
            </label>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-600">Vendor *</span>
            <div className="mt-1">
              <VendorSearchSelect
                value={form.vendor_id}
                onChange={(id) => setField('vendor_id', id)}
                placeholder="Select vendor"
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 space-y-3">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Purchase details</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">PO Type *</span>
                <select
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 bg-white"
                  value={form.purchase_order_type}
                  onChange={(e) => setField('purchase_order_type', e.target.value)}
                >
                  {PO_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">PO Number</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                  value={form.purchase_order_number}
                  onChange={(e) => setField('purchase_order_number', e.target.value)}
                  placeholder="Auto-generated if blank"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">PO Date *</span>
                <input
                  required
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.purchase_order_date}
                  onChange={(e) => setField('purchase_order_date', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Rental Start *</span>
                <input
                  required
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.rental_start_date}
                  onChange={(e) => setField('rental_start_date', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Unit Price</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.unit_price}
                  onChange={(e) => setField('unit_price', e.target.value)}
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">PO State / Ship From</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.po_state}
                onChange={(e) => setField('po_state', e.target.value)}
                placeholder="Defaults to vendor state or Maharashtra"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Remarks</span>
              <textarea
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.remarks}
                onChange={(e) => setField('remarks', e.target.value)}
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={resetAndClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.vendor_id}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add to QC Process
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
