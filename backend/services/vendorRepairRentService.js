/**
 * Vendor repair challan — rent pause, vendor mails, replacement check and
 * approval, "vendor keeps it" (claude/carret-vendor-repair.md).
 *
 *   Mail the vendor      → rent paused from the chosen stop date for every laptop
 *                          rented FROM THIS VENDOR (a laptop rented from vendor A
 *                          repaired by vendor B keeps paying A).
 *   Repaired, back       → rent resumes on the guard gate-in date.
 *   Replacement          → same model + config: accepted; otherwise Accounts /
 *                          the named approver decides. Accepted: original's rent
 *                          ends the day before the pause, the replacement bills
 *                          from its gate-in date at the original's rate.
 *   Vendor keeps it      → confirmation mail, laptop returned_to_vendor, rent ends
 *                          the day before the pause.
 *   Challan cancelled    → pauses voided (rent as if never stopped) + mail.
 *
 * Every mail goes last in its transaction: if it can't be sent nothing changes.
 */
const pool = require('../config/db');
const reqMail = require('./vendorReturnRequestMail');
const repairMail = require('./vendorRepairMail');
const { sendDispatchMail, isDispatchMailConfigured } = require('./dispatchEmailService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { transitionAsset, STATUS } = require('./inventoryStateMachine');

const RENTAL_TYPES = ['rental_purchase', 'rent_to_own'];
const ACCOUNTS_EMAIL = process.env.ACCOUNTS_EMAIL || 'accounts@truetechservices.in';

function approverEmails() {
  return String(process.env.VENDOR_REPLACEMENT_APPROVERS || 'pankkajyadav@rentfoxxy.com')
    .split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Accounts (role) or a named approver (pankkajyadav by default). */
function canApproveReplacement(user) {
  if (!user) return false;
  if (String(user.role || '').toLowerCase() === 'accounts') return true;
  return approverEmails().includes(String(user.email || '').trim().toLowerCase());
}

function fail(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status }, extra);
}

async function safeEvent(args) {
  try { await logTtsplEvent(args); } catch (err) { console.warn('[vendorRepairRent] audit skipped:', err.message); }
}

function crmLink(path) {
  const base = (process.env.CRM_PUBLIC_URL || process.env.PUBLIC_APP_URL || 'https://crm.rentfoxxy.com').replace(/\/$/, '');
  return `${base}${path}`;
}

/* ------------------------------------------------------------------ reads */

