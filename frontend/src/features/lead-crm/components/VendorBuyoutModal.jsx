import React, { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { recordVendorBuyout } from '../../../utils/saleInPlaceApi';

/**
 * Procurement records the vendor's buyout bill for a vendor-rented laptop the
 * customer is keeping. The unit becomes ours (per serial — the vendor PO is not
 * touched) and its sale-in-place order is confirmed automatically.
 */
export default function VendorBuyoutModal({ asset, onClose, onDone }) {
  const [billNo, setBillNo] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBillNo('');
    setAmount('');
  }, [asset]);

  if (!asset) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!billNo.trim()) { toast.error('Enter the vendor bill number'); return; }
    if (!(Number(amount) > 0)) { toast.error('Enter the buyout amount'); return; }
    setSaving(true);
    try {
      const res = await recordVendorBuyout(asset.serial_id, { vendor_bill_no: billNo.trim(), amount: Number(amount) });
      toast.success(res.message || 'Vendor buyout recorded');
      onDone?.(res.data);
      onClose?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Could not record the buyout');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <form onSubmit={submit} className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900">Record vendor buyout</h3>
            <p className="text-xs text-slate-500 font-mono">{asset.ttspl_id || asset.serial_number}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block text-xs font-medium text-slate-600">Vendor bill number *
            <input
              value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">Buyout amount (₹) *
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <p className="text-[11px] text-slate-500">
            The laptop becomes owned by us. If it is on a sale-in-place order, the sale completes now and the
            laptop moves to the customer&apos;s Purchased tab. Other laptops on the vendor&apos;s PO keep billing normally.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Record buyout
          </button>
        </div>
      </form>
    </div>
  );
}
