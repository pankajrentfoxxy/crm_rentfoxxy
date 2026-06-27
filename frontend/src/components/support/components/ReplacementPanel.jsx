import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import PickupSetupForm from './PickupSetupForm';

function specLine(item) {
  return [item.brand, item.model, item.processor, item.generation, item.ram, item.storage]
    .filter(Boolean)
    .join(' · ');
}

export default function ReplacementPanel({ ticketId, ticket, customerId, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [eligibleItems, setEligibleItems] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deliveryDefaults, setDeliveryDefaults] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/support/tickets/${ticketId}/replacement-context`)
      .then((r) => {
        const items = r.data.eligible_items || [];
        setEligibleItems(items);
        setSelectedIds(new Set(items.map((i) => String(i.id))));
        setDeliveryDefaults(r.data.delivery_defaults || null);
        setReason(items[0]?.replacement_flag_reason || '');
        if (r.data.active_order?.sales_order_number) {
          toast.error('A replacement order already exists on this ticket');
        }
      })
      .catch(() => {
        setEligibleItems([]);
        toast.error('Could not load replacement details');
      })
      .finally(() => setLoading(false));
  }, [ticketId]);

  const toggleItem = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(String(id))) next.delete(String(id));
      else next.add(String(id));
      return next;
    });
  };

  const submitReplacement = async (pickupForm) => {
    const ids = [...selectedIds].map(Number);
    if (!ids.length) {
      toast.error('Select at least one laptop');
      return;
    }
    setBusy(true);
    try {
      const addr = pickupForm.pickup_address || {};
      const res = await api.post(`/support/tickets/${ticketId}/replacements`, {
        source_item_ids: ids,
        reason,
        contact_name: addr.name,
        contact_phone: addr.phone,
        pickup_address: addr,
        dispatch_mode: pickupForm.dispatch_mode,
        technician_user_id: pickupForm.technician_user_id,
        courier_name: pickupForm.courier_name,
        awb_number: pickupForm.awb_number,
        porter_tracking_id: pickupForm.porter_tracking_id,
        porter_order_id: pickupForm.porter_order_id,
      });
      const d = res.data || {};
      toast.success(`Sales order ${d.sales_order_number} created · Return DC ${d.return_dc_number}`);
      if (d.customer_otp_visible) {
        toast(`Pickup OTP: ${d.customer_otp_visible}`, { duration: 12000, icon: '🔑' });
      }
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to create replacement order');
    } finally {
      setBusy(false);
    }
  };

  const referenceItem = eligibleItems.find((i) => selectedIds.has(String(i.id))) || eligibleItems[0];

  if (loading) {
    return (
      <section className="bg-white border border-pink-200 rounded-xl p-4">
        <p className="text-sm text-slate-500">Loading…</p>
      </section>
    );
  }

  if (!eligibleItems.length) {
    return (
      <section className="bg-white border border-pink-200 rounded-xl p-4 space-y-3">
        <p className="text-sm text-slate-600">No complaint items are marked for replacement.</p>
        <button type="button" className="support-btn-outline w-full min-h-[44px]" onClick={onCancel}>Close</button>
      </section>
    );
  }

  return (
    <section className="bg-white border border-pink-200 rounded-xl p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-pink-900">Create replacement order</h3>
        <p className="text-sm text-slate-600 mt-1">
          Step 1 — Creates one sales order (laptop config + same rent) and one return DC to pick up faulty units.
          Step 2 — Attach stock laptops on the sales order, pass Dispatch QC, then create delivery DC.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Laptops to replace</p>
        {eligibleItems.map((item) => (
          <label
            key={item.id}
            className={`flex gap-3 items-start rounded-lg border p-3 cursor-pointer ${
              selectedIds.has(String(item.id)) ? 'border-pink-400 bg-pink-50' : 'border-slate-200'
            }`}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={selectedIds.has(String(item.id))}
              onChange={() => toggleItem(item.id)}
            />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-mono font-semibold text-slate-800">{item.ttspl_id}</p>
              <p className="text-slate-600">{specLine(item) || item.model || '—'}</p>
              {item.rent_monthly_rate != null && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Rent ₹{Number(item.rent_monthly_rate).toLocaleString('en-IN')}/mo → carried to replacement SO line
                </p>
              )}
            </div>
          </label>
        ))}
      </div>

      <textarea
        className="w-full border rounded-lg p-3 min-h-[64px] text-base"
        placeholder="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-900 space-y-1">
        <p className="font-semibold">After you submit</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Open the sales order and attach QC-passed laptops (one per line)</li>
          <li>Complete Dispatch QC → Create delivery DC → Assign to delivery</li>
          <li>Pick up faulty laptops on the Return DC (Pickup tab / My Deliveries)</li>
        </ol>
      </div>

      <PickupSetupForm
        ticket={{
          ...ticket,
          customer_name: deliveryDefaults?.contact_name || ticket.customer_name,
        }}
        customerId={customerId}
        sourceItem={referenceItem ? { ttspl_id: referenceItem.ttspl_id, serial_number: referenceItem.serial_number } : null}
        fixedPickupType="return"
        hidePickupType
        hideMachinePreview
        saving={busy}
        submitLabel={`Create sales order + return DC (${selectedIds.size} laptop${selectedIds.size > 1 ? 's' : ''})`}
        onSubmit={submitReplacement}
      />

      <button type="button" className="support-btn-outline w-full min-h-[44px]" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </section>
  );
}
