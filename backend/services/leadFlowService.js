/**
 * Lead flow (claude/carret-lead.md; user's decisions 26 Sep 2026).
 *
 *  - winLead: Deal / Demo and "convert to customer" are one step. The customer
 *    (with its billing, shipping and the lead's other addresses) is created in
 *    the same transaction that sets the status — no silent customer at Deal.
 *  - completeFollowUp: a follow-up is finished with what happened; the next
 *    date is required unless the lead is being closed. Every one is kept in
 *    lead_follow_up_log (migration 349).
 *  - advanceLead: quote sent → Cold / Proposal Shared, quote accepted → Warm /
 *    Price Agreed, sales order raised → Deal. Only ever moves a lead forward,
 *    never out of Rejected / Gone except to Deal, and logs every move.
 */
const pool = require('../config/db');
const { validateFinanceSpockContactFields, applyFinanceSpockDetails } = require('../controllers/customerManagementController');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const RANK = { Pending: 0, 'Call Back': 0, Hold: 0, Cold: 1, Warm: 2, Demo: 2, Hot: 3, Deal: 4, Repeat: 4 };
const CLOSED = ['Rejected', 'Gone'];

function normalizeGstin(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }
function isValidGstin(v) { return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(normalizeGstin(v)); }
function parseDetails(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v) || {}; } catch { return {}; }
}

