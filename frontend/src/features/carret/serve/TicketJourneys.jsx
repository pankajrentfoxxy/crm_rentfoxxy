import React, { useMemo, useState } from 'react';
import { Button, DocNumber, Drawer, FlowSteps, StatusChip } from '../../../components/carret';
import ItemComments from './ItemComments';
import { STEP_LABEL, when } from './serveShared';

/**
 * Serve → ticket → one card per laptop (16 Oct 2026).
 *
 * A laptop's visit, its pickup and its replacement used to be separate rows
 * (a visit that ended in "replacement" showed next to the pickup it caused, so
 * the same laptop appeared twice). Now each laptop is one card: the steps of
 * its whole journey, the one task that is open now with its buttons, and a
 * comment button with the thread.
 */
const ITEM_DONE = ['resolved', 'closed', 'inventory_updated', 'delivered', 'cancelled', 'removed', 'swap_initiated'];
const REP_DONE = ['delivered', 'inventory_updated', 'resolved', 'closed'];
const codeOf = (i) => i.ttspl_id || i.unique_serial_number || i.serial_number || '';
// Sold laptops: warranty as it was when the ticket was raised (claude/carret-lockin-warranty.md).
const WARRANTY_NOTE = { in: 'sold, in warranty', battery_only: 'sold, battery warranty only', out: 'sold, OUT of warranty — chargeable' };
const isRepair = (p) => (p.pickup_type || (p.source_item_id ? 'repair' : 'return')) === 'repair';

export const TYPE_LABEL = (i) => ({
  complaint: 'Visit',
  pickup: isRepair(i) ? 'Repair pickup' : 'Return pickup',
  replacement: 'Replacement',
}[i.item_type] || i.item_type);

const stepText = (i) => STEP_LABEL[i.effective_current_step] || STEP_LABEL[i.current_step] || STEP_LABEL[i.status] || String(i.status || '').replace(/_/g, ' ');

