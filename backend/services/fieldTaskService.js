/**
 * A field technician's tasks, in order, one at a time (migration 439, 17 Oct 2026).
 *
 * Tasks: a support visit (item:<id>), a support pickup (rdc:<Return DC>), a
 * challan from My deliveries — delivery, Return DC or vendor hand-over
 * (dc:<number>).
 *
 *   pending  — not started
 *   active   — "reached" and not finished: the visit is not closed with the
 *              customer's OTP, the laptops are not collected (or the signed
 *              Return DC not mailed), the challan not delivered
 *   carrying — done at the customer; laptops are with the technician until
 *              the warehouse gate (not blocking)
 *
 * Rules (assertCanStart, checked by every "reached"):
 *   1 one task at a time — no other task starts while one is active;
 *   2 the lead's order — a task is started only when every task the lead put
 *     before it is done. Tasks the lead has not ordered come after the
 *     ordered ones; with no order set, any task may be next (still one at a time).
 * Leads acting for someone are not limited.
 */
const travel = require('./fieldTravelService');

const httpError = (message, status = 409, code = 'TASK_ORDER') => Object.assign(new Error(message), { status, code });
const KIND_LABEL = { visit: 'Visit', pickup: 'Pickup', delivery: 'Delivery', return: 'Return pickup', vendor: 'Vendor hand-over' };

async function supportTasks(userId) {
  const jobs = await require('./supportMyWorkService').loadJobs(userId);
  const out = [];
  const groups = new Map();
  for (const j of jobs) {
    if (j.kind === 'pickup' && j.return_dc_number) {
      if (!groups.has(j.return_dc_number)) groups.set(j.return_dc_number, []);
      groups.get(j.return_dc_number).push(j);
      continue;
    }
    const key = `item:${j.item_id}`;
    let state = j.next?.key === 'arrive' ? 'pending' : 'active';
    if (j.kind === 'pickup' && j.next?.key === 'drop') state = 'carrying';
    out.push({
      key, kind: j.kind === 'pickup' ? 'pickup' : 'visit', state,
      title: `${j.kind === 'pickup' ? 'Pickup' : 'Visit'} · ${j.laptop?.ttspl || j.laptop?.serial || `#${j.ticket_id}`}`,
      customer: j.customer, address: j.address, step: j.next?.label || null,
      link: `/carret/serve/job/${j.item_id}`, appointment: j.appointment, ticket_id: j.ticket_id,
    });
  }
  for (const [rdc, list] of groups) {
    const keys = list.map((j) => j.next?.key);
    const state = keys.every((k) => k === 'arrive') ? 'pending' : keys.every((k) => k === 'drop') ? 'carrying' : 'active';
    const j = list[0];
    out.push({
      key: `rdc:${rdc}`, kind: 'pickup', state,
      title: `Pickup · ${rdc} · ${list.length} laptop${list.length > 1 ? 's' : ''}`,
      customer: j.customer, address: j.address, step: (list.find((x) => x.next?.key !== 'drop') || j).next?.label || null,
      link: `/carret/serve/pickup/${encodeURIComponent(rdc)}`, appointment: j.pickup_scheduled_at || j.appointment, ticket_id: j.ticket_id,
    });
  }
  return out;
}

async function challanTasks(userId) {
  const { items } = await require('../controllers/deliveryFlowController').listFieldChallans(userId);
  return items.map((c) => {
    const isVendor = /^VR/i.test(String(c.dc_number || ''));
    const kind = isVendor ? 'vendor' : (c.movement_type === 'return' ? 'return' : 'delivery');
    const status = String(c.status || '').toLowerCase();
    const state = status === 'reached' ? 'active' : status === 'in_transit' ? 'pending' : 'carrying';
    return {
      key: `dc:${c.dc_number}`, kind, state,
      title: `${KIND_LABEL[kind]} · ${c.dc_number}`,
      customer: c.customer_name || c.vendor_name || null, address: c.address || c.customer_address || null,
      step: state === 'active' ? 'Finish with the OTP / signature' : state === 'pending' ? 'Go to the customer' : 'Bring the laptops back',
      link: '/carret/move/my-deliveries', appointment: null,
    };
  });
}

