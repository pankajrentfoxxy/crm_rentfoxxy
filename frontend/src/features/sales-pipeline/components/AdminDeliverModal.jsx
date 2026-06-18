import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Upload } from 'lucide-react';
import { adminDeliverOverride } from '../salesPipelineApi';

/**
 * Admin override "Mark Delivered" — requires a POD photo of the delivered laptop.
 */
export default function AdminDeliverModal({ dc, onClose, onDelivered }) {
  const [podFile, setPodFile] = useState(null);
  const [podPreview, setPodPreview] = useState(null);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPodFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setPodPreview(ev.target.result);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    if (!podFile) {
      toast.error('Please upload a POD photo first');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('pod_photo', podFile);
      fd.append('notes', notes);
      fd.append('reason', reason || 'Admin override delivery');
      await adminDeliverOverride(dc.dc_number, fd);
      toast.success('Delivery marked with POD');
      onDelivered?.();
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h3 className="font-semibold text-gray-900 mb-1">Mark as Delivered — {dc?.dc_number}</h3>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-4">
          Admin override. A POD photo is required.
        </p>

        <label className="block mb-3">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            POD Photo* <span className="text-red-500">(required)</span>
          </span>
          <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="admin-pod" />
          <label htmlFor="admin-pod" className="cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 text-center block hover:border-blue-300">
            {podPreview
              ? <img src={podPreview} alt="POD" className="max-h-40 mx-auto rounded-lg" />
              : <><Upload className="w-8 h-8 text-gray-300 mx-auto mb-1" /><p className="text-sm text-gray-500">Click to upload POD photo</p></>}
          </label>
        </label>

        <label className="block mb-3">
          <span className="text-sm font-medium text-gray-700 block mb-1">Reason</span>
          <input className="w-full border rounded-lg px-3 py-2 text-sm"
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Why marking without OTP?" />
        </label>

        <label className="block mb-4">
          <span className="text-sm font-medium text-gray-700 block mb-1">Notes</span>
          <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2}
            value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes" />
        </label>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving || !podFile}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Confirm Delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}
