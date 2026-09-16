import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Loader2, PlugZap, Warehouse } from 'lucide-react';
import ScanField from '../../components/ScanField';
import {
  attachDispatchCharger,
  cancelChargerRequest,
  fetchTicketCharger,
  markChargerAlreadyWithCustomer,
  raiseChargerRequest,
} from './dispatchChargerApi';

export default function DispatchQcChargerPanel({ ticket, onReadyChange }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [adapterScan, setAdapterScan] = useState('');
  const [cableScan, setCableScan] = useState('');
  const onReadyChangeRef = useRef(onReadyChange);
  useEffect(() => { onReadyChangeRef.current = onReadyChange; }, [onReadyChange]);

  const load = useCallback(async () => {
    if (!ticket?.ticket_id) return;
    setLoading(true);
    try {
      const { data: res } = await fetchTicketCharger(ticket.ticket_id);
      setData(res.data || null);
      onReadyChangeRef.current?.(Boolean(res.data?.charger?.can_start_dispatch_qc));
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load charger status');
      onReadyChangeRef.current?.(false);
    } finally {
      setLoading(false);
    }
  }, [ticket?.ticket_id]);

  useEffect(() => { load(); }, [load]);

  const charger = data?.charger;
  const ready = Boolean(charger?.can_start_dispatch_qc);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const { data: res } = await fn();
      toast.success(okMsg || res.message || 'Saved');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading charger status…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <PlugZap className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
        <div>
          <h3 className="font-semibold text-slate-900">Charger with this laptop</h3>
          <p className="text-xs text-slate-600 mt-0.5">
            This is a warehouse asset going to the customer — not a floor part attach.
            {data?.ttspl_id ? <span className="block font-mono mt-1">{data.ttspl_id}</span> : null}
          </p>
        </div>
      </div>

      {ready ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <div className="text-sm text-emerald-800">
            {charger.disposition === 'already_with_customer'
              ? 'Charger already with customer — you can start Dispatch QC.'
              : `Kit attached: ${charger.charger_label || charger.prt_id}. Start Dispatch QC, then scan both products on submit.`}
          </div>
        </div>
      ) : null}

      {!charger ? (
        <div className="grid sm:grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => raiseChargerRequest(ticket.ticket_id), 'Request sent to warehouse')}
            className="rounded-xl border border-amber-300 bg-white px-3 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            Charger attach
            <span className="block text-xs font-normal text-slate-500 mt-1">Raise request to warehouse</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => markChargerAlreadyWithCustomer(ticket.ticket_id), 'Marked already with customer')}
            className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Charger already with customer
            <span className="block text-xs font-normal text-slate-500 mt-1">No charger will be sent</span>
          </button>
        </div>
      ) : null}

      {charger?.status === 'pending' ? (
        <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2">
          <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
            <Warehouse className="w-4 h-4" /> Waiting for warehouse handover
          </p>
          <p className="text-xs text-slate-600">
            Request {charger.request_number} is with warehouse. After they hand over the adapter and power cable, scan both here to attach.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => cancelChargerRequest(charger.request_id), 'Request cancelled')}
            className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
          >
            Cancel request
          </button>
        </div>
      ) : null}

      {charger?.status === 'handed_over' ? (
        <div className="rounded-lg border border-teal-200 bg-white p-3 space-y-2">
          <p className="text-sm font-medium text-teal-900">Warehouse handed over both products</p>
          <p className="text-xs text-slate-600">
            Scan adapter {charger.adapter_label || ''} and power cable {charger.cable_label || ''} to attach.
          </p>
          <ScanField
            value={adapterScan}
            onChange={setAdapterScan}
            placeholder="Scan laptop charger / adapter"
            aria-label="Scan adapter"
          />
          <ScanField
            value={cableScan}
            onChange={setCableScan}
            placeholder="Scan power cable"
            aria-label="Scan power cable"
          />
          <button
            type="button"
            disabled={busy || !adapterScan.trim() || !cableScan.trim()}
            onClick={() => run(
              () => attachDispatchCharger(charger.request_id, {
                adapter_scan: adapterScan,
                cable_scan: cableScan,
              }),
              'Adapter and power cable attached'
            )}
            className="px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Attaching…' : 'Attach adapter + power cable'}
          </button>
        </div>
      ) : null}

      {charger && !ready && charger.status !== 'pending' && charger.status !== 'handed_over' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => cancelChargerRequest(charger.request_id), 'Cancelled — choose again')}
          className="text-xs font-semibold text-slate-600 hover:underline disabled:opacity-50"
        >
          Change charger option
        </button>
      ) : null}
    </div>
  );
}
