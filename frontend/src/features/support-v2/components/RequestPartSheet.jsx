import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../../../components/ui/primitives';
import { Modal, Mono } from '../../../components/ui/supportPrimitives';
import { createPartRequest, fetchCompatibleParts, uploadAttachments } from '../supportV2Api';

export default function RequestPartSheet({ ticketId, line, onClose, onCreated }) {
  const [parts, setParts] = useState([]);
  const [meta, setMeta] = useState({ matched: 0, catalogue: 0, warning: false });
  const [partId, setPartId] = useState('');
  const [qty, setQty] = useState(1);
  const [collectOld, setCollectOld] = useState(false);
  const [reason, setReason] = useState('');
  const [liability, setLiability] = useState('COMPANY');
  const [charge, setCharge] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!line?.serial_id) return;
    fetchCompatibleParts(line.serial_id)
      .then((r) => {
        setParts(r.data?.rows || []);
        setMeta({
          matched: r.data?.matched ?? (r.data?.rows || []).length,
          catalogue: r.data?.catalogue || 0,
          warning: Boolean(r.data?.warning),
        });
      })
      .catch(() => toast.error('Could not load compatible parts'));
  }, [line?.serial_id]);

  const submit = async () => {
    if (!partId) { toast.error('Pick a part'); return; }
    if (!files.length) { toast.error('A photo is required'); return; }
    setSaving(true);
    try {
      const up = await uploadAttachments(ticketId, files, { line_id: line.line_id, kind: 'PHOTO_PART' });
      const ids = (up.data?.rows || []).map((x) => x.attachment_id);
      await createPartRequest({
        support_ticket_id: ticketId,
        support_line_id: line.line_id,
        part_id: Number(partId),
        quantity: Number(qty) || 1,
        collect_old_part: collectOld,
        photo_attachment_ids: ids,
        reason,
        liability,
        charge_amount: charge ? Number(charge) : undefined,
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
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={submit}>Submit request</Button>
        </>
      )}
    >
      <div className="space-y-2 text-[12px]">
        <div>
          <div className="text-[10px] uppercase text-sup-faint">Machine</div>
          <Mono bold>{line?.ttspl_id || line?.serial_number || '—'}</Mono>
        </div>
        <label className="block">
          Part
          <select className="w-full border rounded px-2 py-1.5 mt-0.5" value={partId} onChange={(e) => setPartId(e.target.value)}>
            <option value="">Select…</option>
            {parts.map((p) => (
              <option key={p.part_id} value={p.part_id}>{p.part_name}{Number(p.quantity) > 0 ? '' : ' · out of stock'}</option>
            ))}
          </select>
          <div className="text-[11px] text-sup-muted mt-0.5">
            {meta.warning
              ? `No compatibility data for this model — showing all ${meta.catalogue} parts`
              : `${meta.matched} of ${meta.catalogue} catalogue items`}
          </div>
        </label>
        <label className="block">Quantity
          <input type="number" min="1" className="w-full border rounded px-2 py-1.5 mt-0.5" value={qty}
            onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={collectOld} onChange={(e) => setCollectOld(e.target.checked)} />
          Old part expected
        </label>
        <label className="block">Photo (required)
          <input type="file" accept="image/*" multiple className="mt-0.5" onChange={(e) => setFiles([...e.target.files])} />
        </label>
        <label className="block">Reason
          <textarea className="w-full border rounded px-2 py-1.5 mt-0.5" rows={3} value={reason}
            onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="block">Liability
          <select className="w-full border rounded px-2 py-1.5 mt-0.5" value={liability}
            onChange={(e) => setLiability(e.target.value)}>
            <option value="COMPANY">Company</option>
            <option value="CUSTOMER_CHARGEABLE">Customer chargeable</option>
            <option value="VENDOR_WARRANTY">Vendor warranty</option>
          </select>
        </label>
        {liability === 'CUSTOMER_CHARGEABLE' && (
          <label className="block">Quote amount
            <input className="w-full border rounded px-2 py-1.5 mt-0.5" value={charge}
              onChange={(e) => setCharge(e.target.value)} />
          </label>
        )}
      </div>
    </Modal>
  );
}