/** Group the ticket's items into one journey per laptop. */
export function buildJourneys(items) {
  const byId = new Map(items.map((i) => [Number(i.id), i]));
  const rootOf = (i) => {
    let cur = i;
    for (let n = 0; n < 10 && cur.source_item_id && byId.has(Number(cur.source_item_id)); n += 1) cur = byId.get(Number(cur.source_item_id));
    return cur;
  };
  const groups = new Map();
  for (const i of items) {
    const r = rootOf(i);
    if (!groups.has(r.id)) groups.set(r.id, { root: r, items: [] });
    groups.get(r.id).items.push(i);
  }
  // The same laptop on two unlinked items (e.g. a return pickup made by hand) is one journey.
  const merged = [];
  for (const g of groups.values()) {
    const c = codeOf(g.root).toUpperCase();
    const same = c && merged.find((m) => codeOf(m.root).toUpperCase() === c);
    if (same) same.items.push(...g.items); else merged.push(g);
  }
  return merged.map((g) => {
    const list = [...g.items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const live = list.filter((i) => i.status !== 'cancelled');
    return {
      key: g.root.id,
      root: g.root,
      items: list,
      code: codeOf(g.root) || list.map(codeOf).find(Boolean) || `#${g.root.id}`,
      model: [g.root.brand, g.root.model].filter(Boolean).join(' '),
      cancelled: live.length === 0,
      complaint: live.find((i) => i.item_type === 'complaint') || (live.length ? null : list.find((i) => i.item_type === 'complaint')) || null,
      repair: live.find((i) => i.item_type === 'pickup' && isRepair(i)) || null,
      ret: live.find((i) => i.item_type === 'pickup' && !isRepair(i)) || null,
      rep: live.find((i) => i.item_type === 'replacement') || null,
      comments: list.flatMap((i) => (i.comments || []).map((c) => ({ ...c, _item: i }))),
    };
  });
}

/** The journey's steps, in the order they happen. */
function stepsOf(j) {
  const s = [];
  const add = (key, label, done, sub) => s.push({ key, label, done: Boolean(done), sub });
  const c = j.complaint;
  if (c) {
    add('visit', 'Visit', c.visited_at || c.outcome || ITEM_DONE.includes(c.status) || j.repair || j.rep || j.ret,
      c.visited_at ? when(c.visited_at) : (c.visit_scheduled_at ? `slot ${when(c.visit_scheduled_at)}` : null));
  }
  if (j.rep) {
    add('rep', 'Replacement delivered', REP_DONE.includes(j.rep.status), j.rep.status === 'order_placed' ? 'to send' : null);
    // The old laptop comes back on a return pickup — or is already in for repair (swap from repair).
    const old = j.ret || j.repair;
    add('old', 'Old laptop back', old ? (old.warehouse_received_at || ITEM_DONE.includes(old.status)) : false, old?.return_dc_number || 'pickup not made');
  } else if (j.repair) {
    const p = j.repair;
    add('col', 'Collected', p.picked_up_at || p.customer_otp_verified_at || p.gate_inward_at || p.warehouse_received_at || ITEM_DONE.includes(p.status), p.return_dc_number);
    add('fix', 'Repaired', p.repair_ready_at || p.service_dc_number || ITEM_DONE.includes(p.status));
    add('back', 'Back with customer', ITEM_DONE.includes(p.status) || p.service_dc_delivered_at, p.service_dc_number);
  } else if (j.ret) {
    const p = j.ret;
    add('col', 'Collected', p.picked_up_at || p.customer_otp_verified_at || p.gate_inward_at || p.warehouse_received_at || ITEM_DONE.includes(p.status), p.return_dc_number);
    add('wh', 'At the warehouse', p.warehouse_received_at || ITEM_DONE.includes(p.status));
  }
  add('done', 'Done', openTasks(j).length === 0);
  let seenCurrent = false;
  return s.map((x) => {
    if (j.cancelled) return { ...x, state: 'blocked' };
    if (x.done) return { ...x, state: 'done' };
    if (!seenCurrent) { seenCurrent = true; return { ...x, state: 'current' }; }
    return { ...x, state: 'todo' };
  });
}

/** Items still being worked on (a visit that turned into a pickup / replacement is finished). */
function openTasks(j) {
  return j.items.filter((i) => {
    if (ITEM_DONE.includes(i.status)) return false;
    if (i.item_type === 'complaint' && (j.repair || j.rep || j.ret)) return false;
    return true;
  });
}

function Task({ i, tech, wfh, locked, actions, note }) {
  return (
    <div className="c-jtask" id={`task-${i.id}`}>
      <div className="min-w-0">
        <div className="c-jtask-t">{TYPE_LABEL(i)}<span>{stepText(i)}</span></div>
        <div className="c-jtask-s">
          {[
            tech ? tech.name : (i.item_type === 'replacement' ? null : 'No technician yet'),
            i.visit_scheduled_at ? `🗓 ${when(i.visit_scheduled_at)}` : null,
            i.return_dc_number || null,
            i.service_dc_number || null,
            wfh?.is_wfh ? (wfh.charged ? `WFH charged ₹${Number(wfh.amount).toLocaleString('en-IN')}` : 'Work from home') : null,
          ].filter(Boolean).join(' · ')}
        </div>
        {note && <div className="c-jtask-n">{note}</div>}
      </div>
      {!locked && <div className="c-jtask-a">{actions}</div>}
    </div>
  );
}

export default function TicketJourneys({ items, techs, wfh, locked, canDamage, onAssign, onSlot, onWfh, onDamage, onCommented, taskActions }) {
  const journeys = useMemo(() => buildJourneys(items), [items]);
  const [threadFor, setThreadFor] = useState(null);
  const thread = journeys.find((j) => j.key === threadFor) || null;
  const techOf = (i) => techs.find((x) => x.user_id === (i.assigned_to || i.pickup_assigned_to));

  return (
    <>
      <div className="c-stack">
        {journeys.map((j) => {
          const tasks = openTasks(j);
          const steps = stepsOf(j);
          const now = tasks[0];
          const c = j.complaint || j.root;
          return (
            <section key={j.key} className={`c-journey${j.cancelled ? ' is-off' : ''}`} aria-label={`Laptop ${j.code}`}>
              <header className="c-journey-h">
                <div className="min-w-0">
                  <div className="c-journey-code"><DocNumber value={j.code} /></div>
                  <div className="c-journey-m">{[j.model, WARRANTY_NOTE[c.warranty_status], c.issue_category_label].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="c-journey-r">
                  {j.cancelled ? <StatusChip status="cancelled" />
                    : now ? <StatusChip status="processing" label={stepText(now)} />
                      : <StatusChip status="delivered" label="Done" />}
                  <button type="button" className="c-cmt-btn" onClick={() => setThreadFor(j.key)} aria-label={`Comments on ${j.code}`}>
                    <span aria-hidden="true">💬</span>{j.comments.length > 0 && <b>{j.comments.length}</b>}
                  </button>
                </div>
              </header>
              {c.remarks && <p className="c-journey-note">“{c.remarks}”</p>}
              <FlowSteps steps={steps} className="c-flow-sm" />
              {tasks.length > 0 && (
                <div className="c-journey-tasks">
                  {tasks.map((i) => {
                    // Pickup / replacement / Service DC buttons come from TicketActions.
                    const extra = taskActions?.(i) || null;
                    // A slot is for a visit / collection still to happen.
                    const slotOk = i.item_type !== 'replacement'
                      && !(i.visited_at || i.picked_up_at || i.customer_otp_verified_at || i.gate_inward_at || i.warehouse_received_at);
                    const own = extra?.replaceDefault ? null : (
                      <>
                        {i.item_type !== 'replacement' && <Button onClick={() => onAssign(i)}>{i.assigned_to || i.pickup_assigned_to ? 'Reassign' : 'Assign'}</Button>}
                        {slotOk && <Button variant="quiet" onClick={() => onSlot(i)}>{i.visit_scheduled_at ? 'Change slot' : 'Set slot'}</Button>}
                      </>
                    );
                    return (
                      <Task
                        key={i.id}
                        i={i}
                        tech={techOf(i)}
                        wfh={wfh[i.id]}
                        locked={locked}
                        note={extra?.note}
                        actions={(
                          <>
                            {extra?.buttons}
                            {own}
                            {slotOk && i.item_type === 'pickup' && extra?.replaceDefault && <Button variant="quiet" onClick={() => onSlot(i)}>{i.visit_scheduled_at ? 'Change slot' : 'Set slot'}</Button>}
                            {wfh[i.id]?.is_wfh && !wfh[i.id]?.charged && (i.item_type === 'replacement' || (i.item_type === 'pickup' && i.return_dc_number)) && (
                              <Button variant="quiet" onClick={() => onWfh(i)}>Charge WFH ₹799</Button>
                            )}
                          </>
                        )}
                      />
                    );
                  })}
                </div>
              )}
              {!locked && !j.cancelled && canDamage && j.code && !j.code.startsWith('#') && (
                <div className="c-journey-f">
                  <Button variant="quiet" onClick={() => onDamage(now || j.ret || j.repair || c)}>Record damage</Button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Drawer open={Boolean(thread)} onClose={() => setThreadFor(null)} title={`Comments · ${thread?.code || ''}`}>
        {thread && (() => {
          // One thread per laptop; a new comment goes on the task open now.
          const target = openTasks(thread)[0] || thread.items[thread.items.length - 1];
          const merged = { ...target, comments: [...thread.comments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) };
          return <ItemComments item={merged} canWrite={!locked && !thread.cancelled} onAdded={onCommented} />;
        })()}
      </Drawer>
    </>
  );
}
