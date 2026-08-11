import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, ClipboardList, MapPin, PackageCheck, ArrowRightLeft, Check, X, Search, Truck } from 'lucide-react';
import { getSupportPartsWarehouseQueue, approveAndGenerateChallan, resolvePartReassign, listPartDcsAwaitingCourier, listPartReturnDcsPending } from '../supportPartsApi';
import ESignChallanModal from '../components/ESignChallanModal';
import PickSupportSerialsModal from '../components/PickSupportSerialsModal';
import PartCourierDispatchModal from '../components/PartCourierDispatchModal';
import { usePartsBase } from '../partsBase';

function PendingTab({ requests, onAction, base }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [courierOpen, setCourierOpen] = useState(false);
  const [pendingInstanceMap, setPendingInstanceMap] = useState(null);
  const [pickerMode, setPickerMode] = useState('warehouse');
  const pickerModeRef = useRef('warehouse');

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) =>
      String(r.request_number || '').toLowerCase().includes(q) ||
      String(r.ticket_number || '').toLowerCase().includes(q) ||
      String(r.part_name || '').toLowerCase().includes(q) ||
      String(r.tech_name || '').toLowerCase().includes(q) ||
      String(r.ttspl_id || '').toLowerCase().includes(q) ||
      String(r.customer_name || '').toLowerCase().includes(q)
    );
  }, [requests, search]);

  const selectedRequests = useMemo(
    () => requests.filter((r) => selected.has(r.id)),
    [requests, selected]
  );

  const openPicker = (mode = 'warehouse') => {
    if (!selectedRequests.length) return;
    const tickets = [...new Set(selectedRequests.map((r) => r.support_ticket_id))];
    if (tickets.length > 1) { toast.error('Select requests from the same ticket only'); return; }
    if (mode === 'courier') {
      const nonCourier = selectedRequests.filter((r) => r.fulfillment_mode !== 'courier_to_customer');
      if (nonCourier.length) {
        toast.error('Courier dispatch only works for "Send by courier to customer" requests');
        return;
      }
      setPickerMode('courier');
      pickerModeRef.current = 'courier';
      setPickOpen(true);
      return;
    }
    const techs = [...new Set(selectedRequests.map((r) => r.assigned_to_tech))];
    if (techs.length > 1) { toast.error('Select requests for the same technician only'); return; }
    const courierMixed = selectedRequests.some((r) => r.fulfillment_mode === 'courier_to_customer');
    if (courierMixed) {
      toast.error('Deselect courier requests — use "Generate Part DC" for those');
      return;
    }
    setPickerMode('warehouse');
    pickerModeRef.current = 'warehouse';
    setPickOpen(true);
  };

  const onSerialsPicked = (instanceMap) => {
    setPendingInstanceMap(instanceMap);
    setPickOpen(false);
    if (pickerModeRef.current === 'courier') {
      setCourierOpen(true);
    } else {
      approve(instanceMap);
    }
  };

  const approve = async (instanceMap) => {
    const ids = selectedRequests.map((r) => r.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      const { data } = await approveAndGenerateChallan(ids, instanceMap);
      toast.success(`Challan ${data.challan_number} created - capture the technician's signature`);
      setSelected(new Set());
      setPickOpen(false);
      onAction();
      if (data.challan_id) navigate(`${base}/challans/${data.challan_id}`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to approve');
    } finally {
      setBusy(false);
    }
  };

  if (!requests.length) {
    return <div className="bg-white rounded-2xl border p-8 text-center text-sm text-gray-500">No pending part requests.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2 text-sm"
          placeholder="Search request #, ticket, part, technician, TTSPL…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#534AB7]/10 rounded-xl px-4 py-3 sticky top-2 z-10">
          <span className="text-sm text-[#534AB7] font-medium">{selected.size} request(s) selected</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openPicker('warehouse')} disabled={busy} className="px-4 py-2 min-h-[40px] bg-[#534AB7] text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {busy ? 'Working…' : 'Approve + warehouse challan'}
            </button>
            <button type="button" onClick={() => openPicker('courier')} disabled={busy} className="inline-flex items-center gap-1 px-4 py-2 min-h-[40px] border border-[#534AB7] text-[#534AB7] bg-white rounded-lg text-sm font-semibold disabled:opacity-50">
              <Truck className="w-4 h-4" /> Generate Part DC (Courier)
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border p-8 text-center text-sm text-gray-500">No requests match your search.</div>
      ) : filtered.map((req) => {
        const available = Number(req.available ?? req.instances_available ?? req.stock_qty ?? 0);
        return (
          <div
            key={req.id}
            onClick={() => toggle(req.id)}
            className={`bg-white border rounded-xl p-4 cursor-pointer ${selected.has(req.id) ? 'border-[#534AB7] ring-1 ring-[#534AB7]/40' : ''}`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(req.id)}
                onChange={() => toggle(req.id)}
                onClick={(e) => e.stopPropagation()}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-[#534AB7] font-medium">{req.request_number}</span>
                  <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{req.ticket_number}</span>
                  {req.ttspl_id && <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{req.ttspl_id}</span>}
                </div>
                <p className="font-semibold text-gray-900 mt-1">{req.part_name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Qty: {req.quantity} · For: {req.tech_name}
                  {req.customer_name ? ` · Customer: ${req.customer_name}` : ''}
                </p>
                {req.reason && <p className="text-xs text-gray-400 italic mt-0.5">&quot;{req.reason}&quot;</p>}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${available > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {available > 0 ? `In stock: ${available}` : 'Out of stock'}
                  </span>
                  {req.fulfillment_mode === 'courier_to_customer' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Courier to customer</span>
                  )}
                  {req.billing_type === 'under_warranty' ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">Warranty</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Chargeable</span>
                  )}
                  {req.collect_old_part && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      Collect old part ({req.old_part_collection_method === 'courier_pickup' ? 'courier' : 'tech'})
                    </span>
                  )}
                  {req.location_code && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <MapPin className="w-3 h-3" /> {req.location_code}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <PickSupportSerialsModal
        open={pickOpen}
        requests={selectedRequests}
        busy={busy}
        onClose={() => setPickOpen(false)}
        onConfirm={onSerialsPicked}
      />

      <PartCourierDispatchModal
        open={courierOpen}
        requests={selectedRequests}
        instanceMap={pendingInstanceMap}
        onClose={() => { setCourierOpen(false); setPendingInstanceMap(null); }}
        onSuccess={(data) => {
          setSelected(new Set());
          setCourierOpen(false);
          setPendingInstanceMap(null);
          onAction();
          if (data.dc_number) navigate(`${base}/part-dcs/${encodeURIComponent(data.dc_number)}`);
        }}
      />
    </div>
  );
}

function ReturnsTab({ requests, onAction }) {
  const [signReq, setSignReq] = useState(null);

  if (!requests.length) {
    return <div className="bg-white rounded-2xl border p-8 text-center text-sm text-gray-500">No return requests to collect.</div>;
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => (
        <div key={req.id} className="bg-white border rounded-xl p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-[#534AB7] font-medium">{req.request_number}</span>
                <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{req.ticket_number}</span>
              </div>
              <p className="font-semibold text-gray-900 mt-1">{req.part_name}</p>
              <p className="text-xs text-gray-500 mt-0.5">Qty: {req.quantity} · From: {req.tech_name}</p>
            </div>
            <button
              type="button"
              onClick={() => setSignReq(req.id)}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-2 min-h-[40px] bg-[#534AB7] text-white rounded-lg text-xs font-semibold"
            >
              <PackageCheck className="w-4 h-4" /> Accept return
            </button>
          </div>
        </div>
      ))}

      {signReq && (
        <ESignChallanModal
          challan={{}}
          mode="return"
          requestId={signReq}
          viaPickup
          onSigned={() => { setSignReq(null); onAction(); }}
          onClose={() => setSignReq(null)}
        />
      )}
    </div>
  );
}

function ReassignsTab({ requests, onAction }) {
  const [busyId, setBusyId] = useState(null);

  const resolve = async (id, action) => {
    setBusyId(id);
    try {
      const { data } = await resolvePartReassign(id, action);
      toast.success(data.message || 'Done');
      onAction();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  };

  if (!requests.length) {
    return <div className="bg-white rounded-2xl border p-8 text-center text-sm text-gray-500">No reassignment requests.</div>;
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => (
        <div key={req.id} className="bg-white border rounded-xl p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-[#534AB7] font-medium">{req.request_number}</span>
            {req.prt_id && <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{req.prt_id}</span>}
          </div>
          <p className="font-semibold text-gray-900 mt-1">{req.part_name} <span className="text-xs font-normal text-gray-500">· Qty {req.quantity}</span></p>
          <div className="flex items-center gap-2 mt-2 text-sm">
            <div className="min-w-0">
              <p className="text-[11px] text-gray-400">From</p>
              <p className="font-mono text-xs">{req.from_ticket_number}</p>
              {req.from_ttspl_id && <p className="font-mono text-[11px] text-gray-500">{req.from_ttspl_id}</p>}
            </div>
            <ArrowRightLeft className="w-4 h-4 text-purple-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] text-gray-400">To</p>
              <p className="font-mono text-xs text-purple-700">{req.to_ticket_number || `#${req.reassign_to_ticket_id}`}</p>
              {req.reassign_to_ttspl_id && <p className="font-mono text-[11px] text-gray-500">{req.reassign_to_ttspl_id}</p>}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">By: {req.tech_name}</p>
          {req.reassign_reason && <p className="text-xs text-gray-400 italic mt-0.5">&quot;{req.reassign_reason}&quot;</p>}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              disabled={busyId === req.id}
              onClick={() => resolve(req.id, 'approve')}
              className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-lg bg-[#534AB7] text-white text-xs font-semibold disabled:opacity-50"
            >
              <Check className="w-4 h-4" /> Approve move
            </button>
            <button
              type="button"
              disabled={busyId === req.id}
              onClick={() => resolve(req.id, 'reject')}
              className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold disabled:opacity-50"
            >
              <X className="w-4 h-4" /> Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SupportPartsQueuePage() {
  const base = usePartsBase();
  const [pending, setPending] = useState([]);
  const [returns, setReturns] = useState([]);
  const [reassigns, setReassigns] = useState([]);
  const [awaitingCourier, setAwaitingCourier] = useState([]);
  const [pendingRpdc, setPendingRpdc] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      getSupportPartsWarehouseQueue(),
      listPartDcsAwaitingCourier().catch(() => ({ data: { dcs: [] } })),
      listPartReturnDcsPending().catch(() => ({ data: { dcs: [] } })),
    ])
      .then(([queueRes, courierRes, rpdcRes]) => {
        setPending(queueRes.data.pending || []);
        setReturns(queueRes.data.returns || []);
        setReassigns(queueRes.data.reassigns || []);
        setAwaitingCourier(courierRes.data.dcs || []);
        setPendingRpdc(rpdcRes.data.dcs || []);
      })
      .catch(() => { setPending([]); setReturns([]); setReassigns([]); setAwaitingCourier([]); setPendingRpdc([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-5 h-5 text-[#534AB7]" />
        <h1 className="text-lg font-semibold m-0">Support part queue</h1>
        <Link to={`${base}/tech-bucket`} className="ml-auto text-sm text-[#534AB7] hover:underline">View bucket</Link>
      </div>

      {pendingRpdc.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-sm font-semibold text-amber-900">
            Return Part DCs awaiting receipt ({pendingRpdc.length})
          </p>
          {pendingRpdc.map((d) => (
            <Link
              key={d.dc_number}
              to={`${base}/part-return-dcs/${encodeURIComponent(d.dc_number)}`}
              className="block text-sm text-amber-800 hover:underline"
            >
              {d.dc_number} · {d.ticket_number} · {d.customer_name}
            </Link>
          ))}
        </div>
      )}

      {awaitingCourier.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-sm font-semibold text-blue-900 flex items-center gap-1">
            <Truck className="w-4 h-4" /> Part DCs awaiting courier details ({awaitingCourier.length})
          </p>
          {awaitingCourier.map((d) => (
            <Link
              key={d.dc_number}
              to={`${base}/part-dcs/${encodeURIComponent(d.dc_number)}`}
              className="block text-sm text-blue-800 hover:underline"
            >
              {d.dc_number} · {d.ticket_number} · {d.customer_name}
            </Link>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {[
          { id: 'pending', label: `Requests (${pending.length})` },
          { id: 'returns', label: `Returns (${returns.length})` },
          { id: 'reassigns', label: `Moves (${reassigns.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 min-h-[40px] rounded-lg text-sm font-medium border ${tab === t.id ? 'border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7]' : 'border-gray-200 text-gray-600'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" /></div>
      ) : tab === 'pending' ? (
        <PendingTab requests={pending} onAction={load} base={base} />
      ) : tab === 'returns' ? (
        <ReturnsTab requests={returns} onAction={load} />
      ) : (
        <ReassignsTab requests={reassigns} onAction={load} />
      )}
    </div>
  );
}
