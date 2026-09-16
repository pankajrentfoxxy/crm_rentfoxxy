import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { reportSaleInPlace, SALE_IN_PLACE_REASONS } from '../../../utils/saleInPlaceApi';

/** Local YYYY-MM-DD — never toISOString(), which shifts the day in IST. */
function todayYmd() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Report rented laptops as lost / damaged / bought out, so they can be sold to the
 * customer where they already are. Stops rent from the reported date and raises the
 * credit note for the unused prepaid days.
 */
export default function SaleInPlaceModal({ open, customerId, assets = [], onClose, onDone }) {
  const [selected, setSelected] = useState(() => new Set());
  const [reason, setReason] = useState('lost');
  const [reportedOn, setReportedOn] = useState(todayYmd());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Only units actually on rent can be sold in place.
  const eligible = useMemo(
    () => assets.filter((a) => String(a.status || a.inventory_status || '').toLowerCase() === 'rented'),
    [assets]
  );

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setReason('lost');
    setReportedOn(todayYmd());
    setNotes('');
  }, [open]);

  if (!open) return null;

  const toggle = (serialId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(serialId)) next.delete(serialId); else next.add(serialId);
      return next;
    });
  };

  const monthlyStopped = eligible
    .filter((a) => selected.has(a.serial_id))
    .reduce((sum, a) => sum + Number(a.rent_monthly_rate || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!selected.size) return toast.error('Select at least one laptop');
    if (!reportedOn) return toast.error('Pick the date rent should stop');
    setSaving(true);
    try {
      const res = await reportSaleInPlace(customerId, {
        serial_ids: [...selected],
        reason,
        reported_on: reportedOn,
        notes: notes.trim() || null,
      });
      toast.success(res.message || 'Reported');
      onDone?.(res.data);
      onClose?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not report these laptops');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl border border-slate-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900">Report lost / damaged / buyout</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Stops rent and credits the unused prepaid days. The laptop stays with the customer.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Reason</span>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {SALE_IN_PLACE_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Stop rent from</span>
              <input
                type="date"
                value={reportedOn}
                max={todayYmd()}
                onChange={(e) => setReportedOn(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-600">
                Laptops on rent ({eligible.length})
              </span>
              {selected.size > 0 && (
                <span className="text-xs text-slate-500">
                  {selected.size} selected — {money(monthlyStopped)}/month stops
                </span>
              )}
            </div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {eligible.length === 0 && (
                <p className="px-3 py-4 text-sm text-slate-500">
                  This customer has no laptops currently on rent.
                </p>
              )}
              {eligible.map((a) => (
                <label key={a.serial_id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(a.serial_id)}
                    onChange={() => toggle(a.serial_id)}
                    className="rounded border-slate-300"
                  />
                  <span className="font-mono text-sm text-slate-800">{a.ttspl_id || a.serial_number}</span>
                  <span className="text-xs text-slate-500 flex-1 truncate">
                    {[a.brand, a.model_name || a.model].filter(Boolean).join(' ')}
                  </span>
                  <span className="text-xs text-slate-600">{money(a.rent_monthly_rate)}/mo</span>
                </label>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Reference, who confirmed it, claim number…"
            />
          </label>

          <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Rent stops immediately and a credit note is raised for the unused prepaid days.
              Next, raise a sale order in <strong>Sale in place</strong> mode to sell these units
              to the customer — no delivery challan and no e-way bill are produced.
              Any unit rented from a vendor must have its buyout bill recorded before the sale
              can be confirmed.
            </p>
          </div>
        </form>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !selected.size}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Stop rent {selected.size ? `for ${selected.size}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
