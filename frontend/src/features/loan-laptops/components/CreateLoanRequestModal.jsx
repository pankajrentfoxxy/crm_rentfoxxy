import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../../../components/ui/primitives';
import { PolicyBadge } from './LoanStatusBadge';
import { listAvailableLaptops, createLoan, errorMessage } from '../loanLaptopApi';
import { specLine } from '../loanConstants';

const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px]';
const label = 'block text-xs font-semibold text-slate-600 mb-1';

/** Pick an in-stock laptop for a repair pickup; the replacement policy is shown per laptop. */
export default function CreateLoanRequestModal({ ticketId, pickup, onClose, onCreated }) {
  const defaults = pickup.delivery_defaults || {};
  const [q, setQ] = useState('');
  const [laptops, setLaptops] = useState(null);
  const [selected, setSelected] = useState(null);
  const [addr, setAddr] = useState({
    name: defaults.contact_name || '',
    phone: defaults.contact_phone || '',
    address: defaults.address || '',
    city: defaults.city || '',
    state: defaults.state || '',
    pincode: defaults.pincode || '',
  });
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      listAvailableLaptops(pickup.item_id, q || undefined)
        .then(({ data }) => { if (live) setLaptops(data.data.laptops || []); })
        .catch((e) => { if (live) { setLaptops([]); toast.error(errorMessage(e, 'Failed to load stock')); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [pickup.item_id, q]);

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await createLoan({
        ticket_id: ticketId,
        pickup_item_id: pickup.item_id,
        loan_serial_id: selected.serial_id,
        delivery_address: addr,
        contact_name: addr.name,
        contact_phone: addr.phone,
        remarks,
      });
      toast.success(data.data.status === 'pending_approval'
        ? `${data.data.request_number} sent to Accounts for approval`
        : `${data.data.request_number} approved by policy — ready for Loan DC`);
      onCreated(data.data);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Request loan laptop</h2>
            <p className="text-xs text-slate-500">
              While <span className="font-mono">{pickup.ttspl_id}</span> is repaired · {specLine(pickup.original?.spec)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className={label}>Available laptops (in stock, QC passed)</label>
            <input className={input} placeholder="Search TTSPL, model, processor…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-2 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {laptops === null ? (
                <p className="p-4 text-sm text-slate-500">Loading…</p>
              ) : laptops.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No available laptops match</p>
              ) : laptops.map((l) => {
                const blocked = l.policy.decision === 'not_allowed';
                const active = selected?.serial_id === l.serial_id;
                return (
                  <button
                    key={l.serial_id}
                    type="button"
                    disabled={blocked}
                    onClick={() => setSelected(l)}
                    className={`w-full text-left p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${
                      active ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'} ${blocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="font-mono font-semibold text-slate-900">{l.ttspl_id}</span>
                      <span className="block text-xs text-slate-600 truncate">{specLine(l.spec)}</span>
                    </span>
                    <span className="shrink-0"><PolicyBadge decision={l.policy.decision} /></span>
                  </button>
                );
              })}
            </div>
            {selected && (
              <p className="text-xs text-slate-600 mt-2">
                {selected.policy.reason}
                {selected.policy.approval_required ? ' — Accounts will approve and set the rental price before the Loan DC.' : ''}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={label}>Contact name</label><input className={input} value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} /></div>
            <div><label className={label}>Contact phone</label><input className={input} value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className={label}>Delivery address</label><input className={input} value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} /></div>
            <div><label className={label}>City</label><input className={input} value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={label}>State</label><input className={input} value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} /></div>
              <div><label className={label}>Pincode</label><input className={input} value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value })} /></div>
            </div>
            <div className="sm:col-span-2"><label className={label}>Remarks</label><input className={input} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
          </div>
          <p className="text-xs text-slate-500">A loan laptop is never charged and no Sales Order is created. Rent only applies if the customer later keeps it and Accounts approve.</p>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} disabled={!selected || !addr.address.trim()} onClick={submit}>Request loan</Button>
        </div>
      </div>
    </div>
  );
}
