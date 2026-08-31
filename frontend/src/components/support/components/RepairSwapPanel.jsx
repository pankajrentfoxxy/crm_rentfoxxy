import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, RefreshCw } from 'lucide-react';
import api from '../../../utils/api';
import PickupSetupForm from './PickupSetupForm';
import ReturnDcNumberLink from './ReturnDcNumberLink';
import { replacementSalesOrderDetailPath } from '../../../features/sales-pipeline/salesOrderScope';

function specLine(item) {
  return [item.brand, item.model, item.processor, item.generation, item.ram, item.storage]
    .filter(Boolean)
    .join(' · ');
}

export default function RepairSwapPanel({
  ticket,
  pickups,
  replacementOrders = [],
  ticketId,
  isLead,
  onRefresh,
  variant = 'inline',
  onSwapCreated,
}) {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [reason, setReason] = useState('Unit not repairable — send different laptop to customer');

  const hasActiveReplacement = !!ticket.sales_order_number
    && replacementOrders.some((o) => o.status !== 'completed' && o.status !== 'cancelled');

  const repairPickups = useMemo(
    () => (pickups || []).filter(
      (p) => (p.pickup_type === 'repair' || p.source_item_id) && p.warehouse_received_at
    ),
    [pickups]
  );

  const load = useCallback(async () => {
    if (!ticketId || hasActiveReplacement || !repairPickups.length) {
      setCtx(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/support/tickets/${ticketId}/repair-swap-context`);
      setCtx(data);
      const ids = (data.eligible_items || []).map((i) => String(i.pickup_item_id));
      setSelected(new Set(ids));
    } catch {
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, [ticketId, hasActiveReplacement, repairPickups.length]);

  useEffect(() => { load(); }, [load]);

  const inTab = variant === 'tab';

  if (!inTab && (hasActiveReplacement || !repairPickups.length)) return null;
  if (loading) {
    return (
      <div className={`rounded-xl border border-pink-200 bg-pink-50/40 p-4 flex items-center gap-2 text-sm text-slate-500 ${inTab ? '' : ''}`}>
        <Loader2 className="w-4 h-4 animate-spin" /> Checking swap eligibility…
      </div>
    );
  }

  if (inTab && !repairPickups.length) {
    return (
      <p className="text-sm text-slate-500 rounded-lg border border-dashed border-pink-200 bg-pink-50/30 p-4">
        No repair pickup with warehouse receipt yet. Complete repair pickup first, then return here to send a different laptop.
      </p>
    );
  }

  if (hasActiveReplacement && ticket.sales_order_number) {
    const soPath = replacementSalesOrderDetailPath(ticket.sales_order_number);
    return (
      <div className="rounded-xl border border-pink-200 bg-pink-50/40 p-4 space-y-2">
        <p className="text-sm font-semibold text-pink-900">Replacement sales order created</p>
        <p className="text-xs text-pink-900/80">
          Swap order <span className="font-mono font-semibold">{ticket.sales_order_number}</span> is in Sales Pipeline.
          Attach a different serial, complete Dispatch QC, then create the delivery DC.
        </p>
        <Link to={soPath} className="inline-flex text-xs font-semibold text-pink-800 underline">
          Open SO {ticket.sales_order_number} in Sales Pipeline →
        </Link>
      </div>
    );
  }

  if (!inTab && !ctx?.can_swap) return null;
  if (inTab && !ctx?.can_swap) {
    return (
      <p className="text-sm text-slate-500 rounded-lg border border-dashed border-pink-200 bg-pink-50/30 p-4">
        {ctx?.block_reason || 'This unit is not eligible for swap right now (Service DC may already be in progress).'}
      </p>
    );
  }

  const eligible = ctx.eligible_items || [];
  const selectedIds = eligible.filter((i) => selected.has(String(i.pickup_item_id)));

  const submitSwap = async (pickupForm) => {
    const ids = selectedIds.map((i) => i.pickup_item_id);
    if (!ids.length) {
      toast.error('Select at least one unit to swap');
      return;
    }
    setSaving(true);
    try {
      const addr = pickupForm.pickup_address || {};
      const { data } = await api.post(`/support/tickets/${ticketId}/replacements/swap-from-repair`, {
        pickup_item_ids: ids,
        reason,
        remarks: reason,
        contact_name: addr.name,
        contact_phone: addr.phone,
        pickup_address: addr,
      });
      toast.success(`Replacement SO ${data.sales_order_number} created in Sales Pipeline`);
      setShowForm(false);
      onRefresh?.();
      onSwapCreated?.(data.sales_order_number);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to start swap');
    } finally {
      setSaving(false);
    }
  };

  const referencePickup = repairPickups[0];

  return (
    <div className="rounded-xl border border-pink-200 bg-pink-50/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-pink-900 flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Send a different laptop (swap)
          </p>
          <p className="text-xs text-pink-900/80 mt-1">
            The faulty unit is already in the warehouse from repair pickup. Click below to create a
            <strong> replacement Sales Order</strong> in Sales Pipeline for a different laptop — no new Return DC
            and no Service DC for the old unit.
          </p>
        </div>
        {isLead && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="shrink-0 text-xs px-3 py-2 rounded-lg bg-pink-700 text-white hover:bg-pink-800"
          >
            Create replacement SO
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
                  Rent ₹{Number(item.rent_monthly_rate).toLocaleString('en-IN')}/mo → same on replacement line
                </p>
              )}
              {item.return_dc_number && (
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  Repair RDC <ReturnDcNumberLink rdcNumber={item.return_dc_number} /> · in warehouse
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
            placeholder="Reason for swap"
          />
          <PickupSetupForm
            ticket={ticket}
            customerId={ticket.customer_id}
            sourceItem={referencePickup}
            fixedPickupType="repair"
            hidePickupType
            hideMachinePreview
            hideDispatch
            submitLabel="Create replacement sales order"
            saving={saving}
            onSubmit={submitSwap}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {ticket.sales_order_number && (
        <p className="text-xs text-pink-800">
          Next: attach stock on{' '}
          <Link
            to={replacementSalesOrderDetailPath(ticket.sales_order_number)}
            className="font-semibold underline"
          >
            SO {ticket.sales_order_number}
          </Link>
          , Dispatch QC, then create delivery DC.
        </p>
      )}
    </div>
  );
}
