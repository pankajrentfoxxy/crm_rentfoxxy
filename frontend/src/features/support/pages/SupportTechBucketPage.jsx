import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Package, FileText, Check, RotateCcw, Truck, PenLine } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { getTechnicianBucket, markPartUsed, returnPart } from '../supportPartsApi';
import ESignChallanModal from '../components/ESignChallanModal';
import { usePartsBase } from '../partsBase';

function PartRow({ part, onChanged, canManageReturn, base }) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [signReq, setSignReq] = useState(null);

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
        {isReturnRequested && (
          <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
            Pickup requested
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!isReturnRequested && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => markPartUsed(part.id), 'Marked as used')}
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
    </div>
  );
}

export default function SupportTechBucketPage() {
  const { user } = useAuth();
  const base = usePartsBase();
  const [bucket, setBucket] = useState([]);
  const [awaiting, setAwaiting] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const isTech = user?.role === 'support_tech';
  const canManageReturn = ['warehouse', 'admin', 'manager', 'support_lead', 'super_admin'].includes(user?.role);

  const load = useCallback(() => {
    setLoading(true);
    getTechnicianBucket()
      .then((r) => {
        setBucket(r.data.bucket || []);
        setAwaiting(r.data.awaiting || []);
        setTotal(r.data.total || 0);
      })
      .catch(() => { setBucket([]); setAwaiting([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Package className="w-5 h-5 text-[#534AB7]" />
        <h1 className="text-lg font-semibold m-0">{isTech ? 'My parts bucket' : 'Technician parts bucket'}</h1>
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
    </div>
  );
}
