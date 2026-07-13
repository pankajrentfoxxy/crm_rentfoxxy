import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { dispatchDC } from '../salesPipelineApi';

export default function DispatchModal({
  open, dcNumber, qcBlocked, technicians = [], onClose, onDispatched,
}) {
  const [mode, setMode] = useState('courier');
  const [form, setForm] = useState({
    courier_name: '', awb_number: '', porter_booking_id: '',
    delivery_person_id: '', estimated_delivery: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('courier');
      setForm({ courier_name: '', awb_number: '', porter_booking_id: '', delivery_person_id: '', estimated_delivery: '' });
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (qcBlocked) return;
    if (mode === 'courier' && (!form.courier_name || !form.awb_number)) {
      toast.error('Courier name and AWB are required');
      return;
    }
    if (mode === 'porter' && !form.porter_booking_id) {
      toast.error('Porter booking ID is required');
      return;
    }
    if (mode === 'inhouse' && !form.delivery_person_id) {
      toast.error('Select a delivery technician');
      return;
    }
    setSaving(true);
    try {
      await dispatchDC(dcNumber, { dispatch_mode: mode, ...form });
      toast.success('Dispatch confirmed');
      onDispatched?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Dispatch failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Dispatch {dcNumber}</h2>
        {qcBlocked ? (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            Cannot dispatch: Pre-dispatch QC not completed for all laptops.
          </div>
        ) : null}
        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            {['courier', 'porter', 'inhouse'].map((m) => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="dispatch_mode" checked={mode === m} onChange={() => setMode(m)} disabled={qcBlocked} />
                {m === 'inhouse' ? 'Inhouse Technician' : m.charAt(0).toUpperCase() + m.slice(1)}
              </label>
            ))}
          </div>
          {mode === 'courier' && (
            <>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Courier Name *" value={form.courier_name} onChange={(e) => setForm((f) => ({ ...f, courier_name: e.target.value }))} disabled={qcBlocked} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="AWB Number *" value={form.awb_number} onChange={(e) => setForm((f) => ({ ...f, awb_number: e.target.value }))} disabled={qcBlocked} />
            </>
          )}
          {mode === 'porter' && (
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter Booking ID *" value={form.porter_booking_id} onChange={(e) => setForm((f) => ({ ...f, porter_booking_id: e.target.value }))} disabled={qcBlocked} />
          )}
          {mode === 'inhouse' && (
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.delivery_person_id} onChange={(e) => setForm((f) => ({ ...f, delivery_person_id: e.target.value }))} disabled={qcBlocked}>
              <option value="">Select technician *</option>
              {technicians.map((t) => (
                <option key={t.technician_id || t.user_id} value={t.technician_id || t.id}>
                  {[t.first_name, t.last_name].filter(Boolean).join(' ') || t.name || t.email}
                </option>
              ))}
            </select>
          )}
          <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.estimated_delivery} onChange={(e) => setForm((f) => ({ ...f, estimated_delivery: e.target.value }))} disabled={qcBlocked} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Close</button>
            {!qcBlocked && (
              <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Dispatching…' : 'Confirm Dispatch'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
