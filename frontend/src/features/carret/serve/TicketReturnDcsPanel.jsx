import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Section, StatusChip,
} from '../../../components/carret';
import { assignPickup } from './serveApi';
import { STEP_LABEL, errMsg } from './serveShared';
import CollectLaterDrawer from './CollectLaterDrawer';

const RDC_LABEL = { pending: 'To dispatch', in_transit: 'Out to collect', reached: 'Technician there', shipped: 'Courier', delivered: 'Received', cancelled: 'Cancelled' };
const RDC_CHIP = { pending: 'pending', in_transit: 'dispatched', reached: 'dispatched', shipped: 'dispatched', delivered: 'delivered', cancelled: 'cancelled' };
const LIVE = (d) => !['cancelled', 'delivered'].includes(String(d.status || '').toLowerCase());

/**
 * Ticket record → Return challans: every Return DC of the ticket with its
 * laptops and where each one is. A ticket has more than one when the customer
 * kept a laptop and it was moved to a later pickup ("Collect later"). The lead
 * can move a laptop not yet collected to a later pickup, and dispatch a Return
 * DC that has nobody collecting it yet.
 */
export default function TicketReturnDcsPanel({
  data, techs = [], canLead = false, closed = false, reload,
}) {
  const [later, setLater] = useState(null);
  const [assignFor, setAssignFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const tk = data.ticket;
  const dcs = data.return_dcs || [];
  if (!dcs.length) return null;

  const techName = (id) => techs.find((x) => x.user_id === id)?.name || null;
  const fieldTechs = techs.filter((x) => x.assignee_kind === 'technician')
    .sort((a, b) => (a.open_item_count - b.open_item_count) || String(a.name).localeCompare(b.name));

  const assign = async (userId) => {
    setBusy(true);
    try {
      await assignPickup(tk.id, { dispatch_mode: 'technician', technician_user_id: userId, return_dc_number: assignFor });
      toast.success(`${assignFor} assigned`);
      setAssignFor(null);
      reload?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const cols = (d) => [
    { key: 't', header: 'Laptop', render: (l) => <DocNumber value={l.ttspl_id || l.serial_number || '—'} /> },
    {
      key: 's',
      header: 'Where it is',
      render: (l) => (l.warehouse_received_at ? 'Received at the warehouse' : (STEP_LABEL[l.step] || String(l.status || '').replace(/_/g, ' '))),
      sub: (l) => (l.warehouse_received_at ? <DateTime value={l.warehouse_received_at} /> : (l.collected ? 'Collected from the customer' : 'Still with the customer')),
    },
    {
      key: 'w',
      header: 'Pickup',
      render: (l) => (l.pickup_scheduled_at ? <DateTime value={l.pickup_scheduled_at} /> : '—'),
      sub: (l) => (l.assigned_to ? techName(l.assigned_to) : (l.pickup_method || 'not assigned')),
    },
    {
      key: 'x',
      header: '',
      render: (l) => (canLead && !closed && LIVE(d) && !l.collected && !l.gate_inward_at && d.laptops.length > 1 ? (
        <Button variant="quiet" onClick={() => setLater({ id: l.item_id, code: l.ttspl_id || l.serial_number, rdc: d.return_dc_number })}>
          Collect later
        </Button>
      ) : null),
    },
  ];

  return (
    <Section title={`Return challans · ${dcs.length}`}>
      <div className="c-stack">
        {dcs.map((d) => (
          <div key={d.return_dc_number} className="c-card" style={{ padding: '12px 16px' }}>
            <div className="flex flex-wrap items-center" style={{ gap: '8px', marginBottom: '8px' }}>
              <Link to={`/carret/move/return-challans/${encodeURIComponent(d.return_dc_number)}`}><DocNumber value={d.return_dc_number} /></Link>
              <StatusChip status={RDC_CHIP[d.status] || d.status} label={RDC_LABEL[d.status] || d.status} />
              <span className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
                {d.laptops.length} laptop(s) · {d.collected_count} collected · {d.received_count} received
                {d.is_primary && dcs.length > 1 ? ' · first pickup' : ''}
              </span>
              {canLead && !closed && LIVE(d) && d.laptops.length > 0 && d.laptops.every((l) => !l.assigned_to && !['courier', 'porter'].includes(l.pickup_method)) && (
                <Button onClick={() => setAssignFor(d.return_dc_number)}>Assign technician</Button>
              )}
            </div>
            {d.remarks && <p className="text-ink-3" style={{ fontSize: 'var(--d-sm)', marginBottom: '6px' }}>{d.remarks}</p>}
            <DataTable columns={cols(d)} rows={d.laptops} rowKey={(l) => l.item_id} empty={<EmptyState title="No laptops on this challan" />} />
          </div>
        ))}
      </div>

      <CollectLaterDrawer
        open={Boolean(later)}
        onClose={() => setLater(null)}
        onDone={() => { setLater(null); reload?.(); }}
        item={later}
        asLead
        techs={techs}
      />
      <Drawer open={Boolean(assignFor)} onClose={() => setAssignFor(null)} title={`Who collects ${assignFor || ''}`}>
        <div className="c-stack" style={{ gap: '6px' }}>
          {fieldTechs.map((x) => (
            <button key={x.user_id} type="button" className="c-btn" disabled={busy} style={{ justifyContent: 'space-between' }} onClick={() => assign(x.user_id)}>
              <span>{x.name}</span>
              <span className="text-ink-3">{x.open_item_count} open · {x.today_visits || 0} today</span>
            </button>
          ))}
          {!fieldTechs.length && <EmptyState title="No technicians found" />}
        </div>
      </Drawer>
    </Section>
  );
}
