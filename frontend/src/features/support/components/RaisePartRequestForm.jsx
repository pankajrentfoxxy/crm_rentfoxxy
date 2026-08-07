import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wrench, ChevronDown, PenLine, Check, RotateCcw, Truck, Search, X } from 'lucide-react';
import api from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import {
  raiseSupportPartRequest,
  listSupportPartRequests,
  cancelSupportPartRequest,
  markPartUsed,
  returnPart,
} from '../supportPartsApi';
import ESignChallanModal from './ESignChallanModal';

const STATUS_LABEL = {
  pending: 'Awaiting warehouse',
  approved: 'Approved',
  challan_generated: 'Challan ready - sign at warehouse',
  issued: 'In your bucket',
  used: 'Used on laptop',
  return_requested: 'Return requested',
  returned: 'Returned',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function PartRequestRow({ req, onChanged, canManageReturn }) {
  const [busy, setBusy] = useState(false);
  const [returnMenu, setReturnMenu] = useState(false);
  const [signReq, setSignReq] = useState(null);

  const needsSign = ['approved', 'challan_generated'].includes(req.status) && req.challan_id;
  const canAct = req.status === 'issued';
  const isReturnRequested = req.status === 'return_requested';
  const canRemove = req.status === 'pending';

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
      setReturnMenu(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-100 bg-white px-2.5 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-mono text-amber-700">{req.request_number}</span>
          {' · '}{req.part_name} (x{req.quantity})
        </span>
        {!canAct && !isReturnRequested && !needsSign && (
          <span className="shrink-0 text-amber-800 font-medium">
            {STATUS_LABEL[req.status] || req.status}
          </span>
        )}
        {isReturnRequested && (
          <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
            Pickup requested
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {canRemove && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => cancelSupportPartRequest(req.id), 'Part request removed')}
            className="inline-flex items-center gap-1 px-2 py-1 border border-red-200 text-red-700 rounded-md font-semibold disabled:opacity-50 bg-white hover:bg-red-50"
          >
            <X className="w-3 h-3" />
            {busy ? 'Removing…' : 'Remove'}
          </button>
        )}
        {canAct && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => markPartUsed(req.id), 'Part marked as used')}
              className="inline-flex items-center gap-1 px-2 py-1 bg-green-600 text-white rounded-md font-semibold disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {busy ? 'Saving…' : 'Mark used'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setReturnMenu((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 text-gray-700 rounded-md font-semibold disabled:opacity-50 bg-white"
            >
              <RotateCcw className="w-3 h-3" /> Return
            </button>
          </>
        )}
        {needsSign && (
          <Link
            to={`/support/challans/${req.challan_id}`}
            className="inline-flex items-center gap-1 px-2 py-1 bg-[#534AB7] text-white rounded-md font-semibold"
          >
            <PenLine className="w-3 h-3" /> Sign challan
          </Link>
        )}
        {canManageReturn && isReturnRequested && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setSignReq({ requestId: req.id, viaPickup: true })}
            className="inline-flex items-center gap-1 px-2 py-1 bg-[#534AB7] text-white rounded-md font-semibold disabled:opacity-50"
          >
            <Check className="w-3 h-3" /> Accept return
          </button>
        )}
      </div>

      {returnMenu && canAct && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-gray-50 border border-gray-100 p-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => returnPart(req.id, { method: 'pickup_request' }), 'Pickup requested')}
            className="inline-flex items-center gap-2 px-2 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-700"
          >
            <Truck className="w-3.5 h-3.5" /> Request pickup (warehouse collects)
          </button>
          {canManageReturn && (
            <button
              type="button"
              disabled={busy}
              onClick={() => { setReturnMenu(false); setSignReq({ requestId: req.id, viaPickup: false }); }}
              className="inline-flex items-center gap-2 px-2 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-700"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Returned at warehouse now (e-sign)
            </button>
          )}
        </div>
      )}

      {signReq && (
        <ESignChallanModal
          challan={{ challan_number: req.challan_number }}
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

export default function RaisePartRequestForm({ ticket, item }) {
  const { user } = useAuth();
  const canManageReturn = ['warehouse', 'admin', 'manager', 'support_lead', 'super_admin'].includes(user?.role);
  const [open, setOpen] = useState(false);
  const [partId, setPartId] = useState('');
  const [partSearch, setPartSearch] = useState('');
  const [showParts, setShowParts] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [parts, setParts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState([]);

  const selectedPart = useMemo(
    () => parts.find((p) => String(p.part_id) === String(partId)),
    [parts, partId]
  );

  const filteredParts = useMemo(() => {
    const q = partSearch.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter((p) =>
      String(p.part_name || '').toLowerCase().includes(q) ||
      String(p.part_sku || '').toLowerCase().includes(q) ||
      String(p.category || p.part_type || '').toLowerCase().includes(q)
    );
  }, [parts, partSearch]);

  const ttsplId = item?.ttspl_id || item?.unique_serial_number || item?.serial_number || '';

  const loadExisting = () => {
    listSupportPartRequests({ support_ticket_id: ticket.id })
      .then((r) => {
        const rows = (r.data.requests || []).filter(
          (req) =>
            !['cancelled', 'rejected'].includes(req.status) &&
            (!item?.id || req.support_item_id === item.id)
        );
        setExisting(rows);
      })
      .catch(() => setExisting([]));
  };

  useEffect(() => {
    api.get('/parts').then((r) => setParts(r.data.parts || [])).catch(() => setParts([]));
  }, []);

  useEffect(() => {
    loadExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, item?.id]);

  const submit = async () => {
    if (!partId) return;
    setSaving(true);
    try {
      const { data } = await raiseSupportPartRequest({
        support_ticket_id: ticket.id,
        support_item_id: item?.id,
        ttspl_id: ttsplId || undefined,
        serial_number: item?.serial_number || undefined,
        part_id: Number(partId),
        quantity: Number(quantity),
        reason: reason.trim() || undefined,
      });
      toast.success(data.message || 'Part request raised');
      setPartId('');
      setPartSearch('');
      setShowParts(false);
      setQuantity(1);
      setReason('');
      loadExisting();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to raise request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] text-left"
      >
        <span className="inline-flex items-center gap-2 font-semibold text-amber-900 text-sm">
          <Wrench className="w-4 h-4" /> Request a part for this visit
          {existing.length > 0 && (
            <span className="text-xs font-normal bg-amber-200 text-amber-800 rounded-full px-2 py-0.5">
              {existing.length}
            </span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-amber-700 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {existing.length > 0 && (
            <div className="space-y-1">
              {existing.map((req) => (
                <PartRequestRow
                  key={req.id}
                  req={req}
                  onChanged={loadExisting}
                  canManageReturn={canManageReturn}
                />
              ))}
            </div>
          )}

          <p className="text-xs text-amber-700">
            Ticket STK-{String(ticket.id).padStart(4, '0')}
            {ttsplId ? ` · ${ttsplId}` : ''}
          </p>

          {selectedPart ? (
            <div className="flex items-center justify-between gap-2 w-full border rounded-xl px-3 py-3 min-h-[44px] bg-white">
              <span className="min-w-0 truncate text-base">
                {selectedPart.part_name}
                <span className="text-gray-400"> (Stock: {selectedPart.quantity ?? 0})</span>
              </span>
              <button
                type="button"
                onClick={() => { setPartId(''); setPartSearch(''); setShowParts(true); }}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline"
              >
                <X className="w-3.5 h-3.5" /> Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={partSearch}
                onChange={(e) => { setPartSearch(e.target.value); setShowParts(true); }}
                onFocus={() => setShowParts(true)}
                onBlur={() => setTimeout(() => setShowParts(false), 150)}
                placeholder="Search part needed…"
                className="w-full border rounded-xl pl-9 pr-3 py-3 min-h-[44px] text-base bg-white"
              />
              {showParts && (
                <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-amber-200 bg-white shadow-lg">
                  {filteredParts.length === 0 ? (
                    <p className="px-3 py-2.5 text-sm text-gray-500">No parts found</p>
                  ) : filteredParts.map((p) => (
                    <button
                      key={p.part_id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setPartId(String(p.part_id)); setPartSearch(''); setShowParts(false); }}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-amber-50 border-b border-amber-50 last:border-0"
                    >
                      {p.part_name}
                      <span className="text-gray-400"> (Stock: {p.quantity ?? 0})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-amber-700 block mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                max={5}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                className="w-full border rounded-xl px-3 py-3 min-h-[44px] text-base text-center bg-white"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-amber-700 block mb-1">Reason (optional)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this part needed?"
                className="w-full border rounded-xl px-3 py-3 min-h-[44px] text-base bg-white"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={!partId || saving}
            onClick={submit}
            className="w-full py-3 min-h-[44px] bg-amber-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Raising request…' : 'Request part from warehouse'}
          </button>
        </div>
      )}
    </div>
  );
}
