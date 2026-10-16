import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocumentHeader, Drawer, EmptyState, Field, Input, KeyValue, Notice, Section,
  Textarea,
} from '../../../components/carret';
import {
  assignItem, cancelTicket, chargeWfh, closeTicket, fetchTechnicians, fetchTicket, fetchTicketSla, fetchTicketWfh, holdTicket, releaseHold,
  setAppointment,
} from './serveApi';
import { usePermission } from '../../../hooks/usePermission';
import TicketActions from './TicketActions';
import IssuePanel from './IssuePanel';
import TicketPartsPanel from './TicketPartsPanel';
import ServiceChargesPanel from './ServiceChargesPanel';
import DamageReportDrawer from './DamageReportDrawer';
import TicketNextStep from './TicketNextStep';
import TicketReturnDcsPanel from './TicketReturnDcsPanel';
import TicketLoanPanel from './loan/TicketLoanPanel';
import TicketJourneys from './TicketJourneys';
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
  const [damageFor, setDamageFor] = useState(null);
  const [sla, setSla] = useState(null);
  const [wfh, setWfh] = useState({});
  const [techs, setTechs] = useState([]);
  const [assignFor, setAssignFor] = useState(null);
  const [apptFor, setApptFor] = useState(null);
  const [appt, setAppt] = useState('');
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdNote, setHoldNote] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [wfhFor, setWfhFor] = useState(null);
  const [error, setError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

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

  if (error) return <DeskShell title={`#${ticketId}`} breadcrumb="Support / Queue"><EmptyState title="Could not load" body={error} action={<Button onClick={() => navigate('/carret/serve/queue')}>Back</Button>} /></DeskShell>;
  if (!t) return <DeskShell title={`#${ticketId}`} breadcrumb="Support / Queue"><EmptyState title="Loading…" /></DeskShell>;

  const tk = t.ticket;
  const items = (t.items || []).filter((i) => !['removed'].includes(i.status));
  const onHold = (sla?.holds || []).find((h) => !h.to_at);
  const closed = ['closed', 'cancelled'].includes(tk.status);
  const canLead = hasPermission('support_tickets', 'edit');
  const canDamage = ['damage_charges', 'support_tickets', 'return_dc'].some((sec) => hasPermission(sec, 'create'));
  const byLoad = [...techs].filter((x) => x.assignee_kind === 'technician').sort((a, b) => (a.open_item_count - b.open_item_count) || String(a.name).localeCompare(b.name));
  const suggested = byLoad[0]?.user_id;

  const history = t.audit || [];
  const openAppt = (i) => { setApptFor(i); setAppt(i.visit_scheduled_at ? new Date(new Date(i.visit_scheduled_at).getTime() + 330 * 60000).toISOString().slice(0, 16) : ''); };

  return (
    <DeskShell title={`Ticket #${tk.id}`} breadcrumb="Support / Queue" subtitle={tk.customer_name}>
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
              {!closed && canLead && <Button variant="primary" onClick={() => setCloseOpen(true)}>Close ticket</Button>}
              {!closed && canLead && <Button variant="quiet" onClick={() => setCancelOpen(true)}>Cancel ticket</Button>}
              <Button variant="quiet" onClick={() => navigate(`/support/tickets/${tk.id}`)}>Old view</Button>
            </>
          )}
          meta={[
            { label: 'Customer', value: tk.customer_name },
            { label: 'Raised by', value: tk.ticket_contact_name || '—' },
            { label: 'Phone', value: tk.display_phone || '—' },
            { label: 'Priority', value: tk.priority },
            { label: 'Raised', value: <DateTime value={tk.created_at} /> },
            { label: (t.return_dcs || []).length > 1 ? 'Return DCs' : 'Return DC', value: (t.return_dcs || []).length ? t.return_dcs.map((d) => d.return_dc_number).join(', ') : (tk.return_dc_number || '—') },
          ]}
        />
        {tk.status === 'cancelled' && (
          <Notice tone="crit" title={`Cancelled${tk.cancelled_by_name ? ` by ${tk.cancelled_by_name}` : ''}${tk.cancelled_at ? ` · ${when(tk.cancelled_at)}` : ''}`}>
            {tk.cancellation_remark || 'No reason was recorded.'}
          </Notice>
        )}
        {tk.status === 'closed' && <Notice tone="good" title={`Closed${tk.closed_at ? ` · ${when(tk.closed_at)}` : ''}`}>{tk.resolution_notes || 'Every laptop is done.'}</Notice>}
        <TicketNextStep data={t} canLead={canLead} onAssign={(i) => setAssignFor(i)} onClose={() => setCloseOpen(true)} />
        {onHold && <Notice tone="warn" title="On hold — waiting on the customer">{onHold.note} (since <DateTime value={onHold.from_at} />). The SLA clock is paused.</Notice>}
        {!closed && items.some((i) => i.repair_ready_at && !i.service_dc_number) && (
          <Notice tone="good" title="Repaired — ready to go back">Raise the Service DC below to send it back to the customer.</Notice>
        )}

        <div className="c-split">
          <div className="c-stack min-w-0">
            <Section title={`Laptops · ${new Set(items.map((i) => i.ttspl_id || i.unique_serial_number || i.serial_number || i.id)).size}`}>
              <TicketJourneys
                items={items}
                techs={techs}
                wfh={wfh}
                locked={closed}
                canDamage={canDamage}
                onAssign={(i) => setAssignFor(i)}
                onSlot={openAppt}
                onWfh={(i) => setWfhFor(i)}
                onDamage={(i) => setDamageFor(i)}
                onCommented={load}
              />
            </Section>
            {hasPermission('support_tickets', 'edit') && tk.status !== 'cancelled' && <TicketActions data={t} techs={techs} reload={load} />}
            <TicketReturnDcsPanel data={t} techs={techs} canLead={canLead} closed={closed} reload={load} />
            <IssuePanel data={t} canLead={canLead && !closed} reload={load} />
            <TicketPartsPanel ticketId={tk.id} canLead={canLead && !closed} />
            <ServiceChargesPanel ticketId={tk.id} items={items} canLead={canLead && !closed} />
            <TicketLoanPanel ticketId={tk.id} refreshKey={items.map((i) => `${i.id}:${i.status}`).join(',')} />
            <section className="c-card">
              <div className="c-card-h">
                <button type="button" className="c-collapse-h" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
                  <h3>History · {history.length}</h3>
                  <span>{showHistory ? 'Hide' : 'Show'}</span>
                </button>
              </div>
              {showHistory && (
                <div className="c-card-b">
                  {history.length === 0 ? <EmptyState title="Nothing yet" /> : (
                    <DataTable
                      columns={[
                        { key: 'w', header: 'When', render: (h) => <DateTime value={h.created_at} /> },
                        { key: 'a', header: 'What', render: (h) => (h.action === 'status_changed' && h.detail ? `${STEP_LABEL[h.detail.from] || h.detail.from} → ${STEP_LABEL[h.detail.to] || h.detail.to}` : String(h.action).replace(/_/g, ' ')), sub: (h) => h.detail?.remark || h.detail?.reason || null },
                        { key: 'u', header: 'Who', render: (h) => h.user_name || h.actor_name || '—' },
                      ]}
                      rows={history}
                      rowKey={(h, idx) => h.id || idx}
                    />
                  )}
                </div>
              )}
            </section>
          </div>

          <aside className="c-stack min-w-0">
            {sla?.sla && (
              <Section title="SLA">
                <div className="c-stack" style={{ gap: '12px' }}>
                  <Clock label="Technician visit" c={sla.sla.visit} />
                  <Clock label="Resolved" c={sla.sla.resolve} />
                  <div className="text-ink-3" style={{ fontSize: '12px' }}>Targets ({sla.sla.priority}): visit {Math.round((sla.targets?.[sla.sla.priority]?.visit || 0) / 60)} business h · resolve {Math.round((sla.targets?.[sla.sla.priority]?.resolve || 0) / 600)} business day(s)</div>
                </div>
              </Section>
            )}
            <Section title="Contact and address">
              <KeyValue cols={1} items={[
                { label: 'Phone', value: tk.display_phone },
                { label: 'Alternate', value: tk.ticket_alt_phone },
                { label: 'Email', value: tk.ticket_email },
                { label: 'Address', value: tk.ticket_address },
                { label: 'Note', value: tk.top_level_remarks },
              ]}
              />
            </Section>
          </aside>
        </div>
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
      <Drawer
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={`Close ticket #${tk.id}`}
        footer={<Button variant="primary" disabled={busy} onClick={async () => { if (await run(() => closeTicket(tk.id), 'Ticket closed — the customer gets the feedback link')) setCloseOpen(false); }}>Close the ticket</Button>}
      >
        <p>Every laptop must be finished, every part settled, and what was wrong recorded. The customer then gets a link to rate the service.</p>
      </Drawer>

      <Drawer
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ticket #${tk.id}`}
        footer={<Button variant="primary" disabled={busy || cancelNote.trim().length < 3} onClick={async () => { if (await run(() => cancelTicket(tk.id, cancelNote.trim()), 'Ticket cancelled')) { setCancelOpen(false); setCancelNote(''); } }}>Cancel the ticket</Button>}
      >
        <p style={{ marginBottom: '8px' }}>Only when the ticket was raised by mistake or the customer withdrew it. Open parts must be settled first.</p>
        <Field label="Why" required><Textarea rows={3} value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} /></Field>
      </Drawer>
      <DamageReportDrawer
        open={Boolean(damageFor)}
        onClose={() => setDamageFor(null)}
        onDone={() => setDamageFor(null)}
        laptop={damageFor ? { asset_code: damageFor.ttspl_id || damageFor.unique_serial_number || damageFor.serial_number } : null}
        source={damageFor?.item_type === 'pickup' ? ((damageFor.pickup_type || (damageFor.source_item_id ? 'repair' : 'return')) === 'repair' ? 'repair_pickup' : 'return_pickup') : 'technician_visit'}
        ticketId={tk.id}
        ticketItemId={damageFor?.id}
        customerId={tk.customer_id}
      />
      <ConfirmDialog
        open={!!wfhFor}
        onClose={() => setWfhFor(null)}
        onConfirm={() => { if (wfhFor) run(() => chargeWfh(wfhFor.id), 'Charged — it shows under Delivery Charges'); }}
        title="Charge this work-from-home delivery Rs 799 + GST?"
        body="It goes on the Delivery Charges list."
        confirmLabel="Charge ₹799"
        tone="warn"
      />
    </DeskShell>
  );
}
