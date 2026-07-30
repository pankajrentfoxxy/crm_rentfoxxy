import React, { useState } from 'react';
import toast from 'react-hot-toast';

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function toDateInputValue(value) {
  if (!value) return todayInputValue();
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? todayInputValue() : d.toISOString().slice(0, 10);
}

/**
 * Confirm mark-delivered with an explicit delivery date (billing / customer asset anchor).
 */
export default function MarkDeliveredModal({
  dcNumber,
  title = 'Mark as Delivered',
  initialDate,
  confirmLabel = 'Confirm Delivery',
  onClose,
  onConfirm,
}) {
  const [deliveryDate, setDeliveryDate] = useState(toDateInputValue(initialDate));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!deliveryDate) {
      toast.error('Delivery date is required');
      return;
    }
    setSaving(true);
    try {
      await onConfirm({ delivered_at: deliveryDate });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
        {dcNumber ? (
          <p className="text-xs text-gray-500 font-mono mb-3">{dcNumber}</p>
        ) : null}
        <p className="text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-lg p-2 mb-4">
          This date becomes the customer delivery date and rental billing start anchor for laptops on this DC.
        </p>
        <label className="block mb-4">
          <span className="text-sm font-medium text-gray-700 block mb-1">Delivery date *</span>
          <input
            type="date"
            value={deliveryDate}
            max={todayInputValue()}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !deliveryDate}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export { todayInputValue, toDateInputValue };