/** Every open task of a user, in the order to work them; current = the one to do now. */
async function listTasks(db, userId) {
  const tasks = [...await supportTasks(userId), ...await challanTasks(userId)];
  const order = (await db.query('SELECT task_key, seq FROM field_task_order WHERE user_id = $1', [userId])).rows;
  const seqOf = new Map(order.map((o) => [o.task_key, Number(o.seq)]));
  const ts = (t) => (t.appointment ? new Date(t.appointment).getTime() : Infinity);
  tasks.forEach((t) => { t.ordered = seqOf.has(t.key); t.seq = seqOf.get(t.key) ?? null; });
  const stateRank = { active: 0, pending: 1, carrying: 2 };
  tasks.sort((a, b) => {
    if (a.state === 'carrying' || b.state === 'carrying') return stateRank[a.state] - stateRank[b.state];
    if (a.ordered !== b.ordered) return a.ordered ? -1 : 1;
    if (a.ordered) return a.seq - b.seq;
    return ts(a) - ts(b);
  });
  const active = tasks.filter((t) => t.state === 'active');
  const open = tasks.filter((t) => t.state !== 'carrying');
  const current = active[0] || open[0] || null;
  return { tasks, current, active, has_order: order.length > 0 };
}

/** Refuses a "reached" that breaks one-at-a-time or the lead's order. */
async function assertCanStart(db, user, key) {
  if (!(await travel.isFieldUser(db, user))) return;
  const { tasks, active } = await listTasks(db, user.user_id);
  const other = active.find((t) => t.key !== key);
  if (other) {
    throw httpError(`Finish ${other.title}${other.customer ? ` (${other.customer})` : ''} first — close it with the customer's OTP. Only one task at a time.`, 409, 'TASK_ACTIVE');
  }
  const me = tasks.find((t) => t.key === key);
  if (!me || me.state !== 'pending') return;
  const ahead = tasks.filter((t) => t.state === 'pending' && t.key !== key && t.ordered && (!me.ordered || t.seq < me.seq));
  if (ahead.length) {
    throw httpError(`Your next task is ${ahead[0].title}${ahead[0].customer ? ` (${ahead[0].customer})` : ''} — your lead set the order. Ask them to change it if needed.`, 409, 'TASK_ORDER');
  }
}

/** Lead: the order for a technician (task keys, first to last). */
async function setOrder(db, { userId, keys, setBy }) {
  const clean = [...new Set((Array.isArray(keys) ? keys : []).map((k) => String(k || '').trim()).filter((k) => /^(item:\d+|rdc:[\w/-]+|dc:[\w/-]+)$/.test(k)))];
  await db.query('DELETE FROM field_task_order WHERE user_id = $1', [userId]);
  for (let i = 0; i < clean.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await db.query('INSERT INTO field_task_order (user_id, task_key, seq, set_by) VALUES ($1, $2, $3, $4)', [userId, clean[i], i + 1, setBy || null]);
  }
  return clean.length;
}

/**
 * Lead: put a task back to "not started" when a technician is stuck on it
 * (reached by mistake, customer not there). Nothing collected or delivered is undone.
 */
async function releaseTask(db, { userId, key }) {
  const [type, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (type === 'dc') {
    const r = await db.query(
      `UPDATE delivery_challan_lines SET status = 'in_transit', reached_at = NULL, updated_at = NOW()
        WHERE dc_number = $1 AND status = 'reached' AND delivered_at IS NULL`,
      [ref]
    );
    if (/^VRDC/i.test(ref)) {
      await db.query(`UPDATE vendor_repair_delivery_challans SET vendor_reached_at = NULL WHERE dc_number = $1 AND vendor_delivered_at IS NULL`, [ref]).catch(() => {});
    }
    return r.rowCount;
  }
  const where = type === 'rdc' ? 'return_dc_number = $1 AND item_type = \'pickup\'' : 'id = $1::int';
  const r = await db.query(
    `UPDATE support_ticket_items
        SET visited_at = NULL, status = CASE WHEN status = 'visited' THEN 'assigned' ELSE status END, updated_at = NOW()
      WHERE ${where} AND customer_otp_verified_at IS NULL AND picked_up_at IS NULL AND otp_verified_at IS NULL
        AND outcome IS NULL AND work_done_at IS NULL
        AND (assigned_to = $2 OR pickup_assigned_to = $2)`,
    [ref, userId]
  );
  return r.rowCount;
}

module.exports = { listTasks, assertCanStart, setOrder, releaseTask, KIND_LABEL };
