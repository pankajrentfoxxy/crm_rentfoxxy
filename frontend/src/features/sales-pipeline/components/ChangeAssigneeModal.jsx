import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { updateDcAssignment } from '../salesPipelineApi';

function initialMode(head) {
  if (head.dispatch_mode) return head.dispatch_mode;
  if (head.ship_by === 'by_hand') return 'inhouse';
  if (head.ship_by === 'by_porter') return 'porter';
  return 'courier';
}

export default function ChangeAssigneeModal({
  open,
  dcNumber,
  head = {},
  technicians = [],
  onClose,
  onSaved,
}) {
  const [mode, setMode] = useState('courier');
  const [form, setForm] = useState({
    courier_name: '',
    awb_number: '',
    courier_tracking_url: '',
    porter_booking_id: '',
    porter_tracking_id: '',
    porter_order_id: '',
    porter_booking_url: '',
    delivery_person_id: '',
    estimated_delivery: '',
    reason: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const m = initialMode(head);
    setMode(m);
    setForm({
      courier_name: head.courier_name || '',
      awb_number: head.awb_number || '',
      courier_tracking_url: head.courier_tracking_url || '',
      porter_booking_id: head.porter_booking_id || '',
      porter_tracking_id: head.porter_tracking_id || head.porter_booking_id || '',
      porter_order_id: head.porter_order_id || '',
      porter_booking_url: head.porter_booking_url || '',
      delivery_person_id: head.delivery_person_id ? String(head.delivery_person_id) : '',
      estimated_delivery: head.estimated_delivery ? String(head.estimated_delivery).slice(0, 10) : '',
      reason: '',
    });
  }, [open, head]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'courier' && (!form.courier_name?.trim() || !form.awb_number?.trim())) {
      toast.error('Courier name and AWB are required');
      return;
    }
    if (mode === 'porter' && !String(form.porter_tracking_id || form.porter_booking_id).trim()) {
      toast.error('Porter booking / tracking ID is required');
      return;
    }
    if (mode === 'inhouse' && !form.delivery_person_id) {
      toast.error('Select a delivery technician');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateDcAssignment(dcNumber, {
        dispatch_mode: mode,
        ...form,
        reason: form.reason?.trim() || undefined,
      });
      toast.success(data?.message || 'Assignee updated — DC PDF regenerated');
      onSaved?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update assignee');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Change Assignee</h2>
        <p className="text-xs text-gray-500 mb-4">
          Update technician, courier, or porter before pickup/delivery starts. Changes are logged in activity history.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            {['courier', 'porter', 'inhouse'].map((m) => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="dispatch_mode" checked={mode === m} onChange={() => setMode(m)} />
                {m === 'inhouse' ? 'By Hand (Technician)' : m.charAt(0).toUpperCase() + m.slice(1)}
              </label>
            ))}
          </div>
          {mode === 'courier' && (
            <>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Courier Name *" value={form.courier_name} onChange={(e) => setForm((f) => ({ ...f, courier_name: e.target.value }))} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="AWB Number *" value={form.awb_number} onChange={(e) => setForm((f) => ({ ...f, awb_number: e.target.value }))} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Tracking URL (optional)" value={form.courier_tracking_url} onChange={(e) => setForm((f) => ({ ...f, courier_tracking_url: e.target.value }))} />
            </>
          )}
          {mode === 'porter' && (
            <>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter Tracking / Booking ID *" value={form.porter_tracking_id} onChange={(e) => setForm((f) => ({ ...f, porter_tracking_id: e.target.value, porter_booking_id: e.target.value }))} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter Order ID (optional)" value={form.porter_order_id} onChange={(e) => setForm((f) => ({ ...f, porter_order_id: e.target.value }))} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Booking URL (optional)" value={form.porter_booking_url} onChange={(e) => setForm((f) => ({ ...f, porter_booking_url: e.target.value }))} />
            </>
          )}
          {mode === 'inhouse' && (
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.delivery_person_id} onChange={(e) => setForm((f) => ({ ...f, delivery_person_id: e.target.value }))}>
              <option value="">Select technician *</option>
              {technicians.map((t) => (
                <option key={t.technician_id} value={t.technician_id}>
                  {[t.first_name, t.last_name].filter(Boolean).join(' ') || t.email || `Technician #${t.technician_id}`}
                </option>
              ))}
            </select>
          )}
          <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.estimated_delivery} onChange={(e) => setForm((f) => ({ ...f, estimated_delivery: e.target.value }))} />
          <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Reason for change (optional)" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & regenerate PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