async function logActivity(db, { leadId, userId, action, from, to, stageFrom, stageTo, notes }) {
  await db.query(
    `INSERT INTO lead_activities (lead_id, user_id, action, status_from, status_to, stage_from, stage_to, notes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [leadId, userId || null, action, from || null, to || null, stageFrom || null, stageTo || null, notes || null]
  );
  await db.query('UPDATE leads SET last_activity_at = NOW(), updated_at = NOW() WHERE lead_id = $1', [leadId]);
}

/** Customer + addresses from the convert form. Works inside the caller's transaction. */
async function convertLead(db, lead, body, userId) {
  const billingAddress = String(body.billing_address || lead.billing_address || '').trim();
  const billingCity = body.billing_city || body.city || lead.city || null;
  const billingState = body.billing_state || body.state || lead.state || null;
  const billingPincode = body.billing_pincode || body.pincode || lead.pincode || null;
  if (!billingAddress || !billingCity || !billingState || !billingPincode) throw fail('Billing address, city, state and pincode are required');

  const errs = validateFinanceSpockContactFields(body);
  if (errs.length) throw fail(errs[0]);

  const gstNo = normalizeGstin(body.gst_number || lead.gst_number);
  if (!isValidGstin(gstNo)) throw fail('A valid 15-character GSTIN is required');

  const shippingSame = body.shipping_same_as_billing !== false;
  const ship = shippingSame
    ? { address: billingAddress, city: billingCity, state: billingState, pincode: billingPincode }
    : {
      address: String(body.shipping_address || '').trim(), city: body.shipping_city || null,
      state: body.shipping_state || null, pincode: body.shipping_pincode || null,
    };
  if (!shippingSame && (!ship.address || !ship.city || !ship.state || !ship.pincode)) throw fail('Shipping address, city, state and pincode are required');

  const name = String(body.customer_name || lead.name || lead.company_name || '').trim() || 'Customer';
  const company = String(body.company_name || lead.company_name || '').trim() || null;
  const email = body.email || lead.email || null;
  const phone = body.phone || lead.phone || null;
  const pan = body.pan_number || lead.pan_number || null;

  const existing = (await db.query(
    'SELECT customer_id, details FROM customers WHERE source_lead_id = $1 OR customer_id = $2 ORDER BY customer_id LIMIT 1',
    [lead.lead_id, lead.customer_id || 0]
  )).rows[0];
  const details = parseDetails(existing?.details);
  details.contact_person_name = name;
  details.contact_person_number = phone;
  applyFinanceSpockDetails(details, body);

  const values = [
    name, company, email, phone, gstNo, pan, lead.company_type, lead.company_size, lead.industry,
    billingAddress, billingCity, billingState, billingPincode,
    shippingSame, ship.address, ship.city, ship.state, ship.pincode,
    lead.whatsapp_number, lead.designation, lead.lead_stage, userId, JSON.stringify(details),
  ];
  let customerId;
  let isNew = false;
  if (existing) {
    customerId = existing.customer_id;
    await db.query(
      `UPDATE customers SET
         name = $1, company_name = $2, email = $3, phone = $4, gst_no = $5, pan_number = $6,
         company_type = $7, company_size = $8, industry = $9,
         billing_address = $10, billing_city = $11, billing_state = $12, billing_pincode = $13,
         shipping_same = $14, shipping_address = $15, shipping_city = $16, shipping_state = $17, shipping_pincode = $18,
         whatsapp_number = $19, designation = $20, source_lead_stage = $21,
         onboarded_by = $22, onboarded_at = COALESCE(onboarded_at, NOW()), details = $23,
         source_lead_id = COALESCE(source_lead_id, $25), updated_at = NOW()
       WHERE customer_id = $24`,
      [...values, customerId, lead.lead_id]
    );
  } else {
    customerId = (await db.query(
      `INSERT INTO customers (
         name, company_name, email, phone, gst_no, pan_number, company_type, company_size, industry,
         billing_address, billing_city, billing_state, billing_pincode,
         shipping_same, shipping_address, shipping_city, shipping_state, shipping_pincode,
         whatsapp_number, designation, source_lead_stage, onboarded_by, details,
         source_lead_id, onboarded_at, type, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, NOW(), 'Lead', NOW(), NOW())
       RETURNING customer_id`,
      [...values, lead.lead_id]
    )).rows[0].customer_id;
    isNew = true;
  }

  // Addresses the sales order and DC screens pick from.
  const upsertAddr = async (isHead, type, a) => {
    const row = (await db.query(
      `SELECT customer_address_id FROM customer_addresses
        WHERE customer_id = $1 AND is_head_office = $2 AND address_type = $3 AND source_lead_address_id IS NULL LIMIT 1`,
      [customerId, isHead, type]
    )).rows[0];
    if (row) {
      await db.query(
        `UPDATE customer_addresses SET concern_person = $2, mobile_no = $3, address = $4, city = $5, state = $6, pincode = $7, updated_at = NOW()
          WHERE customer_address_id = $1`,
        [row.customer_address_id, name, phone, a.address, a.city, a.state, a.pincode]
      );
    } else {
      await db.query(
        `INSERT INTO customer_addresses (customer_id, concern_person, mobile_no, address, city, state, pincode, is_head_office, address_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [customerId, name, phone, a.address, a.city, a.state, a.pincode, isHead, type]
      );
    }
  };
  await upsertAddr(true, 'Billing', { address: billingAddress, city: billingCity, state: billingState, pincode: billingPincode });
  if (!shippingSame) await upsertAddr(false, 'Shipping', ship);
  await db.query(
    `INSERT INTO customer_addresses (customer_id, concern_person, mobile_no, address, pincode, is_head_office, address_type, source_lead_address_id, created_at, updated_at)
     SELECT $1, la.concern_person, la.mobile_no, la.address, la.pincode, FALSE, COALESCE(la.address_type, 'Shipping'), la.address_id, NOW(), NOW()
       FROM lead_addresses la
      WHERE la.lead_id = $2
        AND NOT EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.source_lead_address_id = la.address_id)`,
    [customerId, lead.lead_id]
  );

  await db.query(
    `UPDATE leads SET customer_id = $1, gst_number = $2, converted_at = COALESCE(converted_at, NOW()), converted_by = COALESCE(converted_by, $3), updated_at = NOW()
      WHERE lead_id = $4`,
    [customerId, gstNo, userId, lead.lead_id]
  );
  await logActivity(db, { leadId: lead.lead_id, userId, action: 'converted_to_customer', notes: `${isNew ? 'New' : 'Updated'} customer #${customerId}` });
  return { customer_id: customerId, is_new: isNew };
}

/** Deal / Demo with the customer, in one step. */
async function winLead(db, leadId, body, userId) {
  const status = body.status === 'Demo' ? 'Demo' : 'Deal';
  const lead = (await db.query('SELECT * FROM leads WHERE lead_id = $1 FOR UPDATE', [leadId])).rows[0];
  if (!lead) throw fail('Lead not found', 404);
  const conv = await convertLead(db, lead, body, userId);
  const stage = status === 'Demo' ? 'Demo' : 'Deal';
  await db.query(
    `UPDATE leads SET status = $2::text, lead_stage = $3::text, rejection_reason = NULL,
            follow_up_date = CASE WHEN $2::text = 'Deal' THEN NULL ELSE follow_up_date END, updated_at = NOW()
      WHERE lead_id = $1`,
    [leadId, status, stage]
  );
  await logActivity(db, {
    leadId, userId, action: 'status_updated', from: lead.status, to: status, stageFrom: lead.lead_stage, stageTo: stage,
    notes: String(body.notes || '').trim() || `${status} — customer #${conv.customer_id}`,
  });
  return { ...conv, status };
}