async function loadDc(db, dcNumber, { lock = false } = {}) {
  const head = (await db.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1${lock ? ' FOR UPDATE' : ''}`,
    [dcNumber]
  )).rows[0];
  if (!head) throw fail('Vendor repair DC not found', 404);
  const vendor = head.vendor_id
    ? (await db.query('SELECT * FROM vendors WHERE vendor_id = $1', [head.vendor_id])).rows[0] || null
    : null;
  const items = (await db.query(
    `SELECT i.*,
            COALESCE(vsn.acquisition_type, vpo.purchase_order_type) AS po_type,
            vpo.vendor_id AS rent_vendor_id,
            vsn.vendor_rent_end_date,
            vsn.inventory_status
       FROM vendor_repair_dc_items i
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = i.serial_id
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
      WHERE i.dc_number = $1
      ORDER BY i.id`,
    [dcNumber]
  )).rows;
  return { head, vendor, items };
}

/** Rented from the repair vendor, rent still running — its rent pauses. */
function isPausable(head, item) {
  return Boolean(item.serial_id)
    && item.item_status !== 'cancelled'
    && RENTAL_TYPES.includes(String(item.po_type || ''))
    && head.vendor_id != null
    && Number(item.rent_vendor_id) === Number(head.vendor_id)
    && !item.vendor_rent_end_date;
}

function vendorTo(head, vendor) {
  return String(vendor?.email || '').trim();
}

/* ------------------------------------------------------------ repair mail */

async function previewRepairMail(dcNumber) {
  const { head, vendor, items } = await loadDc(pool, dcNumber);
  const live = items.filter((i) => i.item_status !== 'cancelled');
  const stop = reqMail.ymd(head.rent_stop_date);
  const pausable = live.filter((i) => isPausable(head, i));
  const mail = repairMail.buildRepairRequestMail({
    dc: head, items: live, stopDate: stop || reqMail.todayIst(), contactName: vendor?.contact_person_name, pausedCount: pausable.length,
  });
  return {
    to: vendorTo(head, vendor) || null,
    cc: reqMail.requestCc(),
    subject: mail.subject,
    html: mail.html,
    rent_stop_date: stop,
    stop_date_passed: Boolean(stop && stop < reqMail.todayIst()),
    laptops: live.length,
    paused_laptops: pausable.length,
    already_sent: Boolean(head.vendor_notified_at),
  };
}

async function repairRequestPdf(dcNumber, db = pool) {
  const { head, vendor, items } = await loadDc(db, dcNumber);
  const live = items.filter((i) => i.item_status !== 'cancelled');
  const { generateRepairRequestPdf } = require('./vendorReturnRequestPdfService');
  return generateRepairRequestPdf({
    dc: head, items: live, vendor, stopDate: reqMail.ymd(head.rent_stop_date) || reqMail.todayIst(),
    pausedCount: live.filter((i) => isPausable(head, i)).length,
  });
}

/**
 * Mail the repair vendor and pause rent from the stop date on the laptops
 * rented from them. Required before a new-format challan can go to the gate.
 */
async function sendRepairMail(client, { dcNumber, actorUserId, actorName }) {
  const { head, vendor, items } = await loadDc(client, dcNumber, { lock: true });
  if (head.status === 'cancelled') throw fail('This challan is cancelled', 409);
  if (String(head.item_domain || 'laptop') !== 'laptop') throw fail('Only laptop repair challans mail the vendor this way');
  if (head.vendor_notified_at) return { already_sent: true };
  const stop = reqMail.ymd(head.rent_stop_date);
  if (!stop) throw fail('Set the rent stop date on the challan first');
  if (stop < reqMail.todayIst()) {
    throw fail(`The rent stop date ${reqMail.prettyDate(stop)} has passed — change it to today or later`, 409);
  }
  const to = vendorTo(head, vendor);
  if (!to) throw fail('The vendor has no email address on file — add it on the vendor record.');
  if (!isDispatchMailConfigured()) throw fail('Dispatch email is not configured (DISPATCH_SMTP_*).', 503);

  const live = items.filter((i) => i.item_status !== 'cancelled');
  if (!live.length) throw fail('No laptops on this challan');
  const pausable = live.filter((i) => isPausable(head, i));
  const cc = reqMail.requestCc();
  const mail = repairMail.buildRepairRequestMail({
    dc: head, items: live, stopDate: stop, contactName: vendor?.contact_person_name, pausedCount: pausable.length,
  });
  const { generateRepairRequestPdf } = require('./vendorReturnRequestPdfService');
  const pdfRel = await generateRepairRequestPdf({ dc: head, items: live, vendor, stopDate: stop, pausedCount: pausable.length });

  for (const it of pausable) {
    try {
      await client.query('SAVEPOINT pause_one');
      await client.query(
        `INSERT INTO vendor_rent_pauses (serial_id, paused_from, source, source_ref, item_id, created_by)
         VALUES ($1, $2::date, 'vendor_repair', $3, $4, $5)`,
        [it.serial_id, stop, dcNumber, it.id, actorUserId || null]
      );
      await client.query('RELEASE SAVEPOINT pause_one');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT pause_one');
      if (err.code === '23505') throw fail(`${it.ttspl_id || it.serial_number}: its rent is already stopped on another repair`, 409);
      throw err;
    }
    await client.query('UPDATE vendor_repair_dc_items SET rent_paused_from = $2::date WHERE id = $1', [it.id, stop]);
    await safeEvent({
      db: client, vendorSerialId: it.serial_id, ttsplId: it.ttspl_id, eventType: 'vendor_rent_paused',
      description: `Rent to ${head.vendor_name} stopped from ${stop} — sent for repair on ${dcNumber}`,
      metadata: { dc_number: dcNumber, paused_from: stop }, actorUserId, actorName,
    });
  }
  await client.query(
    `UPDATE vendor_repair_delivery_challans
        SET vendor_notified_at = NOW(), vendor_notified_by = $2, notify_to = $3, notify_cc = $4,
            request_pdf_path = $5, notify_error = NULL, updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, actorUserId || null, to, cc, pdfRel]
  );

  let ok = false;
  let why = null;
  try {
    ok = await sendDispatchMail({
      to, cc, subject: mail.subject, text: mail.text, html: mail.html,
      pdfRelativePath: `uploads/${pdfRel}`, userTriggered: true,
    });
  } catch (err) { why = err.message; }
  if (!ok) {
    throw fail('The repair mail to the vendor could not be sent. Nothing was changed.', 503, {
      notifyError: why || 'sendDispatchMail returned false', dcNumber,
    });
  }
  return { sent: true, to, cc, paused: pausable.length, rent_stop_date: stop };
}

