import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Package, Send } from 'lucide-react';
import api from '../../../utils/api';
import { replacementSalesOrderDetailPath } from '../../../features/sales-pipeline/salesOrderScope';

export default function ResendLaptopPanel({ ticketId, ticket, isLead, onDone, onRefresh, variant = 'inline' }) {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('Send a different replacement laptop to customer');

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/support/tickets/${ticketId}/resend-laptop-context`);
      setCtx(data);
    } catch (e) {
      setCtx(null);
      toast.error(e.response?.data?.message || 'Could not load resend options');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/support/tickets/${ticketId}/resend-laptop`, { reason });
      toast.success(data.message || 'Ready to resend replacement laptop');
      onRefresh?.();
      onDone?.(data);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to prepare resend');
    } finally {
      setBusy(false);
    }
  };

  const inModal = variant === 'modal';
  const soNumber = ctx?.sales_order_number || ticket?.sales_order_number;
  const soPath = soNumber ? replacementSalesOrderDetailPath(soNumber) : null;

  if (loading) {
    return (
      <div className="rounded-xl border border-pink-200 bg-pink-50/40 p-4 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking resend eligibility…
      </div>
    );
  }

  if (!ctx?.can_resend) {
    return (
      <div className={`rounded-xl border border-dashed border-pink-200 bg-pink-50/30 p-4 text-sm text-slate-600 ${inModal ? '' : ''}`}>
        {ctx?.block_reason || 'Resend is not available on this ticket right now.'}
        {soPath && (
          <p className="mt-2">
            <Link to={soPath} className="text-pink-800 font-semibold underline text-xs">
              Open SO {soNumber} →
            </Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-pink-200 bg-pink-50/40 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-pink-900 flex items-center gap-2">
          <Send className="w-4 h-4" /> Resend replacement laptop
        </p>
        <p className="text-xs text-pink-900/80 mt-1">
          Uses existing sales order{' '}
          <span className="font-mono font-semibold">{soNumber}</span>
          {ticket?.return_dc_number ? (
            <> · faulty unit already on return DC <span className="font-mono">{ticket.return_dc_number}</span></>
          ) : null}
          . Prepare the order, then attach a <strong>different</strong> QC-passed laptop and create a new delivery DC.
        </p>
      </div>

      {ctx.will_detach_stale_serial && (
        <p className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-2 py-1.5">
          The old laptop was received at warehouse but is still linked to delivery DC{' '}
          <span className="font-mono">{ctx.stale_dispatch_dc}</span>. Confirming will detach it from the sales order so you can attach a new unit.
        </p>
      )}

      {ctx.attached_serials?.length > 0 && (
        <div className="text-xs text-pink-950 space-y-1">
          <p className="font-semibold uppercase tracking-wide text-slate-500">Currently on SO</p>
          {ctx.attached_serials.map((s) => (
            <p key={s.allocation_id} className="font-mono">
              {s.ttspl_id || s.serial_number} · QC {s.qc_status || '—'} · {s.status}
              {s.dc_number ? ` · ${s.dc_number}` : ''}
            </p>
          ))}
        </div>
      )}

      <ol className="list-decimal list-inside text-xs text-pink-900/90 space-y-0.5">
        {(ctx.next_steps || []).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {isLead && (
        <>
          <textarea
            className="w-full border rounded-lg p-3 min-h-[56px] text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for resend (optional)"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-pink-700 text-white hover:bg-pink-800 disabled:opacity-60"
              onClick={submit}
              disabled={busy}
            >
              <Package className="w-4 h-4" />
              {busy ? 'Preparing…' : 'Prepare resend on sales order'}
            </button>
            {soPath && (
              <Link
                to={soPath}
                className="inline-flex items-center text-xs px-3 py-2 rounded-lg border border-pink-300 text-pink-900 hover:bg-pink-100"
              >
                Open SO {soNumber} →
              </Link>
            )}
          </div>
        </>
      )}

      {!isLead && soPath && (
        <Link to={soPath} className="inline-flex text-xs font-semibold text-pink-800 underline">
          Open SO {soNumber} in Sales Pipeline →
        </Link>
      )}
    </div>
  );
}
