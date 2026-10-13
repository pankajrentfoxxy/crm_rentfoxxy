import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Loader2, PackagePlus, Search } from 'lucide-react';
import { createPoInward, getRecentPoInwards, lookupPoForInward } from './guardGateApi';

const STATUS_LABEL = {
  pending_grn: 'Waiting for GRN',
  partially_received: 'GRN in progress',
  received: 'GRN done',
  closed: 'Closed',
};

/**
 * Guard counts the laptops that arrived against a vendor PO (e.g. 2 of 10).
 * Warehouse then takes a GRN for exactly this inward.
 */
export default function PoInwardPage() {
  const [poInput, setPoInput] = useState('');
  const [looking, setLooking] = useState(false);
  const [po, setPo] = useState(null);
  const [qty, setQty] = useState({});
  const [vendorDoc, setVendorDoc] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [recent, setRecent] = useState([]);

  const loadRecent = useCallback(async () => {
    try {
      const { data } = await getRecentPoInwards({ limit: 15 });
      setRecent(data?.data || []);
    } catch {
      /* list is informational */
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  async function onLookup(e) {
    e?.preventDefault();
    const q = poInput.trim();
    if (!q) return;
    setLooking(true);
    setPo(null);
    setSaved(null);
    setQty({});
    try {
      const { data } = await lookupPoForInward(q);
      setPo(data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Purchase order not found');
    } finally {
      setLooking(false);
    }
  }

  const total = Object.values(qty).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);

  async function onSave() {
    if (!po) return;
    const lines = po.lines
      .map((l) => ({ line_index: l.line_index, qty: parseInt(qty[l.line_index], 10) || 0 }))
      .filter((l) => l.qty > 0);
    if (!lines.length) {
      toast.error('Enter how many laptops arrived');
      return;
    }
    for (const l of lines) {
      const max = po.lines[l.line_index].available_to_inward;
      if (l.qty > max) {
        toast.error(`Product ${l.line_index + 1}: at most ${max} laptop(s) can be inwarded`);
        return;
      }
    }
    if (!vendorDoc.trim()) {
      toast.error("Enter the vendor's challan / delivery note number");
      return;
    }
    if (!window.confirm(`Inward ${total} laptop(s) against ${po.purchase_order_number}?`)) return;
    setSaving(true);
    try {
      const { data } = await createPoInward({
        po_id: po.po_id,
        lines,
        vendor_doc_number: vendorDoc.trim(),
        vehicle_number: vehicle.trim() || undefined,
        remarks: remarks.trim() || undefined,
      });
      toast.success(data.message || 'Inward saved');
      setSaved(data.data);
      setPo(null);
      setQty({});
      setVendorDoc('');
      setVehicle('');
      setRemarks('');
      setPoInput('');
      loadRecent();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save the inward');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <PackagePlus className="w-5 h-5 text-teal-600" />
          <h1 className="text-base font-semibold text-slate-900 m-0">PO Inward</h1>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Vendor delivery against a purchase order: enter the PO number, then count the laptops that arrived.
        </p>
        <form onSubmit={onLookup} className="flex gap-2">
          <input
            value={poInput}
            onChange={(e) => setPoInput(e.target.value)}
            placeholder="PO number, e.g. PO-0237"
            className="flex-1 min-w-0 border border-slate-300 rounded-xl px-3 py-2.5 text-sm uppercase"
            autoFocus
          />
          <button
            type="submit"
            disabled={looking || !poInput.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 text-white px-4 text-sm font-semibold disabled:opacity-50"
          >
            {looking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Find
          </button>
        </form>
      </div>

      {saved ? (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-900">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-5 h-5" /> {saved.inward_number} saved
          </div>
          <p className="mt-1 mb-0">
            {saved.total_qty} laptop(s) inwarded against {saved.purchase_order_number}. Hand them to the warehouse for GRN.
          </p>
        </div>
      ) : null}

      {po ? (
        <div className="rounded-2xl bg-white p-4 shadow-sm space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 m-0">{po.purchase_order_number}</p>
            <p className="text-xs text-slate-500 m-0">{po.vendor_name || 'Vendor'}</p>
          </div>
          {po.blocked_reason ? (
            <p className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3 m-0">{po.blocked_reason}</p>
          ) : null}
          <div className="space-y-2">
            {po.lines.map((l) => (
              <div key={l.line_index} className="rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-900 m-0">
                  {l.line_index + 1}. {l.label}
                </p>
                <p className="text-xs text-slate-500 mt-1 mb-2">
                  Ordered {l.ordered} · Received {l.received} · At gate (waiting GRN) {l.pending_grn}
                </p>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600" htmlFor={`qty-${l.line_index}`}>Arrived now</label>
                  <input
                    id={`qty-${l.line_index}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={l.available_to_inward}
                    disabled={!!po.blocked_reason || l.available_to_inward <= 0}
                    value={qty[l.line_index] ?? ''}
                    onChange={(e) => setQty((q) => ({ ...q, [l.line_index]: e.target.value }))}
                    placeholder="0"
                    className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-right disabled:bg-slate-100"
                  />
                  <span className="text-xs text-slate-500">max {l.available_to_inward}</span>
                </div>
              </div>
            ))}
          </div>
          {!po.blocked_reason ? (
            <>
              <input
                value={vendorDoc}
                onChange={(e) => setVendorDoc(e.target.value)}
                placeholder="Vendor challan / delivery note no. (required)"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
              <input
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
                placeholder="Vehicle / courier AWB (optional)"
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Remarks (optional)"
                rows={2}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={onSave}
                disabled={saving || total < 1}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 text-white py-3 text-sm font-semibold disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
                Inward {total || ''} laptop(s)
              </button>
            </>
          ) : null}
          {po.inwards?.length ? (
            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-600 mb-1">Earlier inwards on this PO</p>
              {po.inwards.map((i) => (
                <p key={i.inward_id} className="text-xs text-slate-600 m-0">
                  {i.inward_number} · {i.total_qty} laptop(s) · {STATUS_LABEL[i.status] || i.status}
                  {i.grn_number ? ` · ${i.grn_number}` : ''}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {recent.length ? (
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900 mb-2">Recent PO inwards</p>
          <div className="divide-y divide-slate-100">
            {recent.map((i) => (
              <div key={i.inward_id} className="py-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-slate-800">{i.inward_number} · {i.purchase_order_number}</span>
                  <span className="text-slate-500">{STATUS_LABEL[i.status] || i.status}</span>
                </div>
                <p className="text-slate-500 m-0">
                  {i.total_qty} laptop(s) · {i.vendor_name || 'Vendor'} · {new Date(i.created_at).toLocaleString()}
                  {i.grn_number ? ` · ${i.grn_number}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
