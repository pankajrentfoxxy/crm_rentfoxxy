import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, Input, KeyValue, Notice, Section,
  Textarea,
} from '../../../components/carret';
import {
  assignItem, chargeWfh, fetchTechnicians, fetchTicket, fetchTicketSla, fetchTicketWfh, holdTicket, releaseHold,
  setAppointment,
} from './serveApi';
import { usePermission } from '../../../hooks/usePermission';
import TicketActions from './TicketActions';
import { SLA_TONE, STEP_LABEL, errMsg, when } from './serveShared';

/**
 * Serve → a ticket (support lead, claude/carret-support.md step 4).
 *
 * What the lead does here: see both SLA clocks and put the ticket on hold when
 * the customer is the one we wait for; assign each laptop (technicians listed
 * by open work, the least busy first); set the visit slot; see which laptops
 * are work-from-home and charge a WFH pickup / replacement (Rs 799 + GST).
 * Pickup creation, replacement, Service DC and parts stay on the existing
 * ticket screen ("Old view") until Support is signed off.
 */
function Clock({ label, c }) {
  if (!c || c.state === 'n/a') return <div><div className="text-ink-3">{label}</div><div>—</div></div>;
  const text = { met: 'Met', breached: 'Late', at_risk: 'Due soon', on_track: 'On time', paused: 'Paused' }[c.state] || c.state;
  return (
    <div>
      <div className="text-ink-3">{label}</div>
      <div style={{ color: SLA_TONE[c.state], fontWeight: 600 }}>{text}</div>
      <div className="text-ink-3" style={{ fontSize: '12px' }}>{c.done_at ? <>done <DateTime value={c.done_at} /></> : (c.due_at ? `due ${when(c.due_at)}` : '')}</div>
    </div>
  );
}

