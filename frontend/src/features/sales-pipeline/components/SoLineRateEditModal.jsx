import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateSoLineRate } from '../salesPipelineApi';
import { formatCurrency } from '../salesPipelineUtils';

export default function SoLineRateEditModal({ open, line, onClose, onSaved }) {
  const [rate, setRate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !line) return;
    setRate(line.rate != null && line.rate !== '' ? String(line.rate) : '');
  }, [open, line]);

  if (!open || !line) return null;

  const lineId = line.line_id || line.id;
  const qty = Number(line.main_qty || line.quantity || line.ordered_qty || 1) || 1;
  const parsedRate = Number(rate);
  const lineSubtotal = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate * qty : null;

  const handleSave = async () => {
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      toast.error('Enter a valid positive rate');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateSoLineRate(lineId, { rate: parsedRate });
      const dcCount = data.dc_pdfs?.length || 0;
      toast.success(
        dcCount
          ? `Rate updated — SO and ${dcCount} DC PDF(s) regenerated`
          : (data.message || 'Rate updated')
      );
      onSaved?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update rate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="border-b px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Edit line rate</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Super Admin — updates SO and linked DC PDFs with recalculated GST.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-600">
            <p className="font-medium text-gray-900">{line.brand} {line.model_name}</p>
            <p className="text-xs mt-1">Qty: {qty}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Monthly rate (Rs.) *</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="27118.64"
            />
          </div>
          {lineSubtotal != null ? (
            <p className="text-xs text-gray-500">
              Line subtotal (pre-GST): <strong>{formatCurrency(lineSubtotal)}</strong>
            </p>
          ) : null}
        </div>
        <div className="border-t bg-gray-50 px-5 py-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-white">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & regenerate PDFs'}
          </button>
        </div>
      </div>
    </div>
  );
}
