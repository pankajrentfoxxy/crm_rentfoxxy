/**
 * "Collect later" — the customer keeps one laptop of a multi-laptop pickup.
 *
 * Real case (29 Sep 2026): one ticket, three laptops on ONE Return DC with one
 * shared customer OTP. The technician collected two; the customer kept the
 * third until tomorrow. The guard and the warehouse work on the whole RDC, so
 * the two collected laptops could not be gated in or received (and kept
 * billing), and some paths booked the third as returned.
 *
 * The fix is to split: the uncollected laptop leaves the current RDC and goes
 * onto a NEW Return DC on the SAME ticket — same customer, addresses and
 * technician (or unassigned when the lead says so) — with its own customer
 * OTP. Each RDC then holds only laptops that travel together, so the
 * whole-RDC gate and warehouse receive stay correct.
 *
 * One transaction, rows locked: the item, the ticket, the RDC line(s). The
 * number comes from nextDocumentNumber('return_dc', client) inside it.
 */
const { secureOtp } = require('../utils/secureRandom');
const { nextDocumentNumber } = require('./salesManagementService');
const { resolveTechnicianId } = require('./dcAssignmentService');

const CLOSED_ITEM = new Set(['resolved', 'closed', 'inventory_updated', 'cancelled', 'removed', 'delivered', 'awaiting_service_return']);
const NOT_SPLITTABLE_ITEM = new Set([...CLOSED_ITEM, 'picked_up', 'in_transit']);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function laptopCode(item) {
  return item.ttspl_id || item.unique_serial_number || item.serial_number || `item #${item.id}`;
}

/** True once the customer handed the laptop over (or it is past the gate / received). */
function isCollected(item) {
  return Boolean(
    item.customer_otp_verified_at || item.picked_up_at || item.gate_inward_at || item.warehouse_received_at
  );
}

function parseEntries(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = [v]; }
  }
  return Array.isArray(v) ? v.filter(Boolean).map(String) : [];
}

/** Does "serial_id|serial|ttspl" belong to this pickup item? */
function entryMatchesItem(entry, item) {
  const parts = String(entry).split('|').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const codes = [item.ttspl_id, item.unique_serial_number, item.serial_number]
    .filter(Boolean).map((c) => String(c).trim().toLowerCase());
  // The serial_id part alone is a number that could collide with nothing
  // meaningful here, so only the serial / TTSPL parts count.
  const textual = parts.length >= 3 ? parts.slice(1) : parts;
  return textual.some((p) => codes.includes(p));
}

async function entryForItem(client, item) {
  const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
  const r = await client.query(
    `SELECT serial_id, serial_number, inventory_asset_code
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
      LIMIT 1`,
    [code]
  );
  const v = r.rows[0];
  return v ? `${v.serial_id}|${v.serial_number}|${v.inventory_asset_code || code}` : `|${code}|${code}`;
}

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // A plain date is a day in IST; morning 10:00 is when a visit slot starts.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T10:00:00+05:30`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param client  open transaction (caller BEGIN/COMMIT)
 * @param opts.itemId          the pickup item the customer kept
 * @param opts.reason          why (required)
 * @param opts.pickupDate      new pickup date (required, today or later)
 * @param opts.actor           { user_id, name }
 * @param opts.asLead          the support lead may pick another technician or leave it unassigned
 * @param opts.technicianUserId  lead only: who collects it (defaults to the current technician)
 * @param opts.unassigned        lead only: raise the new RDC without a technician
 */
