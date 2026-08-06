import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { getSoLineCancelEligibility, partialCancelSoLine } from '../salesPipelineApi';

function LineSummary({ line }) {
  const title = [line.brand, line.model_name || line.model].filter(Boolean).join(' - ');
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="font-semibold text-slate-900">{title || 'Line'}</p>
      <p className="text-slate-600 mt-1">
        Ordered: <strong>{line.main_qty || line.quantity}</strong>
      </p>
    </div>
  );
}

export default function SoPartialCancelModal({ open, line, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [cancelQty, setCancelQty] = useState('1');
  const [reason, setReason] = useState('');

  const lineId = line?.line_id || line?.id;

  useEffect(() => {
    if (!open || !lineId) return;
    setLoading(true);
    setCancelQty('1');
    setReason('');
    getSoLineCancelEligibility(lineId)
      .then((res) => setEligibility(res.data?.eligibility || null))
      .catch((err) => {
        toast.error(err.response?.data?.message || 'Could not load cancel eligibility');
        setEligibility(null);
      })
      .finally(() => setLoading(false));
  }, [open, lineId]);

  if (!open || !line) return null;

  const maxQty = Number(eligibility?.cancellable_qty || 0);
  const parsedQty = parseInt(cancelQty, 10);

  const handleSubmit = async () => {
    if (!Number.isFinite(parsedQty) || parsedQty < 1) {
      toast.error('Enter a valid quantity to cancel');
      return;
    }
    if (parsedQty > maxQty) {
      toast.error(`Maximum ${maxQty} unit(s) can be cancelled on this line`);
      return;
    }
    if (!window.confirm(`Cancel ${parsedQty} unit(s) from this order line? This cannot be undone.`)) return;

    setSaving(true);
    try {
      const { data } = await partialCancelSoLine(lineId, {
        cancel_qty: parsedQty,
        reason: reason.trim() || undefined,
      });
      toast.success(data.message || 'Order line updated');
      onSaved?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel units');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="border-b px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Partial cancel</h2>
            <p className="text-sm text-slate-500">Reduce order quantity — only undispatched units</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <LineSummary line={line} />

          {loading ? (
            <p className="text-sm text-slate-500">Checking which units can be cancelled…</p>
          ) : eligibility ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-emerald-50 px-3 py-2">
                  <span className="text-emerald-800 font-medium">Can cancel</span>
                  <p className="text-xl font-bold text-emerald-900">{eligibility.cancellable_qty}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-slate-600 font-medium">Pending slots</span>
                  <p className="text-xl font-bold text-slate-900">{eligibility.pending_slots}</p>
                </div>
                <div className="rounded-lg bg-teal-50 px-3 py-2">
                  <span className="text-teal-800 font-medium">Attached</span>
                  <p className="text-lg font-bold text-teal-900">{eligibility.attached_qty}</p>
                </div>
                <div className="rounded-lg bg-amber-50 px-3 py-2">
                  <span className="text-amber-900 font-medium">In transit</span>
                  <p className="text-lg font-bold text-amber-900">{eligibility.in_transit_qty}</p>
                </div>
                <div className="rounded-lg bg-blue-50 px-3 py-2 col-span-2">
                  <span className="text-blue-800 font-medium">Delivered (locked)</span>
                  <p className="text-lg font-bold text-blue-900">{eligibility.delivered_qty}</p>
                </div>
              </div>

              {!eligibility.can_cancel ? (
                <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  No units can be cancelled on this line. Units in transit or already delivered must complete
                  or be rejected and returned before cancellation.
                </p>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="text-slate-600">Units to cancel</span>
                    <input
                      type="number"
                      min={1}
                      max={maxQty}
                      value={cancelQty}
                      onChange={(e) => setCancelQty(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-slate-600">Reason (optional)</span>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      placeholder="Customer requested reduction…"
                    />
                  </label>
                  <p className="text-xs text-slate-500">
                    Attached laptops will be released back to inventory. Units without a DC are removed from the order quantity.
                  </p>
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-red-600">Unable to load eligibility for this line.</p>
          )}
        </div>

        <div className="border-t px-5 py-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm">
            Close
          </button>
          {eligibility?.can_cancel ? (
            <button
              type="button"
              disabled={saving || loading}
              onClick={handleSubmit}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Cancelling…' : 'Confirm cancel'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
