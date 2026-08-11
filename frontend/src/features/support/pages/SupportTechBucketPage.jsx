import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Package, FileText, Check, RotateCcw, Truck, PenLine, ArrowRightLeft, X, Laptop } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import api from '../../../utils/api';
import { getTechnicianBucket, getTechnicianLaptopBucket, returnPart, requestPartReassign, submitOldPartRpdc } from '../supportPartsApi';
import ESignChallanModal from '../components/ESignChallanModal';
import MarkPartUsedModal from '../components/MarkPartUsedModal';
import { usePartsBase } from '../partsBase';

function ReassignModal({ part, onClose, onDone }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ticketId, setTicketId] = useState('');
  const [itemId, setItemId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/support/tickets', { params: { view: 'my_open', limit: 100 } })
      .then((r) => {
        const list = (r.data.tickets || []).filter((t) => t.id !== part.support_ticket_id);
        setTickets(list);
      })
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  }, [part.support_ticket_id]);

  const selectedTicket = tickets.find((t) => String(t.id) === String(ticketId));
  const items = (selectedTicket?.items || []).filter((i) => i.item_type === 'complaint');

  const submit = async () => {
    if (!ticketId) return toast.error('Select a target ticket');
    const item = items.find((i) => String(i.id) === String(itemId));
    setBusy(true);
    try {
      const { data } = await requestPartReassign(part.id, {
        to_ticket_id: Number(ticketId),
        to_item_id: item ? item.id : undefined,
        to_ttspl_id: item ? (item.unique_serial_number || item.serial_number || undefined) : undefined,
        to_serial: item ? (item.serial_number || undefined) : undefined,
        reason: reason.trim() || undefined,
      });
      toast.success(data.message || 'Reassignment requested');
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to request reassignment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold inline-flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-[#534AB7]" /> Move part to another ticket
          </h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
          <span className="font-medium text-gray-700">{part.part_name}</span>
          {' '}· currently on {part.ticket_number}
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-[#534AB7]" /></div>
        ) : (
          <>
            <label className="block text-sm">
              <span className="text-gray-600">Target ticket *</span>
              <select
                className="mt-1 w-full border rounded-lg px-3 py-2.5 min-h-[44px] text-base"
                value={ticketId}
                onChange={(e) => { setTicketId(e.target.value); setItemId(''); }}
              >
                <option value="">Select one of your tickets…</option>
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    STK-{String(t.id).padStart(4, '0')} · {t.customer_name || 'Customer'}
                  </option>
                ))}
              </select>
            </label>

            {items.length > 0 && (
              <label className="block text-sm">
                <span className="text-gray-600">Target machine (optional)</span>
                <select
                  className="mt-1 w-full border rounded-lg px-3 py-2.5 min-h-[44px] text-base"
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                >
                  <option value="">Select machine…</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.unique_serial_number || i.serial_number || `${i.brand || ''} ${i.model || ''}`.trim() || `Item #${i.id}`}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-sm">
              <span className="text-gray-600">Reason (optional)</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why move this part?"
              />
            </label>

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 border rounded-lg py-2.5 min-h-[44px] text-sm">Cancel</button>
              <button type="button" onClick={submit} disabled={busy || !ticketId} className="flex-1 bg-[#534AB7] text-white rounded-lg py-2.5 min-h-[44px] text-sm font-semibold disabled:opacity-50">
                {busy ? 'Requesting…' : 'Request move'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OldPartRow({ part, onChanged, base }) {
  const [busy, setBusy] = useState(false);

  const submitRpdc = async () => {
    setBusy(true);
    try {
      const { data } = await submitOldPartRpdc([part.id]);
      toast.success(data.message || 'RPDC created');
      onChanged();
      if (data.return_part_dc_number) {
        window.location.href = `${base}/part-return-dcs/${encodeURIComponent(data.return_part_dc_number)}`;
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 py-3 border-b last:border-0 border-amber-100">
      <div>
        <p className="font-mono text-xs text-amber-700">{part.old_part_prt_id || part.request_number}</p>
        <p className="font-medium text-sm">Old: {part.part_name}</p>
        <p className="text-xs text-gray-500">
          {part.ticket_number}{part.ttspl_id ? ` · ${part.ttspl_id}` : ''}
          {part.old_part_condition ? ` · ${part.old_part_condition}` : ''}
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={submitRpdc}
        className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-50 w-fit"
      >
        <RotateCcw className="w-4 h-4" /> Submit RPDC to warehouse
      </button>
    </div>
  );
}

function PartRow({ part, onChanged, canManageReturn, base }) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [signReq, setSignReq] = useState(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [markUsedOpen, setMarkUsedOpen] = useState(false);
  const reassignPending = !!part.reassign_requested_at;

  const run = async (fn, msg) => {
    setBusy(true);
    try {
      const { data } = await fn();
      toast.success(data?.message || msg);
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Action failed');
    } finally {
      setBusy(false);
      setMenu(false);
    }
  };

  const isReturnRequested = part.status === 'return_requested';

  return (
    <div className="flex flex-col gap-2 py-3 border-b last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-[#534AB7]">{part.prt_id || part.request_number}</p>
          <p className="font-medium text-sm text-gray-900">{part.part_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {part.ticket_number}
            {part.ttspl_id ? ` · ${part.ttspl_id}` : ''}
            {' · Qty '}{part.quantity}
          </p>
          {part.challan_number && (
            <Link to={`${base}/challans/${part.challan_id}`} className="inline-flex items-center gap-1 text-xs text-[#534AB7] hover:underline mt-1">
              <FileText className="w-3 h-3" /> {part.challan_number}
            </Link>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {isReturnRequested && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
              Pickup requested
            </span>
          )}
          {reassignPending && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-medium">
              Move requested
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {!isReturnRequested && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setMarkUsedOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> Mark used
          </button>
        )}

        {!isReturnRequested && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setMenu((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" /> Return
          </button>
        )}

        {!isReturnRequested && !reassignPending && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setReassignOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-lg border border-purple-300 text-purple-700 text-xs font-semibold disabled:opacity-50"
          >
            <ArrowRightLeft className="w-4 h-4" /> Move to ticket
          </button>
        )}

        {canManageReturn && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setSignReq({ requestId: part.id, viaPickup: isReturnRequested })}
            className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-lg bg-[#534AB7] text-white text-xs font-semibold disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> Accept return (e-sign)
          </button>
        )}
      </div>

      {menu && !isReturnRequested && (
        <div className="flex flex-col gap-2 rounded-lg bg-gray-50 border p-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => returnPart(part.id, { method: 'pickup_request' }), 'Pickup requested')}
            className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700"
          >
            <Truck className="w-4 h-4" /> Request pickup (warehouse collects)
          </button>
          {canManageReturn && (
            <button
              type="button"
              disabled={busy}
              onClick={() => { setMenu(false); setSignReq({ requestId: part.id, viaPickup: false }); }}
              className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700"
            >
              <RotateCcw className="w-4 h-4" /> Returned at warehouse now (e-sign)
            </button>
          )}
        </div>
      )}

      {signReq && (
        <ESignChallanModal
          challan={{ challan_number: part.challan_number }}
          mode="return"
          requestId={signReq.requestId}
          viaPickup={signReq.viaPickup}
          onSigned={() => { setSignReq(null); onChanged(); }}
          onClose={() => setSignReq(null)}
        />
      )}

      {reassignOpen && (
        <ReassignModal
          part={part}
          onClose={() => setReassignOpen(false)}
          onDone={() => { setReassignOpen(false); onChanged(); }}
        />
      )}

      <MarkPartUsedModal
        open={markUsedOpen}
        request={part}
        onClose={() => setMarkUsedOpen(false)}
        onSuccess={onChanged}
      />
    </div>
  );
}

function LaptopBucketCard({ item }) {
  return (
    <div className="bg-white rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            item.pickup_type === 'repair' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
          }`}>
            {item.pickup_type === 'repair' ? '🔧 Repair' : '🔄 Return'}
          </span>
          <p className="font-mono font-bold text-blue-700 mt-1">
            {item.ttspl_id || item.unique_serial_number || item.serial_number}
          </p>
          <p className="text-sm text-gray-700">{item.brand} {item.model}</p>
          <p className="text-xs text-gray-500">{[item.ram, item.storage].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-right shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            item.customer_otp_verified_at ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {item.warehouse_received_at ? '✓ At warehouse' : item.customer_otp_verified_at ? '✓ Picked up' : 'In progress'}
          </span>
          {item.return_dc_number && (
            <p className="text-xs text-gray-400 mt-1 font-mono">{item.return_dc_number}</p>
          )}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <Link to={`/support/tickets/${item.ticket_id}`} className="text-[#534AB7] font-medium">
          Ticket #{item.ticket_id} →
        </Link>
        <span>{item.customer_name}</span>
        {item.visited_lat && item.visited_lng && (
          <a href={`https://www.google.com/maps?q=${item.visited_lat},${item.visited_lng}`}
            target="_blank" rel="noopener noreferrer" className="text-blue-600">🗺 Location</a>
        )}
      </div>
    </div>
  );
}

export default function SupportTechBucketPage() {
  const { user } = useAuth();
  const base = usePartsBase();
  const [tab, setTab] = useState('laptops');
  const [bucket, setBucket] = useState([]);
  const [oldPartsBucket, setOldPartsBucket] = useState([]);
  const [oldPartsTotal, setOldPartsTotal] = useState(0);
  const [awaiting, setAwaiting] = useState([]);
  const [total, setTotal] = useState(0);
  const [laptopBucket, setLaptopBucket] = useState([]);
  const [laptopTotal, setLaptopTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const isTech = user?.role === 'support_tech';
  const canManageReturn = ['warehouse', 'admin', 'manager', 'support_lead', 'super_admin'].includes(user?.role);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      getTechnicianBucket()
        .then((r) => {
          setBucket(r.data.bucket || []);
          setOldPartsBucket(r.data.old_parts_bucket || []);
          setOldPartsTotal(r.data.old_parts_total || 0);
          setAwaiting(r.data.awaiting || []);
          setTotal(r.data.total || 0);
        })
        .catch(() => { setBucket([]); setOldPartsBucket([]); setOldPartsTotal(0); setAwaiting([]); setTotal(0); }),
      getTechnicianLaptopBucket()
        .then((r) => {
          setLaptopBucket(r.data.bucket || []);
          setLaptopTotal(r.data.total || 0);
        })
        .catch(() => { setLaptopBucket([]); setLaptopTotal(0); }),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" />
      </div>
    );
  }

  const TABS = [
    { id: 'laptops', label: 'Laptops', icon: Laptop, n: laptopTotal },
    { id: 'parts', label: 'Parts', icon: Package, n: total + oldPartsTotal },
  ];

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Package className="w-5 h-5 text-[#534AB7]" />
        <h1 className="text-lg font-semibold m-0">{isTech ? 'My bucket' : 'Technician bucket'}</h1>
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium ${
                tab === t.id ? 'border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7]' : 'border-slate-200 text-slate-600'
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label} ({t.n})
            </button>
          );
        })}
      </div>

      {tab === 'laptops' && (
        <div className="space-y-4">
          {laptopBucket.length === 0 && (
            <div className="bg-white rounded-2xl border p-8 text-center text-sm text-gray-500">
              No laptops currently in the pickup bucket.
            </div>
          )}
          {laptopBucket.map((group) => (
            <div key={group.tech_id} className="space-y-3">
              {!isTech && (
                <p className="text-sm font-semibold text-gray-700 px-1">
                  {group.tech_name || 'Unassigned'} · {group.laptops.length} laptop{group.laptops.length === 1 ? '' : 's'}
                </p>
              )}
              {group.laptops.map((lap) => <LaptopBucketCard key={lap.id} item={lap} />)}
            </div>
          ))}
        </div>
      )}

      {tab === 'parts' && (
      <>
      <div className="flex items-center gap-2">
        <span className="ml-auto text-sm text-gray-500">{total} part{total === 1 ? '' : 's'} held</span>
      </div>

      {awaiting.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200">
            <p className="font-semibold text-sm text-amber-900 inline-flex items-center gap-2">
              <PenLine className="w-4 h-4" /> Awaiting signature
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {isTech
                ? 'Go to the warehouse and sign these challans to collect your parts.'
                : 'These challans are ready for the technician to sign before parts are issued.'}
            </p>
          </div>
          <div className="divide-y divide-amber-100">
            {awaiting.map((ch) => (
              <div key={ch.challan_id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-[#534AB7]">{ch.challan_number}</p>
                  <p className="text-sm font-medium text-gray-900">
                    {(ch.items || []).map((it) => `${it.part_name} (x${it.quantity})`).join(', ')}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {ch.ticket_number}{ch.ttspl_id ? ` · ${ch.ttspl_id}` : ''}
                    {!isTech ? ` · ${ch.tech_name}` : ''}
                  </p>
                </div>
                <Link
                  to={`${base}/challans/${ch.challan_id}`}
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-2 min-h-[40px] bg-[#534AB7] text-white rounded-lg text-xs font-semibold"
                >
                  <PenLine className="w-4 h-4" /> Open &amp; sign
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {bucket.length === 0 && awaiting.length === 0 && (
        <div className="bg-white rounded-2xl border p-8 text-center text-sm text-gray-500">
          No parts currently held or awaiting signature.
        </div>
      )}

      {bucket.map((group) => (
        <div key={group.tech_id} className="bg-white rounded-2xl border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b">
            <p className="font-semibold text-sm text-gray-900">{group.tech_name}</p>
            <span className="text-xs text-gray-500">{group.parts.length} part{group.parts.length === 1 ? '' : 's'} on hand</span>
          </div>
          <div className="px-4">
            {group.parts.map((part) => (
              <PartRow key={part.id} part={part} onChanged={load} canManageReturn={canManageReturn} base={base} />
            ))}
          </div>
        </div>
      ))}

      {oldPartsBucket.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200">
            <p className="font-semibold text-sm text-amber-900">Old parts to return (RPDC)</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Collected from customer — submit RPDC and hand to warehouse.
            </p>
          </div>
          {oldPartsBucket.map((group) => (
            <div key={`old-${group.tech_id}`} className="px-4">
              {!isTech && (
                <p className="text-xs font-semibold text-amber-800 pt-2">{group.tech_name}</p>
              )}
              {group.old_parts.map((part) => (
                <OldPartRow key={part.id} part={part} onChanged={load} base={base} />
              ))}
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}
