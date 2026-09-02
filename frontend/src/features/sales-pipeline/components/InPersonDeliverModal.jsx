import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, KeyRound } from 'lucide-react';
import { submitDeliveryWithPod } from '../salesPipelineApi';

/**
 * In-person (by-hand) delivery: technician asks the customer for the WhatsApp OTP
 * and cannot mark delivered without it.
 */
export default function InPersonDeliverModal({ dc, onClose, onDelivered }) {
  const [otp, setOtp] = useState('');
  const [podFile, setPodFile] = useState(null);
  const [podPreview, setPodPreview] = useState(null);
  const [notes, setNotes] = useState('');
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
    const code = otp.trim();
    if (!code) {
      toast.error('Enter the OTP the customer received on WhatsApp');
      return;
    }
    if (!podFile) {
      toast.error('Upload a POD photo of the delivered laptop');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('otp', code);
      fd.append('pod_type', 'photo');
      fd.append('notes', notes);
      fd.append('pod_photo', podFile);
      await submitDeliveryWithPod(dc.dc_number, fd);
      toast.success('Delivery confirmed');
      onDelivered?.();
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Invalid OTP or delivery failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h3 className="font-semibold text-gray-900 mb-1">Confirm in-person delivery</h3>
        <p className="text-xs text-slate-600 mb-4">
          {dc?.dc_number} · Ask the customer for the WhatsApp OTP. You cannot see the code.
        </p>

        <label className="block mb-3">
          <span className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
            <KeyRound className="w-4 h-4" /> Customer OTP*
          </span>
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            className="w-full border rounded-lg px-3 py-2.5 text-sm tracking-widest font-mono"
          />
        </label>

        <label className="block mb-3">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            POD Photo* <span className="text-red-500">(required)</span>
          </span>
          <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" id="inperson-pod" />
          <label htmlFor="inperson-pod" className="cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 text-center block hover:border-blue-300">
            {podPreview
              ? <img src={podPreview} alt="POD" className="max-h-40 mx-auto rounded-lg" />
              : (
                <>
                  <Upload className="w-8 h-8 text-gray-300 mx-auto mb-1" />
                  <p className="text-sm text-gray-500">Photo of the laptop at the customer site</p>
                </>
              )}
          </label>
        </label>

        <label className="block mb-4">
          <span className="text-sm font-medium text-gray-700 block mb-1">Notes</span>
          <textarea
            className="w-full border rounded-lg px-3 py-2 text-sm"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </label>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !otp.trim() || !podFile}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Confirming…' : 'Confirm delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}