export default function TicketRecordPage() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [t, setT] = useState(null);
  const [sla, setSla] = useState(null);
  const [wfh, setWfh] = useState({});
  const [techs, setTechs] = useState([]);
  const [assignFor, setAssignFor] = useState(null);
  const [apptFor, setApptFor] = useState(null);
  const [appt, setAppt] = useState('');
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdNote, setHoldNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    fetchTicket(ticketId).then(({ data }) => setT(data)).catch((e) => setError(errMsg(e, 'Could not load the ticket')));
    fetchTicketSla(ticketId).then(({ data }) => setSla(data)).catch(() => {});
    fetchTicketWfh(ticketId).then(({ data }) => setWfh(Object.fromEntries((data.items || []).map((i) => [i.item_id, i])))).catch(() => {});
  }, [ticketId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchTechnicians().then(({ data }) => setTechs(data.technicians || [])).catch(() => {}); }, []);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); load(); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(false); }
  };

  if (error) return <DeskShell title={`#${ticketId}`} breadcrumb="Serve / Queue"><EmptyState title="Could not load" body={error} action={<Button onClick={() => navigate('/carret/serve/queue')}>Back</Button>} /></DeskShell>;
  if (!t) return <DeskShell title={`#${ticketId}`} breadcrumb="Serve / Queue"><EmptyState title="Loading…" /></DeskShell>;

  const tk = t.ticket;
  const items = (t.items || []).filter((i) => !['removed'].includes(i.status));
  const onHold = (sla?.holds || []).find((h) => !h.to_at);
  const closed = ['closed', 'cancelled'].includes(tk.status);
  const byLoad = [...techs].filter((x) => x.assignee_kind === 'technician').sort((a, b) => (a.open_item_count - b.open_item_count) || String(a.name).localeCompare(b.name));
  const suggested = byLoad[0]?.user_id;

  const itemCols = [
    { key: 't', header: 'Laptop', render: (i) => <DocNumber value={i.ttspl_id || i.unique_serial_number || i.serial_number || '—'} />, sub: (i) => [i.brand, i.model].filter(Boolean).join(' ') },
    { key: 'k', header: 'Type', render: (i) => ({ complaint: 'Visit', pickup: i.pickup_type === 'repair' ? 'Repair pickup' : 'Return pickup', replacement: 'Replacement' }[i.item_type] || i.item_type), sub: (i) => i.issue_category_label || null },
    { key: 's', header: 'Where it is', render: (i) => STEP_LABEL[i.effective_current_step] || STEP_LABEL[i.current_step] || STEP_LABEL[i.status] || String(i.status).replace(/_/g, ' '), sub: (i) => (i.repair_ready_at ? 'Repaired — ready to send back' : (i.remarks || null)) },
    {
      key: 'a',
      header: 'Technician',
      render: (i) => {
        const tech = techs.find((x) => x.user_id === (i.assigned_to || i.pickup_assigned_to));
        return tech ? tech.name : <span className="text-ink-3">not assigned</span>;
      },
      sub: (i) => (i.visit_scheduled_at ? `🗓 ${when(i.visit_scheduled_at)}` : null),
    },
    {
      key: 'w',
      header: 'WFH',
      render: (i) => {
        const w = wfh[i.id];
        if (!w?.is_wfh) return '—';
        if (w.charged) return <span>Charged ₹{Number(w.amount).toLocaleString('en-IN')} on <span className="font-mono">{w.dc_number}</span></span>;
        return <span style={{ color: 'var(--alert-warn)', fontWeight: 600 }}>Work from home</span>;
      },
    },
    {
      key: 'x',
      header: '',
      render: (i) => !closed && !['resolved', 'inventory_updated', 'cancelled', 'delivered'].includes(i.status) && (
        <div className="flex flex-wrap" style={{ gap: '6px' }}>
          {i.item_type !== 'replacement' && <Button onClick={(e) => { e.stopPropagation(); setAssignFor(i); }}>{i.assigned_to || i.pickup_assigned_to ? 'Reassign' : 'Assign'}</Button>}
          <Button variant="quiet" onClick={(e) => { e.stopPropagation(); setApptFor(i); setAppt(i.visit_scheduled_at ? new Date(new Date(i.visit_scheduled_at).getTime() + 330 * 60000).toISOString().slice(0, 16) : ''); }}>Visit slot</Button>
          {wfh[i.id]?.is_wfh && !wfh[i.id]?.charged && (i.item_type === 'replacement' || (i.item_type === 'pickup' && i.return_dc_number)) && (
            <Button variant="quiet" disabled={busy} onClick={(e) => { e.stopPropagation(); if (window.confirm('Charge this work-from-home delivery Rs 799 + GST? It goes on the Delivery Charges list.')) run(() => chargeWfh(i.id), 'Charged — it shows under Delivery Charges'); }}>Charge WFH ₹799</Button>
          )}
        </div>
      ),
    },
  ];

  const history = (t.audit || []).slice(0, 25);

  return (
    <DeskShell title={`Ticket #${tk.id}`} breadcrumb="Serve / Queue" subtitle={tk.customer_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={`#${tk.id}`}
          type={`Support ticket${tk.ticket_category ? ` · ${tk.ticket_category}` : ''}`}
          status={tk.status === 'in_progress' ? 'pending' : tk.status}
          actions={(
            <>
              {!closed && (onHold
                ? <Button disabled={busy} onClick={() => run(() => releaseHold(tk.id), 'Released — the SLA clock runs again')}>Release hold</Button>
                : <Button onClick={() => setHoldOpen(true)}>On hold (customer)</Button>)}
              <Button variant="quiet" onClick={() => navigate(`/support/tickets/${tk.id}`)}>Old view (pickup, replacement, Service DC, parts)</Button>
            </>
          )}
          meta={[
            { label: 'Customer', value: tk.customer_name },
            { label: 'Phone', value: tk.display_phone || '—' },
            { label: 'Priority', value: tk.priority },
            { label: 'Raised', value: <DateTime value={tk.created_at} /> },
            { label: 'Return DC', value: tk.return_dc_number || '—' },
          ]}
        />
        {onHold && <Notice tone="warn" title="On hold — waiting on the customer">{onHold.note} (since <DateTime value={onHold.from_at} />). The SLA clock is paused.</Notice>}
        {items.some((i) => i.repair_ready_at && !i.service_dc_number) && (
          <Notice tone="good" title="Repaired — ready to go back" action={<Button variant="primary" onClick={() => navigate(`/support/tickets/${tk.id}`)}>Raise the Service DC</Button>}>
            The floor has finished the repair. Raise the Service DC to send it back to the customer.
          </Notice>
        )}
        {sla?.sla && (
          <Section title="SLA">
            <div className="flex flex-wrap" style={{ gap: '32px' }}>
              <Clock label="Technician visit" c={sla.sla.visit} />
              <Clock label="Resolved" c={sla.sla.resolve} />
              <div><div className="text-ink-3">Targets ({sla.sla.priority})</div><div className="text-ink-3" style={{ fontSize: '12px' }}>visit {Math.round((sla.targets?.[sla.sla.priority]?.visit || 0) / 60)} business h · resolve {Math.round((sla.targets?.[sla.sla.priority]?.resolve || 0) / 600)} business day(s)</div></div>
            </div>
          </Section>
        )}
        <Section title={`Laptops · ${items.length}`}>
          <DataTable columns={itemCols} rows={items} rowKey={(i) => i.id} />
        </Section>
        {hasPermission('support_tickets', 'edit') && <TicketActions data={t} techs={techs} reload={load} />}
        <Section title="Contact and address">
          <KeyValue cols={2} items={[
            { label: 'Phone', value: tk.display_phone },
            { label: 'Alternate', value: tk.ticket_alt_phone },
            { label: 'Email', value: tk.ticket_email },
            { label: 'Address', value: tk.ticket_address },
            { label: 'Note', value: tk.top_level_remarks },
          ]}
          />
        </Section>
        <Section title="History">
          {history.length === 0 ? <EmptyState title="Nothing yet" /> : (
            <DataTable
              columns={[
                { key: 'w', header: 'When', render: (h) => <DateTime value={h.created_at} /> },
                { key: 'a', header: 'What', render: (h) => (h.action === 'status_changed' && h.detail ? `${STEP_LABEL[h.detail.from] || h.detail.from} → ${STEP_LABEL[h.detail.to] || h.detail.to}` : String(h.action).replace(/_/g, ' ')) },
                { key: 'u', header: 'Who', render: (h) => h.user_name || h.actor_name || '—' },
              ]}
              rows={history}
              rowKey={(h, idx) => h.id || idx}
            />
          )}
        </Section>
      </div>

      <Drawer open={Boolean(assignFor)} onClose={() => setAssignFor(null)} title={`Assign ${assignFor?.ttspl_id || ''}`}>
        <p className="text-ink-3" style={{ marginBottom: '8px' }}>Least busy first. Open jobs count both visits and pickups.</p>
        <div className="c-stack" style={{ gap: '6px' }}>
          {byLoad.map((x) => (
            <button
              key={x.user_id}
              type="button"
              className="c-btn"
              disabled={busy}
              style={{ justifyContent: 'space-between' }}
              onClick={async () => { if (await run(() => assignItem(assignFor.id, x.user_id), `Assigned to ${x.name}`)) setAssignFor(null); }}
            >
              <span>{x.name}{x.user_id === suggested ? ' · suggested' : ''}</span>
              <span className="text-ink-3">{x.open_item_count} open · {x.today_visits || 0} today</span>
            </button>
          ))}
          {!byLoad.length && <EmptyState title="No technicians found" />}
        </div>
      </Drawer>

      <Drawer
        open={Boolean(apptFor)}
        onClose={() => setApptFor(null)}
        title="Visit slot"
        footer={<Button variant="primary" disabled={busy} onClick={async () => { if (await run(() => setAppointment(apptFor.id, appt ? `${appt}:00+05:30` : null), 'Visit slot saved')) setApptFor(null); }}>Save</Button>}
      >
        <Field label="Date and time (IST)" hint="Shown on the technician's My work. Clear it to remove.">
          <Input type="datetime-local" value={appt} onChange={(e) => setAppt(e.target.value)} />
        </Field>
      </Drawer>

      <Drawer
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        title="Put on hold"
        footer={<Button variant="primary" disabled={busy || holdNote.trim().length < 3} onClick={async () => { if (await run(() => holdTicket(tk.id, holdNote.trim()), 'On hold — SLA paused')) { setHoldOpen(false); setHoldNote(''); } }}>Put on hold</Button>}
      >
        <p style={{ marginBottom: '8px' }}>Use this only when we are waiting on the customer (not reachable, asked to come later). Waiting for a part pauses the SLA by itself.</p>
        <Field label="What are we waiting for" required><Textarea rows={3} value={holdNote} onChange={(e) => setHoldNote(e.target.value)} /></Field>
      </Drawer>
    </DeskShell>
  );
}
