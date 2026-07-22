import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wrench, ChevronDown, PenLine } from 'lucide-react';
import api from '../../../utils/api';
import { raiseSupportPartRequest, listSupportPartRequests } from '../supportPartsApi';

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

export default function RaisePartRequestForm({ ticket, item }) {
  const [open, setOpen] = useState(false);
  const [partId, setPartId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [parts, setParts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState([]);

  const ttsplId = item?.ttspl_id || item?.unique_serial_number || item?.serial_number || '';

  const loadExisting = () => {
    listSupportPartRequests({ support_ticket_id: ticket.id })
      .then((r) => {
        const rows = (r.data.requests || []).filter(
          (req) => !item?.id || req.support_item_id === item.id
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
              {existing.map((req) => {
                const needsSign = ['approved', 'challan_generated'].includes(req.status) && req.challan_id;
                return (
                  <div key={req.id} className="flex items-center justify-between text-xs bg-white rounded-lg border border-amber-100 px-2.5 py-2">
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-amber-700">{req.request_number}</span>
                      {' · '}{req.part_name} (x{req.quantity})
                    </span>
                    {needsSign ? (
                      <Link
                        to={`/support/challans/${req.challan_id}`}
                        className="shrink-0 ml-2 inline-flex items-center gap-1 px-2 py-1 bg-[#534AB7] text-white rounded-md font-semibold"
                      >
                        <PenLine className="w-3 h-3" /> Sign challan
                      </Link>
                    ) : (
                      <span className="shrink-0 ml-2 text-amber-800 font-medium">
                        {STATUS_LABEL[req.status] || req.status}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-amber-700">
            Ticket STK-{String(ticket.id).padStart(4, '0')}
            {ttsplId ? ` · ${ttsplId}` : ''}
          </p>

          <select
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            className="w-full border rounded-xl px-3 py-3 min-h-[44px] text-base bg-white"
          >
            <option value="">Select part needed…</option>
            {parts.map((p) => (
              <option key={p.part_id} value={p.part_id}>
                {p.part_name} (Stock: {p.quantity ?? 0})
              </option>
            ))}
          </select>

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