async function writeNotifyError(dcNumber, message) {
  await pool.query(
    'UPDATE vendor_repair_delivery_challans SET notify_error = $2, updated_at = NOW() WHERE dc_number = $1',
    [dcNumber, String(message || '').slice(0, 1000)]
  );
}

/**
 * Called by cancelVendorRepairDc: the laptops never went, so their pauses
 * never happened; if the vendor was mailed, tell them (mail last).
 */
async function onChallanCancelled(client, { dcNumber, reason }) {
  const voided = (await client.query(
    `UPDATE vendor_rent_pauses SET closed_reason = 'cancelled', updated_at = NOW()
      WHERE source = 'vendor_repair' AND source_ref = $1 AND closed_reason IS NULL
      RETURNING serial_id`,
    [dcNumber]
  )).rows;
  await client.query('UPDATE vendor_repair_dc_items SET rent_paused_from = NULL WHERE dc_number = $1', [dcNumber]);
  const { head, vendor, items } = await loadDc(client, dcNumber);
  if (!head.vendor_notified_at) return { voided: voided.length, mailed: false };
  const to = vendorTo(head, vendor) || head.notify_to;
  if (!to) throw fail('The vendor has no email address — cannot tell them the repair is cancelled.');
  const mail = repairMail.buildRepairCancelMail({ dc: head, items, contactName: vendor?.contact_person_name, reason });
  let ok = false;
  try {
    ok = await sendDispatchMail({ to, cc: head.notify_cc || reqMail.requestCc(), subject: mail.subject, text: mail.text, html: mail.html, userTriggered: true });
  } catch (_) { ok = false; }
  if (!ok) throw fail('The cancellation mail to the vendor could not be sent. Nothing was changed.', 503);
  await client.query('UPDATE vendor_repair_delivery_challans SET cancel_mail_sent_at = NOW() WHERE dc_number = $1', [dcNumber]);
  return { voided: voided.length, mailed: true };
}

/* ------------------------------------------------------- resume and end */

/** Repaired and back: rent resumes on `resumedOn` (the gate-in date). */
async function resumeItemPause(client, { itemId, resumedOn }) {
  const r = (await client.query(
    `UPDATE vendor_rent_pauses
        SET resumed_on = GREATEST($2::date, paused_from), closed_reason = 'resumed', updated_at = NOW()
      WHERE item_id = $1 AND source = 'vendor_repair' AND closed_reason IS NULL
      RETURNING serial_id, resumed_on`,
    [itemId, resumedOn]
  )).rows[0];
  if (r) await client.query('UPDATE vendor_repair_dc_items SET rent_resumed_on = $2 WHERE id = $1', [itemId, r.resumed_on]);
  return r || null;
}

/**
 * The laptop is not coming back to us (replaced, or the vendor keeps it): its
 * rent ends the day before the pause started. With no pause (an old-format
 * challan, or a laptop not rented from this vendor), a laptop rented from this
 * vendor ends on `fallbackEnd` — what the old code did.
 */
