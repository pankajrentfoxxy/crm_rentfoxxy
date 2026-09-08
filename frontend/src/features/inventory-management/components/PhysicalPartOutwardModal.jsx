import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import {
  PHYSICAL_RECEIVER_TYPES,
  createPhysicalOutward,
  uploadPhysicalPartPhotos,
} from '../physicalDeadPartApi';
import { digitsOnly, todayIso } from '../physicalDeadPartUi';

export default function PhysicalPartOutwardModal({ parts, onClose }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [receiverType, setReceiverType] = useState('scrap_buyer');
  const [receiverName, setReceiverName] = useState('');
  const [receiverContact, setReceiverContact] = useState('');
  const [outwardDate, setOutwardDate] = useState(todayIso());
  const [purpose, setPurpose] = useState('');
  const [remarks, setRemarks] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [photos, setPhotos] = useState([]);

  const onPhotos = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    try {
      const data = await uploadPhysicalPartPhotos(files);
      const paths = data.paths || (data.path ? [data.path] : []);
      setPhotos((prev) => [
        ...prev,
        ...paths.map((path, i) => ({ path, preview: files[i] ? URL.createObjectURL(files[i]) : '' })),
      ]);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Photo upload failed');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!receiverName.trim() || !purpose.trim()) {
      toast.error('Receiver name and purpose are required');
      return;
    }
    if (receiverContact.length !== 10) {
      toast.error('Mobile number must be 10 digits');
      return;
    }
    const photoPaths = photos.map((p) => p.path).filter(Boolean);
    if (!photoPaths.length) {
      toast.error('At least one outward photo is required');
      return;
    }
    setBusy(true);
    try {
      const { data } = await createPhysicalOutward({
        part_ids: parts.map((p) => p.part_id),
        receiver_type: receiverType,
        receiver_name: receiverName.trim(),
        receiver_contact: receiverContact,
        outward_date: outwardDate,
        purpose: purpose.trim(),
        photo_path: photoPaths[0],
        photo_paths: photoPaths,
        remarks: remarks.trim() || undefined,
        reference_number: referenceNumber.trim() || undefined,
      });
      toast.success(`Draft outward ${data.outward.outward_number} created — e-sign and dispatch next`);
      onClose?.();
      navigate(`/inventory-management/physical-parts/outward/${encodeURIComponent(data.outward.outward_number)}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Outward failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <form onSubmit={submit} className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">Part Outward</h3>
            <p className="text-xs text-gray-500 mt-0.5">{parts.length} selected · creates a draft, then warehouse e-sign + gate</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          <div className="rounded-lg border bg-slate-50 p-3 text-xs space-y-1">
            {parts.map((p) => (
              <p key={p.part_id} className="font-mono text-slate-700">
                {p.dp_number} · {p.part_name}
              </p>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Receiver type *</span>
              <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={receiverType} onChange={(e) => setReceiverType(e.target.value)}>
                {PHYSICAL_RECEIVER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Receiver name *</span>
              <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} required />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Mobile number *</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                inputMode="numeric"
                maxLength={10}
                value={receiverContact}
                onChange={(e) => setReceiverContact(digitsOnly(e.target.value))}
                placeholder="10 digits"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Outward date *</span>
              <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={outwardDate} onChange={(e) => setOutwardDate(e.target.value)} required />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Purpose / reason *</span>
              <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Existing DC / challan / reference</span>
              <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Optional — SCRAP/…, VRDC/…, etc." />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Remarks</span>
              <textarea className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[64px]" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Outward photos * (multiple)</span>
              <input type="file" accept="image/*" multiple className="mt-1 block text-sm" onChange={onPhotos} />
              <div className="mt-2 flex flex-wrap gap-2">
                {photos.map((ph, i) => (
                  <span key={`${ph.path}-${i}`} className="relative">
                    <img src={ph.preview} alt="" className="h-16 w-16 rounded border object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, n) => n !== i))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border text-[10px]"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </label>
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-3 border rounded-lg text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="h-9 px-4 rounded-lg text-sm font-semibold bg-slate-900 text-white disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Create draft outward'}
          </button>
        </div>
      </form>
    </div>
  );
}
