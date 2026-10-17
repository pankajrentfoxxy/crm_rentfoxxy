/**
 * What a field technician did in a date range (17 Oct 2026): support visits,
 * return and repair pickups, deliveries (DC, Service DC, replacement) and
 * vendor hand-overs — each with its day — plus the day's travel.
 * Used by "My report" (the technician) and the field dashboard (leads).
 */
const travel = require('./fieldTravelService');

const IST = `AT TIME ZONE 'Asia/Kolkata'`;
const KINDS = ['visit', 'return_pickup', 'repair_pickup', 'delivery', 'vendor'];

async function technicianIdOf(db, userId) {
  const r = await db.query('SELECT technician_id FROM delivery_technicians WHERE user_id = $1 LIMIT 1', [userId]).catch(() => ({ rows: [] }));
  return r.rows[0]?.technician_id || null;
}

/** Tasks for users (ids) between two IST dates, inclusive. */
async function tasksFor(db, { userIds, from, to }) {
  const techIds = (await db.query('SELECT technician_id, user_id FROM delivery_technicians WHERE user_id = ANY($1::int[])', [userIds]).catch(() => ({ rows: [] }))).rows;
  const techToUser = new Map(techIds.map((r) => [Number(r.technician_id), Number(r.user_id)]));
  const rows = [];
  // Support visits: the technician reached the customer.
  (await db.query(
    `SELECT i.id, i.ticket_id, i.assigned_to AS user_id, (i.visited_at ${IST})::date AS day, i.visited_at AS at,
            i.outcome, i.status, COALESCE(i.ttspl_id, i.unique_serial_number, i.serial_number) AS code, t.customer_name
       FROM support_ticket_items i JOIN support_tickets t ON t.id = i.ticket_id
      WHERE i.item_type = 'complaint' AND i.assigned_to = ANY($1::int[])
        AND (i.visited_at ${IST})::date BETWEEN $2 AND $3`,
    [userIds, from, to]
  )).rows.forEach((r) => rows.push({
    kind: 'visit', user_id: r.user_id, day: r.day, at: r.at, ref: `#${r.ticket_id}`, link: `/carret/serve/tickets/${r.ticket_id}`,
    code: r.code, customer: r.customer_name,
    result: ({ fixed: 'Fixed', working: 'No fault', replacement_required: 'Replacement asked', repair_pickup_requested: 'Repair pickup asked', repair_required: 'To repair pickup', return_required: 'To return pickup' })[r.outcome] || (['resolved', 'closed'].includes(r.status) ? 'Closed' : 'Visited'),
  }));
  // Support pickups: collected from the customer.
  (await db.query(
    `SELECT i.id, i.ticket_id, COALESCE(i.pickup_assigned_to, i.assigned_to) AS user_id, (COALESCE(i.customer_otp_verified_at, i.picked_up_at) ${IST})::date AS day,
            COALESCE(i.customer_otp_verified_at, i.picked_up_at) AS at, COALESCE(i.pickup_type, CASE WHEN i.source_item_id IS NOT NULL THEN 'repair' ELSE 'return' END) AS pickup_type,
            i.return_dc_number, COALESCE(i.ttspl_id, i.unique_serial_number, i.serial_number) AS code, t.customer_name
       FROM support_ticket_items i JOIN support_tickets t ON t.id = i.ticket_id
      WHERE i.item_type = 'pickup' AND COALESCE(i.pickup_assigned_to, i.assigned_to) = ANY($1::int[])
        AND (COALESCE(i.customer_otp_verified_at, i.picked_up_at) ${IST})::date BETWEEN $2 AND $3`,
    [userIds, from, to]
  )).rows.forEach((r) => rows.push({
    kind: r.pickup_type === 'repair' ? 'repair_pickup' : 'return_pickup', user_id: r.user_id, day: r.day, at: r.at,
    ref: r.return_dc_number || `#${r.ticket_id}`, link: r.return_dc_number ? `/carret/move/return-challans/${encodeURIComponent(r.return_dc_number)}` : `/carret/serve/tickets/${r.ticket_id}`,
    code: r.code, customer: r.customer_name, result: 'Collected',
  }));
  // Challans delivered / collected from My deliveries (one row per challan).
  (await db.query(
    `SELECT dc_number, MAX(COALESCE(customer_name, d_customer_name)) AS customer_name, MAX(movement_type) AS movement_type, MAX(dc_purpose) AS dc_purpose,
            MAX(delivered_at) AS at, (MAX(delivered_at) ${IST})::date AS day, MAX(delivered_by) AS delivered_by, MAX(delivery_person_id) AS delivery_person_id,
            SUM(COALESCE(quantity, 1))::int AS laptops
       FROM delivery_challan_lines
      WHERE delivered_at IS NOT NULL AND COALESCE(status, '') <> 'cancelled'
        AND (delivered_by = ANY($1::int[]) OR delivery_person_id = ANY($4::int[]))
        AND (delivered_at ${IST})::date BETWEEN $2 AND $3
        AND COALESCE(dc_purpose, '') NOT IN ('part_return', 'part_dc')
      GROUP BY dc_number`,
    [userIds, from, to, techIds.map((r) => r.technician_id)]
  )).rows.forEach((r) => {
    const userId = userIds.includes(Number(r.delivered_by)) ? Number(r.delivered_by) : techToUser.get(Number(r.delivery_person_id));
    if (!userId) return;
    const isReturn = r.movement_type === 'return';
    rows.push({
      kind: isReturn ? 'return_pickup' : 'delivery', user_id: userId, day: r.day, at: r.at, ref: r.dc_number,
      link: isReturn ? `/carret/move/return-challans/${encodeURIComponent(r.dc_number)}` : `/carret/move/challans/${encodeURIComponent(r.dc_number)}`,
      code: `${r.laptops} laptop${r.laptops > 1 ? 's' : ''}`, customer: r.customer_name,
      result: isReturn ? 'Collected' : ({ service_return: 'Service DC delivered', replacement: 'Replacement delivered' })[r.dc_purpose] || 'Delivered',
    });
  });
  // Vendor hand-overs (repair challans taken by hand).
  (await db.query(
    `SELECT dc_number, vendor_name, vendor_delivered_by AS user_id, vendor_delivered_at AS at, (vendor_delivered_at ${IST})::date AS day
       FROM vendor_repair_delivery_challans
      WHERE vendor_delivered_by = ANY($1::int[]) AND (vendor_delivered_at ${IST})::date BETWEEN $2 AND $3`,
    [userIds, from, to]
  ).catch(() => ({ rows: [] }))).rows.forEach((r) => rows.push({
    kind: 'vendor', user_id: r.user_id, day: r.day, at: r.at, ref: r.dc_number,
    link: `/carret/procure/repairs/${encodeURIComponent(r.dc_number)}`, code: null, customer: r.vendor_name, result: 'Handed to the vendor',
  }));
  return rows
    .map((r) => ({ ...r, day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10) }))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

