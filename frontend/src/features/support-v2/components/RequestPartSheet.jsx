import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal, Mono } from '../../../components/ui/supportPrimitives';
import { createPartRequest, fetchCompatibleParts } from '../supportV2Api';
import { LABELS } from '../supportV2Utils';
import EvidenceUploader from './EvidenceUploader';

export default function RequestPartSheet({ ticketId, line, workOrderId, onClose, onCreated }) {
  const [parts, setParts] = useState([]);
  const [partId, setPartId] = useState('');
  const [qty, setQty] = useState(1);
  const [collectOld, setCollectOld] = useState(false);
  const [reason, setReason] = useState('');
  const [fault, setFault] = useState('COMPANY_FAULT');
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!line?.serial_id) return;
    fetchCompatibleParts(line.serial_id)
      .then((r) => setParts(r.data?.rows || []))
      .catch(() => toast.error('Could not load compatible parts'));
  }, [line?.serial_id]);

  const part = parts.find((p) => String(p.part_id) === String(partId));
  const meta = LABELS.FAULT[fault];
  const chargeable = Boolean(meta?.chargeable);
  const unit = part?.selling_price != null ? Number(part.selling_price) : null;
  const gst = Number(part?.gst_rate ?? 18);
  const total = unit != null ? unit * Number(qty || 1) : null;
  const withGst = total != null ? total * (1 + gst / 100) : null;

  const canSubmit = useMemo(() => {
    if (!partId || String(reason).trim().length < 15) return false;
    if (chargeable && (!photos.length || unit == null)) return false;
    return true;
  }, [partId, reason, chargeable, photos.length, unit]);

  const submit = async () => {
    if (!canSubmit) {
      toast.error(chargeable && unit == null
        ? 'No selling price set for this part. Ask Parts to set it before raising a charge.'
        : 'Fill the required fields');
      return;
    }
    setSaving(true);
    try {
      await createPartRequest({
        support_ticket_id: ticketId,
        support_line_id: line.line_id,
        work_order_id: workOrderId || undefined,
        part_id: Number(partId),
        quantity: Number(qty) || 1,
        collect_old_part: collectOld,
        photo_attachment_ids: photos,
        reason,
        fault_attribution: fault,
      });
      toast.success('Part requested');
      onCreated();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not request part');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Request a part"
      subtitle={line?.ttspl_id || line?.serial_number}
      onClose={onClose}
      footer={(
        <>
          <Button size="touch" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="touch" loading={saving} disabled={!canSubmit} onClick={submit}>Submit request</Button>
        </>
      )}
    >
      <div className="space-y-2 text-[12px]">
        <div>
          <div className="text-[10px] uppercase text-sup-faint">Machine</div>
          <Mono bold>{line?.ttspl_id || line?.serial_number || '—'}</Mono>
        </div>
        <label className="block">Part
          <select className="w-full border rounded px-2 py-1.5 mt-0.5" value={partId} onChange={(e) => setPartId(e.target.value)}>
            <option value="">Select…</option>
            {parts.map((p) => (
              <option key={p.part_id} value={p.part_id}>
                {p.part_name} · {p.part_sku || 'SKU'} · in stock: {p.quantity ?? '—'} · ₹{p.selling_price ?? '—'}
                {Number(p.quantity) > 0 ? '' : ' · Not in stock — will escalate to procurement.'}
              </option>
            ))}
          </select>
        </label>
        <label className="block">Quantity
          <input type="number" min="1" className="w-full border rounded px-2 py-1.5 mt-0.5" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="block">Why is it needed
          <textarea className="w-full border rounded px-2 py-1.5 mt-0.5" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <span className="text-[11px] text-sup-muted">{String(reason).trim().length}/15</span>
        </label>
        <div className="font-semibold">Fault attribution</div>
        {Object.entries(LABELS.FAULT).map(([k, v]) => (
          <label key={k} className="flex items-start gap-2">
            <input type="radio" checked={fault === k} onChange={() => setFault(k)} />
            <span>{v.label}<br /><span className="text-sup-muted">{v.hint}</span></span>
          </label>
        ))}
        {chargeable && (
          <>
            <EvidenceUploader attachmentIds={photos} ticketId={ticketId} onChange={setPhotos} required />
            {unit == null ? (
              <p className="text-pri1">No selling price set for this part. Ask Parts to set it before raising a charge.</p>
            ) : (
              <div className="rounded-md bg-sup-canvas2 px-2 py-1.5">
                {part?.part_name} × {qty} @ ₹{unit} = ₹{total} + {gst}% GST = ₹{withGst.toFixed(0)}
              </div>
            )}
          </>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={collectOld} onChange={(e) => setCollectOld(e.target.checked)} />
          Old part expected
        </label>
      </div>
    </Modal>
  );
}
