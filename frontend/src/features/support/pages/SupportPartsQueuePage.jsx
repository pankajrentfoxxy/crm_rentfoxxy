import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, ClipboardList, MapPin, PackageCheck } from 'lucide-react';
import { getSupportPartsWarehouseQueue, approveAndGenerateChallan } from '../supportPartsApi';
import ESignChallanModal from '../components/ESignChallanModal';
import { usePartsBase } from '../partsBase';

function PendingTab({ requests, onAction, base }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const approve = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const sel = requests.filter((r) => ids.includes(r.id));
    const tickets = [...new Set(sel.map((r) => r.support_ticket_id))];
    const techs = [...new Set(sel.map((r) => r.assigned_to_tech))];
    if (tickets.length > 1) { toast.error('Select requests from the same ticket only'); return; }
    if (techs.length > 1) { toast.error('Select requests for the same technician only'); return; }

    setBusy(true);
    try {
      const { data } = await approveAndGenerateChallan(ids);
      toast.success(`Challan ${data.challan_number} created - capture the technician's signature`);
      setSelected(new Set());
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
      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-[#534AB7]/10 rounded-xl px-4 py-3 sticky top-2 z-10">
          <span className="text-sm text-[#534AB7] font-medium">{selected.size} request(s) selected</span>
          <button type="button" onClick={approve} disabled={busy} className="px-4 py-2 min-h-[40px] bg-[#534AB7] text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {busy ? 'Working…' : 'Approve + generate challan'}
          </button>
        </div>
      )}

      {requests.map((req) => {
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
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${available > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {available > 0 ? `In stock: ${available}` : 'Out of stock'}
                  </span>
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

export default function SupportPartsQueuePage() {
  const base = usePartsBase();
  const [pending, setPending] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');

  const load = useCallback(() => {
    setLoading(true);
    getSupportPartsWarehouseQueue()
      .then((r) => { setPending(r.data.pending || []); setReturns(r.data.returns || []); })
      .catch(() => { setPending([]); setReturns([]); })
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

      <div className="flex gap-2">
        {[
          { id: 'pending', label: `Requests (${pending.length})` },
          { id: 'returns', label: `Returns (${returns.length})` },
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
      ) : (
        <ReturnsTab requests={returns} onAction={load} />
      )}
    </div>
  );
}