function summarise(tasks, days) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, tasks.filter((t) => t.kind === k).length]));
  const byDay = {};
  for (const t of tasks) {
    byDay[t.day] = byDay[t.day] || { day: t.day, ...Object.fromEntries(KINDS.map((k) => [k, 0])), km: 0 };
    byDay[t.day][t.kind] += 1;
  }
  for (const d of days) {
    const key = d.day instanceof Date ? d.day.toISOString().slice(0, 10) : String(d.day).slice(0, 10);
    byDay[key] = byDay[key] || { day: key, ...Object.fromEntries(KINDS.map((k) => [k, 0])), km: 0 };
    byDay[key].km = Math.round((byDay[key].km + d.total_km) * 10) / 10;
  }
  return {
    counts,
    total: tasks.length,
    km: Math.round(days.reduce((s, d) => s + d.total_km, 0) * 10) / 10,
    days_worked: Object.keys(byDay).length,
    series: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

async function myReport(db, userId, { from, to }) {
  const tasks = await tasksFor(db, { userIds: [userId], from, to });
  const days = await travel.daysFor(db, { userIds: [userId], from, to });
  return { from, to, ...summarise(tasks, days), tasks, travel: days };
}

/** Leads: every field technician in the range — totals per person, and their days. */
async function teamReport(db, { from, to }) {
  const users = (await db.query(
    `SELECT DISTINCT u.user_id, u.name FROM users u
       LEFT JOIN delivery_technicians dt ON dt.user_id = u.user_id
      WHERE COALESCE(u.active, TRUE) AND COALESCE(u.status, 'active') = 'active' AND (u.role = ANY($1::text[]) OR dt.user_id IS NOT NULL)
      ORDER BY u.name`,
    [travel.FIELD_ROLES]
  ).catch(() => ({ rows: [] }))).rows;
  if (!users.length) return { from, to, technicians: [] };
  const ids = users.map((u) => Number(u.user_id));
  const tasks = await tasksFor(db, { userIds: ids, from, to });
  const days = await travel.daysFor(db, { userIds: ids, from, to });
  return {
    from,
    to,
    technicians: users.map((u) => {
      const mine = tasks.filter((t) => Number(t.user_id) === Number(u.user_id));
      const myDays = days.filter((d) => Number(d.user_id) === Number(u.user_id));
      return { user_id: u.user_id, name: u.name, ...summarise(mine, myDays), travel: myDays, tasks: mine.slice(0, 200) };
    }).filter((t) => t.total > 0 || t.travel.length > 0)
      .sort((a, b) => b.total - a.total || b.km - a.km),
  };
}

module.exports = { KINDS, technicianIdOf, tasksFor, myReport, teamReport };
