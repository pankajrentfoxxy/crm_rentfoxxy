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
 *   waiting  — a visit waiting for its part (not blocking); once the part is
 *              with the technician it is pending again (they go back)
 *
 * Rules (assertCanStart, checked by every "reached"):
 *   1 one task at a time — no other task starts while one is active;
 *   2 the lead's order — a task is started only when every task the lead put
 *     before it is done. Tasks the lead has not ordered come after the
 *     ordered ones; with no order set, any task may be next (still one at a time);
 *   3 the day — only today's tasks start (migration 440); tomorrow's and later
 *     are shown to the technician, not opened.
 * Leads acting for someone are not limited.
 */
const travel = require('./fieldTravelService');

const httpError = (message, status = 409, code = 'TASK_ORDER') => Object.assign(new Error(message), { status, code });
const KIND_LABEL = { visit: 'Visit', pickup: 'Pickup', delivery: 'Delivery', return: 'Return pickup', vendor: 'Vendor hand-over' };

const IST = 330 * 60000;
const istDate = (ts) => (ts ? new Date(new Date(ts).getTime() + IST).toISOString().slice(0, 10) : null);
const addDays = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const ymdOf = (v) => (v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));

async function supportTasks(userId) {
  const jobs = await require('./supportMyWorkService').loadJobs(userId);
  const out = [];
  const groups = new Map();
  const base = (j) => ({
    customer: j.customer, address: j.address, phone: j.phone || null, ticket_id: j.ticket_id,
    priority: j.priority || 'normal', sla: j.sla?.state || null, sla_due_at: j.sla?.due_at || null,
  });
  for (const j of jobs) {
    if (j.kind === 'pickup' && j.return_dc_number) {
      if (!groups.has(j.return_dc_number)) groups.set(j.return_dc_number, []);
      groups.get(j.return_dc_number).push(j);
      continue;
    }
    const key = `item:${j.item_id}`;
    // Not reached (or back for the part) = not started; reached = in progress,
    // "scan the laptop" included; a visit waiting for its part holds nothing up.
    let state = j.needs_arrive || (j.next?.key === 'arrive' && !j.visited_at) ? 'pending' : 'active';
    if (j.next?.key === 'waiting') state = 'waiting';
    if (j.kind === 'pickup' && j.next?.key === 'drop') state = 'carrying';
    out.push({
      key, kind: j.kind === 'pickup' ? 'pickup' : 'visit', state, ...base(j),
      title: `${j.kind === 'pickup' ? 'Pickup' : (j.moved ? `Visit place ${j.place_no}` : j.revisit ? 'Revisit' : 'Visit')} · ${j.laptop?.ttspl || j.laptop?.serial || `#${j.ticket_id}`}`,
      step: j.next?.label || null,
      laptops: [[j.laptop?.ttspl || j.laptop?.serial, [j.laptop?.brand, j.laptop?.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')],
      issue: j.issue || null, remarks: j.remarks || null,
      link: `/carret/serve/job/${j.item_id}`, appointment: j.appointment,
    });
  }
  for (const [rdc, list] of groups) {
    const keys = list.map((j) => j.next?.key);
    const state = keys.every((k) => k === 'arrive') ? 'pending' : keys.every((k) => k === 'drop') ? 'carrying' : 'active';
    const j = list[0];
    out.push({
      key: `rdc:${rdc}`, kind: 'pickup', state, ...base(j),
      title: `${j.pickup_type === 'repair' ? 'Repair pickup' : 'Pickup'} · ${rdc} · ${list.length} laptop${list.length > 1 ? 's' : ''}`,
      step: (list.find((x) => x.next?.key !== 'drop') || j).next?.label || null,
      laptops: list.map((x) => [x.laptop?.ttspl || x.laptop?.serial, [x.laptop?.brand, x.laptop?.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')),
      issue: null, remarks: j.remarks || null,
      link: `/carret/serve/pickup/${encodeURIComponent(rdc)}`, appointment: j.pickup_scheduled_at || j.appointment,
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
      phone: c.customer_phone || c.phone || null, ticket_id: null, priority: 'normal', sla: null, sla_due_at: null,
      laptops: [], issue: null, remarks: null,
      step: state === 'active' ? 'Finish with the OTP / signature' : state === 'pending' ? 'Go to the customer' : 'Bring the laptops back',
      link: '/carret/move/my-deliveries', appointment: null,
    };
  });
}

/**
 * Every open task of a user, in the order to work them; current = the one to do now.
 *
 * Each task has a day (migration 440): the lead's planned day, else the
 * customer's slot day, else today; an earlier day counts as today (overdue).
 * bucket: today | tomorrow | later. Within a day: the lead's order, then time.
 */
async function listTasks(db, userId) {
  const tasks = [...await supportTasks(userId), ...await challanTasks(userId)];
  const order = (await db.query('SELECT task_key, seq, planned_date, planned_time FROM field_task_order WHERE user_id = $1', [userId])).rows;
  const plan = new Map(order.map((o) => [o.task_key, o]));
  const today = travel.todayIst();
  const tomorrow = addDays(today, 1);
  for (const t of tasks) {
    const o = plan.get(t.key);
    t.ordered = Boolean(o);
    t.seq = o ? Number(o.seq) : null;
    t.planned_date = o?.planned_date ? ymdOf(o.planned_date) : null;
    t.planned_time = o?.planned_time ? String(o.planned_time).slice(0, 5) : null;
    const d = t.planned_date || istDate(t.appointment) || today;
    t.overdue = d < today && t.state !== 'carrying';
    // In progress / being carried is always today's.
    t.date = ['active', 'carrying'].includes(t.state) || d < today ? today : d;
    t.bucket = t.date === today ? 'today' : t.date === tomorrow ? 'tomorrow' : 'later';
    t.time = t.planned_time || (t.appointment && istDate(t.appointment) === t.date
      ? new Date(new Date(t.appointment).getTime() + IST).toISOString().slice(11, 16) : null);
  }
  const stateRank = { active: 0, pending: 1, waiting: 2, carrying: 3 };
  tasks.sort((a, b) => {
    const sa = stateRank[a.state] ?? 1; const sb = stateRank[b.state] ?? 1;
    if (a.state === 'carrying' || b.state === 'carrying' || a.state === 'waiting' || b.state === 'waiting') {
      if (sa !== sb) return sa - sb;
    }
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.state === 'active' && b.state !== 'active') return -1;
    if (b.state === 'active' && a.state !== 'active') return 1;
    if (a.ordered !== b.ordered) return a.ordered ? -1 : 1;
    if (a.ordered && a.seq !== b.seq) return a.seq - b.seq;
    return String(a.time || '99:99').localeCompare(String(b.time || '99:99'));
  });
  const active = tasks.filter((t) => t.state === 'active');
  const open = tasks.filter((t) => t.state === 'pending' && t.bucket === 'today');
  const current = active[0] || open[0] || null;
  return { tasks, current, active, today, tomorrow, has_order: order.length > 0 };
}

/** Refuses a "reached" that breaks one-at-a-time, the lead's order, or the planned day. */
async function assertCanStart(db, user, key) {
  if (!(await travel.isFieldUser(db, user))) return;
  const { tasks, active } = await listTasks(db, user.user_id);
  const other = active.find((t) => t.key !== key);
  if (other) {
    throw httpError(`Finish ${other.title}${other.customer ? ` (${other.customer})` : ''} first — close it with the customer's OTP. Only one task at a time.`, 409, 'TASK_ACTIVE');
  }
  const me = tasks.find((t) => t.key === key);
  if (!me || me.state !== 'pending') return;
  if (me.bucket !== 'today') {
    const day = new Date(`${me.date}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
    throw httpError(`This task is planned for ${day} — only today's tasks can be started. Your lead can move it to today.`, 409, 'TASK_NOT_TODAY');
  }
  const ahead = tasks.filter((t) => t.state === 'pending' && t.bucket === 'today' && t.key !== key && t.ordered && (!me.ordered || t.seq < me.seq));
  if (ahead.length) {
    throw httpError(`Your next task is ${ahead[0].title}${ahead[0].customer ? ` (${ahead[0].customer})` : ''} — your lead set the order. Ask them to change it if needed.`, 409, 'TASK_ORDER');
  }
}

const KEY_RE = /^(item:\d+|rdc:[\w/-]+|dc:[\w/-]+)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Lead: the whole plan for a technician — tasks first to last, each with an
 * optional day and time (migration 440). Replaces what was there.
 */
async function savePlan(db, { userId, items, setBy }) {
  const seen = new Set();
  const clean = [];
  for (const it of Array.isArray(items) ? items : []) {
    const key = String((typeof it === 'string' ? it : it?.key) || '').trim();
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    const date = DATE_RE.test(String(it?.date || '')) ? String(it.date) : null;
    const time = TIME_RE.test(String(it?.time || '')) ? String(it.time) : null;
    clean.push({ key, date, time });
  }
  await db.query('DELETE FROM field_task_order WHERE user_id = $1', [userId]);
  for (let i = 0; i < clean.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      'INSERT INTO field_task_order (user_id, task_key, seq, set_by, planned_date, planned_time) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, clean[i].key, i + 1, setBy || null, clean[i].date, clean[i].time]
    );
  }
  return clean.length;
}

/** Lead: the order only (keys first to last); planned days and times are kept. */
async function setOrder(db, { userId, keys, setBy }) {
  const old = new Map((await db.query('SELECT task_key, planned_date, planned_time FROM field_task_order WHERE user_id = $1', [userId])).rows.map((r) => [r.task_key, r]));
  const items = (Array.isArray(keys) ? keys : []).map((k) => {
    const o = old.get(String(k));
    return { key: String(k), date: o?.planned_date ? ymdOf(o.planned_date) : null, time: o?.planned_time ? String(o.planned_time).slice(0, 5) : null };
  });
  return savePlan(db, { userId, items, setBy });
}

/**
 * Lead: plan one task (just assigned, or moved up) — on a day, at a time, and
 * either next (straight after what is in progress) or at the end of that day.
 */
async function planTask(db, { userId, key, date, time, position = 'end', setBy }) {
  if (!KEY_RE.test(String(key || ''))) throw httpError('Unknown task', 400, 'BAD_TASK');
  const { tasks, today } = await listTasks(db, userId);
  const day = DATE_RE.test(String(date || '')) ? String(date) : today;
  const rest = tasks.filter((t) => t.state !== 'carrying' && t.key !== key);
  const items = rest.map((t) => ({ key: t.key, date: t.planned_date, time: t.planned_time, eff: t.date, active: t.state === 'active' }));
  const mine = { key, date: day, time: TIME_RE.test(String(time || '')) ? String(time) : null, eff: day };
  let at;
  if (position === 'next') {
    // After whatever is in progress, ahead of the rest of that day.
    at = items.findIndex((t) => !t.active && t.eff >= day);
  } else {
    at = items.findIndex((t) => t.eff > day);
  }
  if (at < 0) at = items.length;
  items.splice(at, 0, mine);
  return savePlan(db, { userId, items, setBy });
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

module.exports = { listTasks, assertCanStart, setOrder, savePlan, planTask, releaseTask, KIND_LABEL };
