import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Loader2, PackageCheck, Truck } from 'lucide-react';
import api from '../../../utils/api';
import PickupSetupForm from './PickupSetupForm';
import { uploadAssetUrl } from '../utils';
import { replacementSalesOrderDetailPath } from '../../../features/sales-pipeline/salesOrderScope';

function dcPurposeLabel(purpose) {
  if (purpose === 'service_return') return 'Service Return';
  if (purpose === 'replacement') return 'Replacement';
  return 'Standard';
}

export default function ServiceDcPanel({ ticket, pickups, replacementOrders = [], ticketId, isLead, onRefresh }) {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const repairPickups = (pickups || []).filter(
    (p) => (p.pickup_type === 'repair' || p.source_item_id) && p.warehouse_received_at
  );
  const hasReplacementSo = !!ticket.sales_order_number
    && replacementOrders.some((o) => o.status !== 'completed' && o.status !== 'cancelled');

  const load = useCallback(async () => {
    if (!ticketId || hasReplacementSo) {
      setCtx(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/support/tickets/${ticketId}/service-dc/eligibility`);
      setCtx(data);
    } catch {
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, [ticketId, hasReplacementSo]);

  useEffect(() => { load(); }, [load]);

  if (hasReplacementSo || !repairPickups.length) return null;
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking service return eligibility…
      </div>
    );
  }
  if (!ctx) return null;

  const eligibleIds = (ctx.eligible_items || []).filter((i) => i.eligible).map((i) => i.id);
  const serviceDcs = ctx.service_dcs || [];
  const canCreate = isLead && ctx.can_create && eligibleIds.length > 0;

  const createSdc = async (form) => {
    setSaving(true);
    try {
      await api.post(`/support/tickets/${ticketId}/service-dc`, {
        item_ids: eligibleIds,
        dispatch_mode: form.dispatch_mode,
        technician_user_id: form.technician_user_id,
        courier_name: form.courier_name,
        awb_number: form.awb_number,
        porter_tracking_id: form.porter_tracking_id,
        porter_order_id: form.porter_order_id,
        shipping_address: form.pickup_address,
        remarks: form.reason,
      });
      toast.success('Service Delivery Challan created');
      setShowCreate(false);
      onRefresh?.();
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to create Service DC');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-900 flex items-center gap-2">
            <PackageCheck className="w-4 h-4" /> Send repaired unit back to customer
          </p>
          <p className="text-xs text-teal-800/80 mt-1">
            Create a Service Delivery Challan (SDC) — same unit, original sales order, no new SO.
          </p>
        </div>
        {canCreate && !showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="shrink-0 text-xs px-3 py-2 rounded-lg bg-teal-700 text-white hover:bg-teal-800"
          >
            Send back to customer
          </button>
        )}
      </div>

      {showCreate && (
        <div className="rounded-lg border border-teal-100 bg-white p-3">
          <PickupSetupForm
            ticket={ticket}
            customerId={ticket.customer_id}
            sourceItem={repairPickups[0]}
            fixedPickupType="repair"
            hidePickupType
            hideMachinePreview
            submitLabel="Create Service DC"
            saving={saving}
            onSubmit={createSdc}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {serviceDcs.length > 0 && (
        <div className="space-y-2">
          {serviceDcs.map((sdc) => {
            const pdfUrl = uploadAssetUrl(sdc.pdf_path);
            const dcPath = `/sales-pipeline/delivery-challans/${encodeURIComponent(sdc.dc_number)}`;
            return (
              <div key={sdc.dc_number} className="rounded-lg border border-white bg-white/80 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Truck className="w-3.5 h-3.5 text-teal-700" />
                  <span className="font-mono font-semibold text-slate-900">{sdc.dc_number}</span>
                  <span className="rounded-full bg-teal-100 text-teal-800 px-2 py-0.5">{dcPurposeLabel(sdc.dc_purpose)}</span>
                  <span className="text-slate-500 capitalize">{sdc.status || 'pending'}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link to={dcPath} className="text-teal-700 hover:underline">View DC</Link>
                  {pdfUrl && (
                    <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-700 hover:underline">
                      <FileText className="w-3.5 h-3.5" /> PDF
                    </a>
                  )}
                  {sdc.sales_order_number && (
                    <Link
                      to={replacementSalesOrderDetailPath(sdc.sales_order_number)}
                      className="text-slate-600 hover:underline"
                    >
                      SO {sdc.sales_order_number}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!canCreate && !serviceDcs.length && ctx.eligible_items?.length > 0 && (
        <p className="text-xs text-amber-800">
          Unit not ready yet: {ctx.eligible_items.map((i) => i.reasons?.join(', ')).filter(Boolean).join(' · ') || 'complete repair and QC first'}
        </p>
      )}
    </div>
  );
}