const OUTCOMES = {
  spoke: 'Spoke to them',
  no_answer: 'No answer',
  call_back: 'Asked to call back',
  not_interested: 'Not interested',
  meeting_done: 'Meeting / demo done',
};

/**
 * Finish the current follow-up. `next_date` (YYYY-MM-DD, IST) is required unless
 * the lead is closed (Rejected / Gone / Deal) — then it is cleared.
 */
async function completeFollowUp(db, leadId, body, userId) {
  const lead = (await db.query('SELECT lead_id, status, follow_up_date, follow_up_time FROM leads WHERE lead_id = $1 FOR UPDATE', [leadId])).rows[0];
  if (!lead) throw fail('Lead not found', 404);
  const outcome = String(body.outcome || '');
  if (!OUTCOMES[outcome]) throw fail('Say what happened');
  const notes = String(body.notes || '').trim();
  if (notes.length < 3 && outcome !== 'no_answer') throw fail('Write a short note of the conversation');
  const closed = CLOSED.includes(lead.status) || lead.status === 'Deal';
  let nextAt = null;
  if (!closed) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.next_date || ''))) throw fail('Choose the next follow-up date (or close the lead)');
    const time = /^\d{2}:\d{2}$/.test(String(body.next_time || '')) ? body.next_time : null;
    const todayIst = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    if (body.next_date < todayIst) throw fail('The next follow-up cannot be in the past');
    nextAt = { date: body.next_date, time };
  }
  await db.query(
    `INSERT INTO lead_follow_up_log (lead_id, due_at, outcome, notes, next_due_date, next_due_time, done_by, done_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [leadId, lead.follow_up_date, outcome, notes || null, nextAt?.date || null, nextAt?.time || null, userId]
  );
  // Noon IST, like PUT /leads/:id/follow-up, so the reminder mail and "today" lists agree.
  await db.query(
    `UPDATE leads SET follow_up_date = $2::timestamptz, follow_up_time = $3::time, updated_at = NOW() WHERE lead_id = $1`,
    [leadId, nextAt ? `${nextAt.date}T12:00:00+05:30` : null, nextAt?.time || null]
  );
  await logActivity(db, {
    leadId, userId, action: 'follow_up_done',
    notes: `${OUTCOMES[outcome]}${notes ? ` — ${notes}` : ''}${nextAt ? ` · next ${nextAt.date}${nextAt.time ? ` ${nextAt.time}` : ''}` : ''}`,
  });
  return { outcome, next: nextAt };
}

const MOVES = {
  quote_sent: { status: 'Cold', stage: 'Proposal Shared', label: 'Quotation sent' },
  quote_accepted: { status: 'Warm', stage: 'Price Agreed', label: 'Customer accepted the quotation' },
  so_created: { status: 'Deal', stage: 'Deal', label: 'Sales order raised' },
};

/** Moves a lead forward when sales work happens on it. Never backwards. */
async function advanceLead(db, leadId, event, { ref, userId } = {}) {
  const m = MOVES[event];
  if (!m || !leadId) return null;
  const lead = (await db.query('SELECT lead_id, status, lead_stage FROM leads WHERE lead_id = $1', [leadId])).rows[0];
  if (!lead) return null;
  const closed = CLOSED.includes(lead.status);
  if (closed && event !== 'so_created') return null;
  if (!closed && (RANK[lead.status] ?? 0) >= RANK[m.status]) return null;
  await db.query(
    `UPDATE leads SET status = $2, lead_stage = $3, rejection_reason = NULL, updated_at = NOW() WHERE lead_id = $1`,
    [leadId, m.status, m.stage]
  );
  await logActivity(db, {
    leadId, userId, action: 'status_updated', from: lead.status, to: m.status, stageFrom: lead.lead_stage, stageTo: m.stage,
    notes: `${m.label}${ref ? ` (${ref})` : ''} — moved automatically`,
  });
  return { from: lead.status, to: m.status };
}

/** The lead behind a customer (for sales orders). */
async function leadForCustomer(db, customerId) {
  if (!customerId) return null;
  const r = (await db.query(
    `SELECT COALESCE(c.source_lead_id, (SELECT l.lead_id FROM leads l WHERE l.customer_id = c.customer_id ORDER BY l.lead_id DESC LIMIT 1)) AS lead_id
       FROM customers c WHERE c.customer_id = $1`,
    [customerId]
  )).rows[0];
  return r?.lead_id || null;
}

module.exports = {
  OUTCOMES, MOVES, winLead, convertLead, completeFollowUp, advanceLead, leadForCustomer, isValidGstin, fail, pool,
};