async function endItemRent(client, { head, item, reason, fallbackEnd }) {
  const pause = (await client.query(
    `UPDATE vendor_rent_pauses SET closed_reason = $2, updated_at = NOW()
      WHERE item_id = $1 AND source = 'vendor_repair' AND closed_reason IS NULL
      RETURNING paused_from`,
    [item.id, reason]
  )).rows[0];
  let end = null;
  if (pause) end = reqMail.addDays(reqMail.ymd(pause.paused_from), -1);
  else if (RENTAL_TYPES.includes(String(item.po_type || '')) && Number(item.rent_vendor_id) === Number(head.vendor_id)) end = fallbackEnd;
  if (end && item.serial_id) {
    await client.query(
      `UPDATE vendor_serial_numbers
          SET vendor_rent_end_date = LEAST(COALESCE(vendor_rent_end_date, $2::date), $2::date), updated_at = NOW()
        WHERE serial_id = $1`,
      [item.serial_id, end]
    );
  }
  return end;
}

/** The date rent resumes / a replacement starts: gate-in, else the receive day. */
function arrivalDate(item, fallback = new Date()) {
  const d = item.gate_inward_at ? new Date(item.gate_inward_at) : fallback;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

async function recomputeDcStatus(client, dcNumber) {
  const c = (await client.query(
    `SELECT
        COUNT(*) FILTER (WHERE COALESCE(item_status, 'draft') IN ('dispatched', 'dispatch_ready', 'gate_received', 'replacement_pending'))::int AS pending,
        COUNT(*) FILTER (WHERE item_status IN ('received', 'replacement_received', 'vendor_kept'))::int AS received
       FROM vendor_repair_dc_items WHERE dc_number = $1 AND COALESCE(item_status, '') <> 'cancelled'`,
    [dcNumber]
  )).rows[0];
  const next = c.pending === 0 ? 'returned' : 'partially_returned';
  await client.query(
    `UPDATE vendor_repair_delivery_challans
        SET status = $2::text, items_received_count = $3::int,
            returned_at = CASE WHEN $2::text = 'returned' THEN COALESCE(returned_at, NOW()) ELSE returned_at END,
            updated_at = NOW()
      WHERE dc_number = $1 AND status IN ('dispatched', 'partially_returned', 'returned')`,
    [dcNumber, next, c.received]
  );
  return next;
}

/* ------------------------------------------------- replacement check/approval */

/**
 * "It's a replacement": mint the replacement check (script reads the new
 * laptop, compares with the one we sent). If the guard could not gate it in —
 * a replacement has no TTSPL label to scan — this records its arrival now.
 */
async function startReplacementCheck(client, { dcNumber, itemId, actorUserId }) {
  const { head, items } = await loadDc(client, dcNumber, { lock: true });
  const item = items.find((i) => Number(i.id) === Number(itemId));
  if (!item) throw fail('That laptop is not on this challan', 404);
  if (!['dispatched', 'gate_received'].includes(item.item_status)) {
    throw fail(`This laptop is ${item.item_status} — nothing to check`, 409);
  }
  if (item.replacement_approval_status === 'approved') throw fail('This replacement is already approved — receive it', 409);
  let recv = item.receive_dc_number;
  if (item.item_status === 'dispatched') {
    const { nextReceiveDcNumber } = require('./vendorRepairGateService');
    recv = recv || await nextReceiveDcNumber(client, dcNumber);
    await client.query(
      `INSERT INTO vendor_repair_receive_challans (dc_number, receive_dc_number, receive_mode, items_count, created_by, gate_inward_at)
       VALUES ($1, $2, 'replacement', 1, $3, NOW())
       ON CONFLICT (receive_dc_number) DO NOTHING`,
      [dcNumber, recv, actorUserId || null]
    );
    await client.query(
      `UPDATE vendor_repair_dc_items
          SET item_status = 'gate_received', receive_dc_number = $2, gate_inward_at = COALESCE(gate_inward_at, NOW())
        WHERE id = $1`,
      [item.id, recv]
    );
  }
  await client.query(
    `UPDATE vendor_repair_dc_items
        SET replacement_config_result = NULL, replacement_actual_config = NULL, replacement_captured_serial = NULL,
            replacement_approval_status = NULL, replacement_proposed = NULL
      WHERE id = $1`,
    [item.id]
  );
  await client.query(
    `UPDATE vendor_return_capture_tokens SET status = 'expired'
      WHERE item_id = $1 AND status = 'pending'`,
    [item.id]
  );
  const { mintTokensForItems } = require('./vendorReturnCaptureService');
  const { snapshotToExpected } = require('./vendorRepairGateService');
  const [tok] = await mintTokensForItems(client, {
    dcNumber, receiveDcNumber: recv, createdBy: actorUserId || null, mode: 'replacement',
    items: [{ ...item, expected_config: snapshotToExpected(item.dispatch_config_snapshot) }],
  });
  return { access_number: tok.access_number, token_id: tok.token_id, receive_dc_number: recv, vendor_name: head.vendor_name };
}

/**
 * From the receive: a replacement that differs (or could not be read) goes to
 * approval instead of into stock. Mail to Accounts + approver goes last.
 */
async function submitForApproval(client, { head, item, proposed, actorUserId }) {
  await client.query(
    `UPDATE vendor_repair_dc_items
        SET item_status = 'replacement_pending', replacement_approval_status = 'pending',
            replacement_proposed = $2::jsonb, replacement_requested_at = NOW(), replacement_requested_by = $3
      WHERE id = $1`,
    [item.id, JSON.stringify(proposed), actorUserId || null]
  );
  const checks = item.replacement_config_result?.checks || [];
  const mail = repairMail.buildApprovalRequestMail({
    dc: head, item, proposed, checks, link: crmLink('/carret/procure/replacement-approvals'),
  });
  const to = [ACCOUNTS_EMAIL, ...approverEmails()].join(', ');
  let ok = false;
  try { ok = await sendDispatchMail({ to, subject: mail.subject, text: mail.text, html: mail.html, userTriggered: true }); } catch (_) { ok = false; }
  if (!ok) throw fail('The approval request mail to Accounts could not be sent. Nothing was changed.', 503);
  return { pending_approval: true, item_id: item.id };
}

async function listPendingApprovals() {
  const { rows } = await pool.query(
    `SELECT i.id AS item_id, i.dc_number, i.ttspl_id, i.serial_number, i.configuration, i.issue_type, i.item_remarks,
            i.replacement_proposed, i.replacement_config_result, i.replacement_requested_at, i.gate_inward_at,
            i.replacement_rejections, d.vendor_name, d.vendor_id, u.name AS requested_by_name
       FROM vendor_repair_dc_items i
       JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number
       LEFT JOIN users u ON u.user_id = i.replacement_requested_by
      WHERE i.item_status = 'replacement_pending' AND i.replacement_approval_status = 'pending'
      ORDER BY i.replacement_requested_at`
  );
  return rows;
}

async function decideReplacement(client, { dcNumber, itemId, approve, note, user }) {
  if (!canApproveReplacement(user)) throw fail('Only Accounts or the named approver can decide a replacement', 403);
  const { head, vendor, items } = await loadDc(client, dcNumber, { lock: true });
  const item = items.find((i) => Number(i.id) === Number(itemId));
  if (!item) throw fail('That laptop is not on this challan', 404);
  if (item.item_status !== 'replacement_pending') throw fail('This replacement is not waiting for a decision', 409);
  const why = String(note || '').trim();
  if (!approve && why.length < 3) throw fail('Give the reason — it goes to the vendor');

  if (approve) {
    await client.query(
      `UPDATE vendor_repair_dc_items
          SET item_status = 'gate_received', replacement_approval_status = 'approved',
              replacement_decided_at = NOW(), replacement_decided_by = $2, replacement_decision_note = $3
        WHERE id = $1`,
      [item.id, user.user_id || null, why || null]
    );
    await safeEvent({
      db: client, vendorSerialId: item.serial_id, ttsplId: item.ttspl_id, eventType: 'vendor_replacement_approved',
      description: `Replacement ${item.replacement_proposed?.serial_number || ''} approved by ${user.name || user.email || 'approver'} on ${dcNumber}`,
      metadata: { dc_number: dcNumber, proposed: item.replacement_proposed, note: why || null },
      actorUserId: user.user_id, actorName: user.name,
    });
    return { approved: true };
  }

  // Rejected: handed back, the item waits with the vendor again (rent still paused).
  const rejection = {
    at: new Date().toISOString(), by: user.user_id || null, by_name: user.name || user.email || null,
    note: why, proposed: item.replacement_proposed, gate_inward_at: item.gate_inward_at,
  };
  await client.query(
    `UPDATE vendor_repair_dc_items
        SET item_status = 'dispatched', replacement_approval_status = 'rejected',
            replacement_decided_at = NOW(), replacement_decided_by = $2, replacement_decision_note = $3,
            replacement_rejections = COALESCE(replacement_rejections, '[]'::jsonb) || $4::jsonb,
            gate_inward_at = NULL, gate_inward_session_id = NULL, receive_dc_number = NULL,
            replacement_check_token_id = NULL, replacement_captured_serial = NULL,
            replacement_actual_config = NULL, replacement_config_result = NULL
      WHERE id = $1`,
    [item.id, user.user_id || null, why, JSON.stringify([rejection])]
  );
  await recomputeDcStatus(client, dcNumber);
  await safeEvent({
    db: client, vendorSerialId: item.serial_id, ttsplId: item.ttspl_id, eventType: 'vendor_replacement_rejected',
    description: `Replacement ${item.replacement_proposed?.serial_number || ''} not accepted on ${dcNumber} — handed back: ${why}`,
    metadata: { dc_number: dcNumber, proposed: item.replacement_proposed }, actorUserId: user.user_id, actorName: user.name,
  });
  const to = vendorTo(head, vendor) || head.notify_to;
  if (!to) throw fail('The vendor has no email address — cannot tell them the replacement is not accepted.');
  const mail = repairMail.buildReplacementRejectedMail({ dc: head, item, proposed: item.replacement_proposed, contactName: vendor?.contact_person_name, note: why });
  let ok = false;
  try { ok = await sendDispatchMail({ to, cc: head.notify_cc || reqMail.requestCc(), subject: mail.subject, text: mail.text, html: mail.html, userTriggered: true }); } catch (_) { ok = false; }
  if (!ok) throw fail('The mail to the vendor could not be sent. Nothing was changed.', 503);
  return { rejected: true };
}

/* -------------------------------------------------------- vendor keeps it */

async function previewVendorKept(dcNumber, itemId, reason) {
  const { head, vendor, items } = await loadDc(pool, dcNumber);
  const item = items.find((i) => Number(i.id) === Number(itemId));
  if (!item) throw fail('That laptop is not on this challan', 404);
  const end = item.rent_paused_from ? reqMail.addDays(reqMail.ymd(item.rent_paused_from), -1) : reqMail.todayIst();
  const mail = repairMail.buildVendorKeptMail({ dc: head, item, contactName: vendor?.contact_person_name, reason, rentEndDate: end });
  return { to: vendorTo(head, vendor) || null, cc: head.notify_cc || reqMail.requestCc(), subject: mail.subject, html: mail.html, rent_end_date: end };
}

/**
 * The vendor could not repair it and keeps it. Mail the vendor, then record
 * the laptop returned to them. A mail failure changes nothing.
 */
async function markVendorKept(client, { dcNumber, itemId, reason, actorUserId, actorName }) {
  const why = String(reason || '').trim();
  if (why.length < 3) throw fail('Say what the vendor told us');
  const { head, vendor, items } = await loadDc(client, dcNumber, { lock: true });
  const item = items.find((i) => Number(i.id) === Number(itemId));
  if (!item) throw fail('That laptop is not on this challan', 404);
  if (item.item_status !== 'dispatched') throw fail('Only a laptop still with the vendor can be marked as kept by them', 409);
  const to = vendorTo(head, vendor) || head.notify_to;
  if (!to) throw fail('The vendor has no email address on file — add it on the vendor record.');
  if (!isDispatchMailConfigured()) throw fail('Dispatch email is not configured (DISPATCH_SMTP_*).', 503);

  const end = await endItemRent(client, { head, item, reason: 'vendor_kept', fallbackEnd: reqMail.todayIst() });
  if (item.serial_id) {
    await transitionAsset(client, {
      serialId: item.serial_id,
      toStatus: STATUS.RETURNED_TO_VENDOR,
      reason: `Vendor could not repair it and keeps it (${dcNumber}): ${why}`,
      dcNumber, actorUserId, actorName,
    });
    await client.query(
      `UPDATE vendor_serial_numbers
          SET qc_status = 'returned_to_vendor', warehouse_carret = NULL, warehouse_carret_slot = NULL,
              extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
        WHERE serial_id = $1`,
      [item.serial_id, JSON.stringify({ location: 'with_vendor', vendor_repair_dc: dcNumber, vendor_kept: true })]
    );
    await require('./vendorDebitNoteService').draftForReturn(client, {
      serialId: item.serial_id, source: 'vendor_kept', sourceRef: dcNumber, reason: why, actorUserId,
    });
  }
  await client.query(
    `UPDATE vendor_repair_dc_items
        SET item_status = 'vendor_kept', vendor_kept_reason = $2, vendor_kept_at = NOW(), vendor_kept_by = $3,
            vendor_kept_mail_at = NOW(), returned_at = NOW()
      WHERE id = $1`,
    [item.id, why, actorUserId || null]
  );
  await client.query(
    `UPDATE tickets SET status = 'cancelled', current_location = $2, vendor_repair_dc_number = NULL, updated_at = NOW()
      WHERE ticket_id = $1`,
    [item.ticket_id, `Returned to ${head.vendor_name} (not repairable)`]
  );
  await client.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes, created_at)
     VALUES ($1, NULL, $2, 'vendor_kept', $3, CURRENT_TIMESTAMP)`,
    [item.ticket_id, actorUserId || null, `Vendor could not repair it and keeps it (${dcNumber}): ${why}`]
  );
  await safeEvent({
    db: client, vendorSerialId: item.serial_id, ttsplId: item.ttspl_id, eventType: 'vendor_kept_not_repairable',
    description: `${head.vendor_name} could not repair it and keeps it (${dcNumber}) — rent ends ${end || '—'}`,
    metadata: { dc_number: dcNumber, reason: why, rent_end_date: end }, actorUserId, actorName,
  });
  const status = await recomputeDcStatus(client, dcNumber);

  const mail = repairMail.buildVendorKeptMail({ dc: head, item, contactName: vendor?.contact_person_name, reason: why, rentEndDate: end || reqMail.todayIst() });
  let ok = false;
  try { ok = await sendDispatchMail({ to, cc: head.notify_cc || reqMail.requestCc(), subject: mail.subject, text: mail.text, html: mail.html, userTriggered: true }); } catch (_) { ok = false; }
  if (!ok) throw fail('The confirmation mail to the vendor could not be sent. Nothing was changed.', 503);
  return { vendor_kept: true, rent_end_date: end, dc_status: status };
}

module.exports = {
  RENTAL_TYPES,
  canApproveReplacement,
  approverEmails,
  loadDc,
  isPausable,
  previewRepairMail,
  repairRequestPdf,
  sendRepairMail,
  writeNotifyError,
  onChallanCancelled,
  resumeItemPause,
  endItemRent,
  arrivalDate,
  recomputeDcStatus,
  startReplacementCheck,
  submitForApproval,
  listPendingApprovals,
  decideReplacement,
  previewVendorKept,
  markVendorKept,
};
