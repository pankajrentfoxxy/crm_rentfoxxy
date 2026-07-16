import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { updateSoLineHsn } from '../salesPipelineApi';

export default function SoLineHsnEditModal({ open, line, onClose, onSaved }) {
  const [hsn, setHsn] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !line) return;
    setHsn(line.hsn_code ? String(line.hsn_code) : '');
  }, [open, line]);

  if (!open || !line) return null;

  const lineId = line.line_id || line.id;

  const handleSave = async () => {
    const trimmed = String(hsn || '').trim();
    if (!/^\d{4,8}$/.test(trimmed)) {
      toast.error('HSN/SAC must be 4–8 digits');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateSoLineHsn(lineId, { hsn_code: trimmed });
      toast.success(data.message || 'HSN updated');
      onSaved?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update HSN');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="border-b px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Override HSN / SAC</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Admin / Super Admin only — regenerates SO and linked DC PDFs.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-600">
            <p className="font-medium text-gray-900">{line.brand} {line.model_name}</p>
            <p className="text-xs mt-1 text-gray-500">
              Defaults: rental 997315 · sale 847130 · repair 847330
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">HSN / SAC *</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              value={hsn}
              onChange={(e) => setHsn(e.target.value)}
              placeholder="997315"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm border rounded-lg">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-3 py-2 text-sm bg-teal-700 text-white rounded-lg disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save HSN'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