async function collectLater(client, opts) {
  const {
    itemId, reason: reasonRaw, pickupDate: dateRaw, actor = {}, asLead = false,
    technicianUserId = null, unassigned = false,
  } = opts;
  const reason = String(reasonRaw || '').trim();
  if (reason.length < 3) throw fail('Write why the customer kept the laptop');
  const pickupDate = parseDate(dateRaw);
  if (!pickupDate) throw fail('Choose the new pickup date');
  const todayIst = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const dayIst = new Date(pickupDate.getTime() + 330 * 60000).toISOString().slice(0, 10);
  if (dayIst < todayIst) throw fail('The new pickup date cannot be in the past');

  const itemRes = await client.query('SELECT * FROM support_ticket_items WHERE id = $1 FOR UPDATE', [itemId]);
  const item = itemRes.rows[0];
  if (!item) throw fail('Laptop not found on any ticket', 404);
  if (item.item_type !== 'pickup') throw fail('Collect later is only for a pickup laptop');

  const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [item.ticket_id]);
  const ticket = ticketRes.rows[0];
  if (!ticket) throw fail('Ticket not found', 404);
  if (['closed', 'cancelled'].includes(String(ticket.status || ''))) throw fail(`Ticket #${ticket.id} is ${ticket.status}`);

  const code = laptopCode(item);
  if (isCollected(item) || NOT_SPLITTABLE_ITEM.has(String(item.status || ''))) {
    throw fail(`${code} is already collected (or past the gate) — it cannot be moved to a later pickup`, 409);
  }
  const oldRdc = String(item.return_dc_number || '').trim();
  if (!oldRdc) throw fail(`${code} is not on a Return DC yet — schedule the pickup instead`);

  const linesRes = await client.query(
    `SELECT * FROM delivery_challan_lines
      WHERE dc_number = $1 AND movement_type = 'return'
      ORDER BY id ASC
      FOR UPDATE`,
    [oldRdc]
  );
  if (!linesRes.rows.length) throw fail(`Return DC ${oldRdc} not found`, 404);
  const head = linesRes.rows[0];
  const dcStatus = String(head.status || '').toLowerCase();
  if (['cancelled', 'delivered'].includes(dcStatus)) {
    throw fail(`Return DC ${oldRdc} is ${dcStatus === 'delivered' ? 'already received' : 'cancelled'}`, 409);
  }
  if (String(head.dc_purpose || '') === 'replacement') {
    // A replacement order is tied to its Return DC; splitting it would leave
    // the order waiting on a laptop that is no longer on its challan.
    throw fail('This Return DC belongs to a replacement — change it from the replacement instead', 409);
  }

  const siblingsRes = await client.query(
    `SELECT * FROM support_ticket_items
      WHERE return_dc_number = $1 AND item_type = 'pickup' AND id <> $2
        AND COALESCE(status, '') NOT IN ('cancelled', 'removed')
      ORDER BY id ASC
      FOR UPDATE`,
    [oldRdc, item.id]
  );
  const staying = siblingsRes.rows;
  if (!staying.length) {
    throw fail(`${code} is the only laptop left on ${oldRdc} — reschedule the pickup (visit slot) instead`, 409);
  }

  // Who collects it on the new RDC.
  let techUserId = item.pickup_assigned_to || item.assigned_to || null;
  const courierLike = ['courier', 'porter'].includes(String(item.pickup_method || '').toLowerCase());
  if (courierLike) techUserId = null;
  if (asLead) {
    if (unassigned) techUserId = null;
    else if (technicianUserId) {
      const tid = parseInt(technicianUserId, 10);
      const u = await client.query(
        `SELECT user_id FROM users WHERE user_id = $1 AND COALESCE(active, TRUE) = TRUE`,
        [tid]
      );
      if (!u.rows.length) throw fail('That technician was not found');
      techUserId = tid;
    }
  }
  const deliveryPersonId = techUserId
    ? (Number(techUserId) === Number(item.pickup_assigned_to || item.assigned_to) && head.delivery_person_id
      ? head.delivery_person_id
      : await resolveTechnicianId(client, techUserId))
    : null;

  // 1) Take the laptop's entry off the old RDC line.
  let movedEntry = null;
  let lineForEntry = null;
  for (const line of linesRes.rows) {
    const entries = parseEntries(line.serial_number);
    const idx = entries.findIndex((e) => entryMatchesItem(e, item));
    if (idx >= 0) {
      movedEntry = entries[idx];
      entries.splice(idx, 1);
      lineForEntry = { line, entries };
      break;
    }
  }
  if (lineForEntry) {
    await client.query(
      `UPDATE delivery_challan_lines
          SET serial_number = $2::jsonb, quantity = $3, updated_at = NOW()
        WHERE id = $1`,
      [lineForEntry.line.id, JSON.stringify(lineForEntry.entries), Math.max(1, lineForEntry.entries.length)]
    );
  } else {
    // The line never listed this laptop by code (legacy row): rebuild the
    // list from the laptops that stay.
    const rebuilt = [];
    for (const s of staying) rebuilt.push(await entryForItem(client, s));
    await client.query(
      `UPDATE delivery_challan_lines
          SET serial_number = $2::jsonb, quantity = $3, updated_at = NOW()
        WHERE id = $1`,
      [head.id, JSON.stringify(rebuilt), Math.max(1, rebuilt.length)]
    );
  }
  if (!movedEntry) movedEntry = await entryForItem(client, item);

  // 2) The new Return DC — same ticket, customer, address, deal; one laptop.
  const newRdc = await nextDocumentNumber('return_dc', client);
  const dispatched = Boolean(techUserId);
  const remarks = `Collect later from ${oldRdc}: ${reason}`;
  await client.query(
    `INSERT INTO delivery_challan_lines
        (dc_number, movement_type, support_ticket_id, customer_id, customer_name, email,
         customer_shipping_address, brand, model_name, quantity, serial_number,
         dispatch_mode, ship_by, delivery_person_id,
         sales_order_number, original_dc_number, dc_purpose, remarks,
         status, dispatched_at, created_by, created_at, updated_at, entity_code, hsn_code)
     SELECT $1, 'return', support_ticket_id, customer_id, customer_name, email,
            customer_shipping_address, COALESCE($2, brand), COALESCE($3, model_name), 1, $4::jsonb,
            CASE WHEN $5 THEN 'inhouse' ELSE NULL END,
            CASE WHEN $5 THEN 'by_hand' ELSE NULL END,
            $6,
            sales_order_number, original_dc_number, COALESCE(dc_purpose, 'standard'), $7,
            CASE WHEN $5 THEN 'in_transit' ELSE 'pending' END,
            CASE WHEN $5 THEN NOW() ELSE NULL END,
            $8, NOW(), NOW(), entity_code, hsn_code
       FROM delivery_challan_lines WHERE id = $9`,
    [
      newRdc, item.brand || null, item.model || null, JSON.stringify([movedEntry]),
      dispatched, deliveryPersonId, remarks, actor.user_id || null, head.id,
    ]
  );
  // The new RDC belongs to the ticket even when the old line predates support_ticket_id.
  await client.query(
    `UPDATE delivery_challan_lines SET support_ticket_id = COALESCE(support_ticket_id, $2)
      WHERE dc_number = $1 AND movement_type = 'return'`,
    [newRdc, ticket.id]
  );

  // 3) The laptop moves with a fresh customer OTP (the old one stays with the
  //    two that were collected). Today's visit / photo / signature were for the
  //    old challan; the audit row below keeps them.
  const otp = secureOtp();
  await client.query(
    `UPDATE support_ticket_items SET
        return_dc_number = $2,
        otp_code = $3,
        customer_otp_code = $3,
        customer_otp_sent_at = NOW(),
        customer_otp_verified_at = NULL,
        status = CASE WHEN $4::int IS NULL THEN 'pending_dispatch' ELSE 'assigned' END,
        assigned_to = $4,
        pickup_assigned_to = $4,
        pickup_method = CASE WHEN $4::int IS NULL THEN NULL ELSE 'technician' END,
        pickup_courier_name = NULL,
        pickup_awb = NULL,
        porter_tracking_id = NULL,
        porter_order_id = NULL,
        visited_at = NULL,
        pod_image_path = NULL,
        proof_of_completion_path = NULL,
        technician_esign_url = NULL,
        technician_esign_at = NULL,
        technician_esign_by = NULL,
        technician_esign_name = NULL,
        pickup_scheduled_at = $5,
        visit_scheduled_at = $5,
        updated_at = NOW()
      WHERE id = $1`,
    [item.id, newRdc, otp, techUserId, pickupDate]
  );

  await client.query(
    `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
     VALUES ($1, $2, $3, 'pickup_collect_later', $4::jsonb)`,
    [
      item.id, ticket.id, actor.user_id || null,
      JSON.stringify({
        summary: `Customer kept it — collect later: ${reason}, ${dayIst}`,
        reason,
        new_pickup_date: dayIst,
        from_return_dc_number: oldRdc,
        return_dc_number: newRdc,
        ttspl_id: item.ttspl_id || item.unique_serial_number || null,
        previous_status: item.status,
        previous_assigned_to: item.pickup_assigned_to || item.assigned_to || null,
        new_assigned_to: techUserId,
        previous_visited_at: item.visited_at || null,
        previous_pod: item.pod_image_path || item.proof_of_completion_path || null,
        previous_technician_esign_url: item.technician_esign_url || null,
        by_lead: Boolean(asLead),
      }),
    ]
  );
  await client.query(
    `UPDATE support_tickets SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [ticket.id]
  );

  return {
    ticket_id: ticket.id,
    item_id: item.id,
    ttspl_id: item.ttspl_id || item.unique_serial_number || null,
    from_return_dc_number: oldRdc,
    return_dc_number: newRdc,
    staying_count: staying.length,
    technician_user_id: techUserId,
    pickup_date: dayIst,
    customer_otp: otp,
  };
}

module.exports = { collectLater, isCollected, entryMatchesItem, parseEntries };
