import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal, TypeTag } from '../../../components/ui/supportPrimitives';
import { usePermission } from '../../../hooks/usePermission';
import { createWorkOrder, fetchQueueMeta } from '../supportV2Api';
import { WO_TYPES, WO_TYPE_SECTION, woTypeLabel } from '../supportV2Utils';

export default function CreateWorkOrderModal({ ticket, lines, onClose, onCreated }) {
  const { canCreate } = usePermission();
  const types = WO_TYPES.filter((t) => canCreate('support_work_orders') && canCreate(WO_TYPE_SECTION[t]));
  const [woType, setWoType] = useState(types[0] || '');
  const [lineIds, setLineIds] = useState(lines.map((l) => l.line_id));
  const [method, setMethod] = useState('technician');
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [owners, setOwners] = useState([]);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    fetchQueueMeta().then((r) => setOwners(r.data?.owners || [])).catch(() => {});
  }, []);

  const needsDoc = ['REPAIR_PICKUP', 'RETURN_PICKUP', 'SERVICE_RETURN', 'REPLACEMENT_DELIVERY'].includes(woType);
  const eway = false;

  const toggle = (id) => {
    setLineIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const submit = async () => {
    if (!woType || !lineIds.length) return;
    setSaving(true);
    try {
      const r = await createWorkOrder(ticket.ticket_id, {
        wo_type: woType,
        line_ids: lineIds,
        method,
        scheduled_start: slotStart ? new Date(slotStart).toISOString() : null,
        scheduled_end: slotEnd ? new Date(slotEnd).toISOString() : null,
        assigned_to: assignedTo ? Number(assignedTo) : null,
      });
      toast.success(`Created ${r.data.wo.wo_number}`);
      onCreated(r.data.wo);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not create work order');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Create work order"
      subtitle={ticket.ticket_number}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!woType || !lineIds.length} loading={saving} onClick={submit}>Create</Button>
        </>
      )}
    >
      <div className="space-y-3 text-[12px]">
        <div>
          <div className="font-semibold mb-1">Type</div>
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setWoType(t)}
                className={`rounded-full ${woType === t ? 'ring-2 ring-sup-accent' : ''}`}
              >
                <TypeTag type={t} />
              </button>
            ))}
            {!types.length && <p className="text-pri1">No work-order types you can create.</p>}
          </div>
        </div>
        <div>
          <div className="font-semibold mb-1">Machines</div>
          <div className="flex flex-wrap gap-1.5">
            {lines.map((l) => (
              <button
                key={l.line_id}
                type="button"
                onClick={() => toggle(l.line_id)}
                className={`px-2 py-1 rounded border ${lineIds.includes(l.line_id) ? 'bg-sup-accentSoft border-sup-accent' : 'border-sup-line'}`}
              >
                {l.line_code} {l.ttspl_id || 'Unknown'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>Method
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5">
              <option value="technician">Technician</option>
              <option value="courier">Courier</option>
              <option value="remote">Remote</option>
            </select>
          </label>
          <label>Assign to
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5">
              <option value="">Unassigned</option>
              {owners.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
            </select>
          </label>
          <label>Slot start
            <input type="datetime-local" value={slotStart} onChange={(e) => setSlotStart(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5" />
          </label>
          <label>Slot end
            <input type="datetime-local" value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} className="mt-1 w-full border rounded px-2 py-1.5" />
          </label>
        </div>
        {needsDoc && (
          <div className="rounded-md bg-sup-okBg text-sup-ok px-2 py-1.5">
            A {woType === 'SERVICE_RETURN' ? 'Service DC (SDC-)' : 'Return DC'} will be generated.
            {eway ? ' e-Way Bill required (> ₹50,000).' : ' e-Way Bill not required.'}
          </div>
        )}
        <p className="text-sup-muted">{woTypeLabel(woType)}</p>
      </div>
    </Modal>
  );
}
