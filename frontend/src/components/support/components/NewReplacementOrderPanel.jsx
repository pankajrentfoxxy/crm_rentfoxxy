import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, PackagePlus } from 'lucide-react';
import api from '../../../utils/api';
import PickupSetupForm from './PickupSetupForm';
import ReturnDcNumberLink from './ReturnDcNumberLink';
import { replacementSalesOrderDetailPath } from '../../../features/sales-pipeline/salesOrderScope';

function specLine(item) {
  return [item.brand, item.model, item.processor, item.generation, item.ram, item.storage]
    .filter(Boolean)
    .join(' · ');
}

export default function NewReplacementOrderPanel({
  ticket,
  ticketId,
  isLead,
  onRefresh,
  onCreated,
  variant = 'inline',
}) {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [reason, setReason] = useState('Send a different laptop to customer — faulty unit already in warehouse');
  const [createdSo, setCreatedSo] = useState(null);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/support/tickets/${ticketId}/return-redelivery-context`);
      setCtx(data);
      const ids = (data.eligible_items || []).map((i) => String(i.pickup_item_id));
      setSelected(new Set(ids));
    } catch (e) {
      setCtx(null);
      toast.error(e.response?.data?.message || 'Could not load replacement options');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const eligible = ctx?.eligible_items || [];
  const selectedItems = useMemo(
    () => eligible.filter((i) => selected.has(String(i.pickup_item_id))),
    [eligible, selected]
  );

  const submit = async (pickupForm) => {
    const ids = selectedItems.map((i) => i.pickup_item_id);
    if (!ids.length) {
      toast.error('Select at least one unit');
      return;
    }
    setSaving(true);
    try {
      const addr = pickupForm.pickup_address || {};
      const { data } = await api.post(`/support/tickets/${ticketId}/return-redelivery`, {
        pickup_item_ids: ids,
        reason,
        contact_name: addr.name,
        contact_phone: addr.phone,
        pickup_address: addr,
      });
      toast.success(`New replacement SO ${data.sales_order_number} created`);
      setCreatedSo(data.sales_order_number);
      setShowForm(false);
      onRefresh?.();
      onCreated?.(data.sales_order_number);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to create replacement order');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-pink-200 bg-pink-50/40 p-4 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking eligibility…
      </div>
    );
  }

  if (createdSo) {
    const soPath = replacementSalesOrderDetailPath(createdSo);
    return (
      <div className="rounded-xl border border-pink-200 bg-pink-50/40 p-4 space-y-2">
        <p className="text-sm font-semibold text-pink-900">New replacement order created</p>
        <p className="text-xs text-pink-900/80">
          Sales order <span className="font-mono font-semibold">{createdSo}</span> is ready in Sales Pipeline.
          Attach a different QC-passed laptop, complete Dispatch QC, then create the delivery DC.
        </p>
        <Link to={soPath} className="inline-flex text-xs font-semibold text-pink-800 underline">
          Open SO {createdSo} →
        </Link>
      </div>
    );
  }

  if (!ctx?.can_create) {
    return (
      <p className="text-sm text-slate-500 rounded-lg border border-dashed border-pink-200 bg-pink-50/30 p-4">
        {ctx?.block_reason || 'Cannot create a new replacement order on this ticket right now.'}
      </p>
    );
  }

  const referencePickup = eligible[0];

  return (
    <div className="rounded-xl border border-pink-200 bg-pink-50/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-pink-900 flex items-center gap-2">
            <PackagePlus className="w-4 h-4" /> Send another laptop (new replacement order)
          </p>
          <p className="text-xs text-pink-900/80 mt-1">
            Creates a <strong>new</strong> replacement sales order
            {ctx.previous_sales_order_number ? (
              <> (does not reuse <span className="font-mono">{ctx.previous_sales_order_number}</span>)</>
            ) : null}
            . The faulty unit is already in the warehouse
            {ticket.return_dc_number ? (
              <> from return DC <ReturnDcNumberLink rdcNumber={ticket.return_dc_number} className="font-mono" /></>
            ) : null}
            — no new Return DC needed.
          </p>
        </div>
        {isLead && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="shrink-0 text-xs px-3 py-2 rounded-lg bg-pink-700 text-white hover:bg-pink-800"
          >
            Create new replacement SO
          </button>
        )}
      </div>

      <div className="space-y-2">
        {eligible.map((item) => (
          <label
            key={item.pickup_item_id}
            className={`flex gap-3 items-start rounded-lg border p-3 cursor-pointer bg-white/80 ${
              selected.has(String(item.pickup_item_id)) ? 'border-pink-400' : 'border-pink-100'
            }`}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.has(String(item.pickup_item_id))}
              onChange={() => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  const key = String(item.pickup_item_id);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
            />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-mono font-semibold text-slate-800">{item.ttspl_id}</p>
              <p className="text-slate-600">{specLine(item) || item.model || '—'}</p>
              {item.rent_monthly_rate != null && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Rent ₹{Number(item.rent_monthly_rate).toLocaleString('en-IN')}/mo → same on new SO line
                </p>
              )}
              {item.return_dc_number && (
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  Returned on {item.return_dc_number} · in warehouse
                </p>
              )}
            </div>
          </label>
        ))}
      </div>

      {showForm && (
        <div className="rounded-lg border border-pink-100 bg-white p-3 space-y-3">
          <textarea
            className="w-full border rounded-lg p-3 min-h-[56px] text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for replacement delivery"
          />
          <ol className="list-decimal list-inside text-xs text-pink-900/90 space-y-0.5">
            {(ctx.next_steps || []).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <PickupSetupForm
            ticket={ticket}
            customerId={ticket.customer_id}
            sourceItem={referencePickup}
            fixedPickupType="repair"
            hidePickupType
            hideMachinePreview
            hideDispatch
            submitLabel="Create new replacement sales order"
            saving={saving}
            onSubmit={submit}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}
    </div>
  );
}
