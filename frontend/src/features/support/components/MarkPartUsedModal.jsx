import React, { useState } from 'react';
import { X, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import { markPartUsed } from '../supportPartsApi';

export default function MarkPartUsedModal({ open, onClose, request, onSuccess }) {
  const [collected, setCollected] = useState(true);
  const [condition, setCondition] = useState('defective');
  const [notes, setNotes] = useState('');
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open || !request) return null;

  const needsOldPart = request.collect_old_part
    && request.old_part_collection_method === 'tech_collection'
    && request.old_part_status === 'pending';

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await markPartUsed(request.id, needsOldPart ? {
        old_part_collected: collected,
        old_part_condition: condition,
        old_part_notes: notes.trim() || null,
        old_part_serial: serial.trim() || null,
      } : {});
      toast.success(data.message || 'Part marked as used');
      onSuccess?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold">Mark part used</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-600">
            {request.part_name} on {request.ttspl_id || request.ticket_number}
          </p>

          {needsOldPart && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-sm font-semibold text-amber-900">Collect old/damaged part</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={collected} onChange={(e) => setCollected(e.target.checked)} />
                I collected the old part from the laptop
              </label>
              {collected && (
                <>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                  >
                    <option value="defective">Defective / damaged</option>
                    <option value="worn">Worn</option>
                    <option value="good">Good (reusable)</option>
                  </select>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    placeholder="Old part serial (optional)"
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                  />
                  <textarea
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    rows={2}
                    placeholder="Notes (optional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  <p className="text-xs text-amber-700">
                    The old part will appear in your bucket. Submit RPDC to hand it to warehouse.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
        <div className="border-t px-4 py-3 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button
            type="button"
            disabled={busy || (needsOldPart && !collected)}
            onClick={submit}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Confirm used'}
          </button>
        </div>
      </div>
    </div>
  );
}
