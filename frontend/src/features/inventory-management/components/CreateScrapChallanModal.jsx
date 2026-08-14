import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import { createScrapChallan } from '../scrapChallanApi';

export default function CreateScrapChallanModal({ units, onClose }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactMobile, setContactMobile] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [remarks, setRemarks] = useState('');
  const [itemRemarks, setItemRemarks] = useState(() => {
    const map = {};
    for (const u of units || []) {
      map[u.instance_id] = u.notes || '';
    }
    return map;
  });

  const totalCost = useMemo(
    () => (units || []).reduce((s, u) => s + (Number(u.unit_cost) || 0), 0),
    [units]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (!recipientName.trim() || !recipientAddress.trim()) {
      toast.error('Recipient name and address are required');
      return;
    }
    setBusy(true);
    try {
      const { data } = await createScrapChallan({
        instance_ids: units.map((u) => u.instance_id),
        recipient_name: recipientName.trim(),
        recipient_address: recipientAddress.trim(),
        contact_person: contactPerson.trim() || undefined,
        contact_mobile: contactMobile.trim() || undefined,
        billing_address: billingAddress.trim() || undefined,
        remarks: remarks.trim() || undefined,
        item_remarks: itemRemarks,
      });
      toast.success(`Created ${data.challan_number}`);
      onClose?.();
      navigate(`/inventory-management/scrap-challans/${encodeURIComponent(data.challan_number)}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create scrap challan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">Convert to Scrap Challan</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {units.length} part{units.length === 1 ? '' : 's'} · declared ₹{totalCost.toLocaleString('en-IN')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Recipient name *</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Recipient address *</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[72px]"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Contact person</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Contact mobile</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={contactMobile}
                onChange={(e) => setContactMobile(e.target.value)}
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Billing address</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[56px]"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder="Defaults to recipient address on PDF if blank"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Challan remarks</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[56px]"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </label>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
              Per-item remarks
            </div>
            <ul className="divide-y max-h-48 overflow-y-auto">
              {units.map((u) => (
                <li key={u.instance_id} className="p-3 space-y-1">
                  <p className="text-sm font-mono text-slate-800">
                    {u.prt_id}
                    <span className="text-slate-500 font-sans ml-2">{u.part_name}</span>
                  </p>
                  <input
                    className="w-full border rounded-lg px-2 py-1.5 text-sm"
                    value={itemRemarks[u.instance_id] || ''}
                    onChange={(e) => setItemRemarks((prev) => ({ ...prev, [u.instance_id]: e.target.value }))}
                    placeholder="Discard / scrap reason"
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 border rounded-lg text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create Scrap Challan
          </button>
        </div>
      </form>
    </div>
  );
}
