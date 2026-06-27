import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import PickupSetupForm from './PickupSetupForm';

export default function ReplacementPanel({ ticketId, ticket, sourceItem, customerId, onDone, onCancel }) {
  const [assets, setAssets] = useState([]);
  const [assetId, setAssetId] = useState('');
  const [reason, setReason] = useState(sourceItem.replacement_flag_reason || '');
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState(null);
  const [loadingCtx, setLoadingCtx] = useState(true);

  useEffect(() => {
    api.get(`/support/customers/${customerId}/available-assets`)
      .then((r) => setAssets(r.data.assets || []))
      .catch(() => setAssets([]));
  }, [customerId]);

  useEffect(() => {
    setLoadingCtx(true);
    api.get(`/support/tickets/${ticketId}/replacement-context`, { params: { source_item_id: sourceItem.id } })
      .then((r) => setContext(r.data))
      .catch(() => setContext(null))
      .finally(() => setLoadingCtx(false));
  }, [ticketId, sourceItem.id]);

  const submitReplacement = async (pickupForm) => {
    if (!assetId) return;
    setBusy(true);
    try {
      const addr = pickupForm.pickup_address || {};
      const res = await api.post(`/support/tickets/${ticketId}/replacements`, {
        source_item_id: sourceItem.id,
        new_serial_id: Number(assetId),
        reason,
        contact_name: addr.name,
        contact_phone: addr.phone,
        pickup_address: addr,
        dispatch_mode: pickupForm.dispatch_mode,
        technician_user_id: pickupForm.technician_user_id,
        outbound_technician_user_id: pickupForm.technician_user_id,
        courier_name: pickupForm.courier_name,
        awb_number: pickupForm.awb_number,
        porter_tracking_id: pickupForm.porter_tracking_id,
        porter_order_id: pickupForm.porter_order_id,
      });
      const d = res.data || {};
      toast.success(
        `Replacement created — SO ${d.sales_order_number || ''}, DC ${d.dc_number || ''}, Return ${d.return_dc_number || ''}`
      );
      if (d.customer_otp_visible) {
        toast(`Customer pickup OTP: ${d.customer_otp_visible}`, { duration: 12000, icon: '🔑' });
      }
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to create replacement');
    } finally {
      setBusy(false);
    }
  };

  const oldMachine = context?.old_machine;
  const selectedAsset = assets.find((a) => String(a.id) === String(assetId));

  return (
    <section className="bg-white border border-pink-200 rounded-xl p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-pink-900">Initiate replacement</h3>
        <p className="text-sm text-slate-600 mt-1">
          Creates a sales order + outbound delivery DC for the new laptop, and a Return DC to pick up the faulty unit.
          Billing on the new laptop starts at delivery (same rent as the old unit). Billing on the old unit stops when picked up.
        </p>
      </div>

      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
        <p className="text-xs uppercase tracking-wide text-slate-500">Faulty laptop (to pick up)</p>
        <p className="font-mono font-semibold">{sourceItem.ttspl_id || sourceItem.unique_serial_number || sourceItem.serial_number}</p>
        <p>{sourceItem.model}</p>
        {oldMachine?.rent_monthly_rate != null && (
          <p className="text-xs text-slate-600">Current rent: ₹{Number(oldMachine.rent_monthly_rate).toLocaleString('en-IN')}/mo (carried to replacement)</p>
        )}
      </div>

      <div>
        <label className="text-sm font-semibold text-gray-700 block mb-2">Replacement laptop*</label>
        <select
          className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base"
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
        >
          <option value="">{assets.length ? 'Select replacement machine' : 'No QC-passed machines available in stock'}</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {(a.unique_serial_number || a.serial_number)} · {[a.model_name, a.ram, a.storage].filter(Boolean).join(' · ')}
            </option>
          ))}
        </select>
      </div>

      <textarea
        className="w-full border rounded-lg p-3 min-h-[72px] text-base"
        placeholder="Replacement reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      {loadingCtx ? (
        <p className="text-sm text-slate-500">Loading delivery address from last DC…</p>
      ) : (
        <PickupSetupForm
          ticket={ticket}
          customerId={customerId}
          sourceItem={sourceItem}
          selectedAsset={selectedAsset}
          fixedPickupType="return"
          hidePickupType
          saving={busy}
          submitLabel="Create SO + Delivery DC + Return DC"
          onSubmit={submitReplacement}
        />
      )}

      <button type="button" className="support-btn-outline w-full min-h-[44px]" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </section>
  );
}
