'use strict';

/**
 * End-to-end Support V2 return-pickup for TTSPL3597 (serial_id 2092)
 * on demo with customer 163. Uses the same services as the CRM APIs.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const pool = require('../config/db');
const { createTicket, resolveLine } = require('../services/supportTicketFlowService');
const wo = require('../services/supportWorkOrderService');
const otp = require('../services/supportOtpService');
const { saveCondition, warehouseReceipt } = require('../services/supportReturnPickupService');

const ACTOR = 1; // superadmin
const TECH = 14; // Manish
const SERIAL_ID = 2092;
const TTSPL = 'TTSPL3597';
const SERIAL = 'FVFGCAL8Q05F';
const CUSTOMER_ID = 163;
const SITE_ID = 293;
const ISSUE_ID = 141; // LOG-RET-EOC
const ACTION_PICKUP = 14;
const RES_RET = 11; // Asset returned
const RC_WNE = 3; // Wear and tear
const GURGAON = { lat: 28.4126, lng: 77.0424 };

function todayIst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function insertAttachments(ticketId, woId, lineId, count, kind) {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const r = await pool.query(
      `INSERT INTO support_attachments (
         ticket_id, wo_id, line_id, kind, file_path, mime_type, original_name, uploaded_by
       ) VALUES ($1,$2,$3,$4,$5,'image/jpeg',$6,$7)
       RETURNING attachment_id`,
      [
        ticketId, woId, lineId, kind,
        `uploads/support-v2/demo-${TTSPL}-${kind}-${i + 1}.jpg`,
        `${kind.toLowerCase()}-${i + 1}.jpg`,
        ACTOR,
      ]
    );
    ids.push(r.rows[0].attachment_id);
  }
  return ids;
}

async function main() {
  console.log('=== TTSPL3597 return-pickup E2E ===');

  const existing = await pool.query(
    `SELECT t.ticket_id, t.ticket_number, t.status
       FROM support_tickets_v2 t
       JOIN support_ticket_assets a ON a.ticket_id = t.ticket_id
      WHERE a.serial_id = $1 AND t.status NOT IN ('CLOSED','CANCELLED')
      ORDER BY t.ticket_id DESC`,
    [SERIAL_ID]
  );
  let created;
  if (existing.rows[0]) {
    created = existing.rows[0];
    console.log('REUSING TICKET', created);
  } else {
    created = await createTicket(pool, {
      customer_id: CUSTOMER_ID,
      ticket_class: 'REQUEST',
      channel: 'INTERNAL',
      contact_name: 'Truetech Services Pvt. Ltd.',
      contact_phone: '9311770430',
      contact_email: 'warehouse+162@rentfoxxy.com',
      contact_source: 'CUSTOMER',
      site_id: SITE_ID,
      site_pincode: '122018',
      site_source: 'CRM_ADDRESS',
      subject: 'Demo return — TTSPL3597 end of demo / contract',
      internal_note: 'Staging E2E: return pickup of TTSPL3597 from customer 163 into warehouse.',
      photos_deferred: true,
      asset_lines: [{
        serial_id: SERIAL_ID,
        reported_issue_id: ISSUE_ID,
        reported_description: 'Laptop TTSPL3597 is on demo and should be collected back to warehouse.',
        impact: 2,
        urgency: 2,
        photos_deferred: true,
      }],
    }, ACTOR);
    console.log('TICKET', created);
  }

  const line = (await pool.query(
    'SELECT line_id FROM support_ticket_assets WHERE ticket_id = $1 ORDER BY line_id LIMIT 1',
    [created.ticket_id]
  )).rows[0];
  if (!line) throw new Error('Ticket created without asset line');
  console.log('LINE', line.line_id);

  const existingWo = (await pool.query(
    `SELECT * FROM support_work_orders
      WHERE ticket_id = $1 AND wo_type = 'RETURN_PICKUP'
        AND status NOT IN ('CANCELLED','FAILED')
      ORDER BY wo_id DESC LIMIT 1`,
    [created.ticket_id]
  )).rows[0];
  const date = todayIst();
  const createdWo = existingWo || await tx((c) => wo.createWorkOrder(c, created.ticket_id, {
    wo_type: 'RETURN_PICKUP',
    method: 'TECHNICIAN',
    line_ids: [line.line_id],
    assigned_to: TECH,
    slots: [{ date, start: '17:30', end: '18:30' }],
    notes: 'Staging E2E technician return pickup for TTSPL3597',
  }, ACTOR));
  if (existingWo) console.log('REUSING WO');
  console.log('WO', {
    wo_id: createdWo.wo_id,
    wo_number: createdWo.wo_number,
    status: createdWo.status,
    document_number: createdWo.document_number,
    hold_as_draft: createdWo.hold_as_draft,
  });

  if (createdWo.status === 'DRAFT' || createdWo.hold_as_draft) {
    const ap = (await pool.query(
      `SELECT approval_id FROM support_approvals
        WHERE wo_id = $1 AND approval_type = 'EARLY_TERMINATION' AND status = 'PENDING'`,
      [createdWo.wo_id]
    )).rows[0];
    if (ap) {
      await pool.query(
        `UPDATE support_approvals SET status = 'APPROVED', decided_by = $2, decided_at = NOW() WHERE approval_id = $1`,
        [ap.approval_id, ACTOR]
      );
    }
    await tx((c) => wo.advance(c, createdWo.wo_id, 'PENDING_ASSIGNMENT', ACTOR));
    await tx((c) => wo.assignWorkOrder(c, createdWo.wo_id, { userId: TECH }, ACTOR));
    console.log('WO released from lock-in draft');
  }

  const woId = createdWo.wo_id;
  const fresh = (await pool.query('SELECT status FROM support_work_orders WHERE wo_id = $1', [woId])).rows[0];
  const path = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'];
  let at = path.indexOf(fresh.status);
  if (at < 0 && fresh.status !== 'IN_PROGRESS' && fresh.status !== 'COMPLETED') {
    throw new Error(`Unexpected WO status ${fresh.status}`);
  }
  if (fresh.status === 'ASSIGNED') {
    await tx((c) => wo.advance(c, woId, 'ACCEPTED', ACTOR));
    at = 1;
  }
  if (at === 1) {
    await tx((c) => wo.advance(c, woId, 'EN_ROUTE', ACTOR));
    at = 2;
  }
  if (at === 2) {
    await tx(async (c) => {
      const advanced = await wo.advance(c, woId, 'ON_SITE', ACTOR);
      await otp.sendOtp(c, advanced.wo_id, ACTOR, {});
      return advanced;
    });
    at = 3;
  }
  if (at === 3) {
    const hasOtp = (await pool.query('SELECT customer_otp FROM support_work_orders WHERE wo_id = $1', [woId])).rows[0];
    if (!hasOtp.customer_otp) {
      await tx((c) => otp.sendOtp(c, woId, ACTOR, {}));
    }
    await tx((c) => wo.advance(c, woId, 'IN_PROGRESS', ACTOR));
  }
  console.log('WO advanced to IN_PROGRESS');

  const otpRow = (await pool.query(
    'SELECT customer_otp FROM support_work_orders WHERE wo_id = $1',
    [woId]
  )).rows[0];
  if (!otpRow || !otpRow.customer_otp) throw new Error('OTP was not stored on the work order');
  console.log('OTP sent (masked)');

  const photoIds = await insertAttachments(created.ticket_id, woId, line.line_id, 4, 'PHOTO_CONDITION');
  const [signId] = await insertAttachments(created.ticket_id, woId, line.line_id, 1, 'SIGNATURE');
  console.log('ATTACHMENTS', { photos: photoIds, signature: signId });

  const stepOrder = [
    { code: 'ON_SITE_GPS', payload: { ...GURGAON } },
    { code: 'SERIAL_SCAN', payload: { scanned_value: TTSPL, line_id: line.line_id } },
    {
      code: 'ACCESSORIES',
      payload: {
        line_id: line.line_id,
        items: [
          { code: 'CHARGER', label: 'Charger', checked: true },
          { code: 'BAG', label: 'Laptop bag', checked: true },
        ],
      },
    },
    { code: 'PHOTO_CONDITION', payload: { line_id: line.line_id, attachment_ids: photoIds } },
  ];

  const doneCodes = new Set((await pool.query(
    `SELECT step_code FROM support_work_order_steps WHERE wo_id = $1 AND status = 'DONE'`,
    [woId]
  )).rows.map((r) => r.step_code));

  for (const step of stepOrder) {
    if (doneCodes.has(step.code)) {
      console.log('STEP already done', step.code);
      continue;
    }
    await tx((c) => wo.completeStep(c, {
      woId, stepCode: step.code, payload: step.payload, userId: TECH,
    }));
    console.log('STEP', step.code);
  }

  if (!doneCodes.has('GRADE')) {
    await tx((c) => saveCondition(c, woId, {
      serial_id: SERIAL_ID,
      grade: 'A',
      accessories: { CHARGER: { status: 'PRESENT' }, BAG: { status: 'PRESENT' } },
      damage_items: [],
      notes: 'Demo unit collected in like-new condition.',
      attachment_ids: photoIds,
    }, TECH));
    await tx((c) => wo.completeStep(c, {
      woId, stepCode: 'GRADE', payload: { line_id: line.line_id, grade: 'A' }, userId: TECH,
    }));
    console.log('STEP GRADE');
  }

  if (!doneCodes.has('CUSTOMER_OTP')) {
    await tx((c) => wo.completeStep(c, {
      woId, stepCode: 'CUSTOMER_OTP', payload: { otp: otpRow.customer_otp }, userId: TECH,
    }));
    console.log('STEP CUSTOMER_OTP');
  }

  if (!doneCodes.has('TECH_ESIGN')) {
    await tx((c) => wo.completeStep(c, {
      woId, stepCode: 'TECH_ESIGN', payload: { attachment_id: signId }, userId: TECH,
    }));
    console.log('STEP TECH_ESIGN');
  }

  const beforeComplete = (await pool.query(
    'SELECT status FROM support_work_orders WHERE wo_id = $1',
    [woId]
  )).rows[0];
  const completed = beforeComplete.status === 'COMPLETED'
    ? beforeComplete
    : await tx((c) => wo.completeWorkOrder(c, woId, {
      found_issue_id: ISSUE_ID,
      action_code_ids: [ACTION_PICKUP],
      outcome: 'RESOLVED',
      notes: 'Collected TTSPL3597 from demo customer and moving it to warehouse.',
      time_spent_minutes: 45,
    }, TECH));
  console.log('WO COMPLETE', {
    wo_id: completed.wo_id,
    status: completed.status,
    document_number: completed.document_number,
    billing_stop_date: completed.billing_stop_date,
  });

  const mid = (await pool.query(
    `SELECT inventory_status, qc_status, current_customer_id
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [SERIAL_ID]
  )).rows[0];
  console.log('INVENTORY AFTER COMPLETE', mid);

  const receipt = await tx((c) => warehouseReceipt(c, woId, {
    serial_ids: [SERIAL_ID],
    scanned: true,
    signer_name: 'Warehouse Receiving — Staging E2E',
  }, ACTOR));
  console.log('WAREHOUSE RECEIPT', receipt);

  const ticketState = await resolveLine(pool, line.line_id, {
    found_issue_id: ISSUE_ID,
    resolution_code_id: RES_RET,
    root_cause_id: RC_WNE,
    liability: 'NONE',
    action_code_ids: [ACTION_PICKUP],
    resolution_notes: 'Demo laptop collected and received in warehouse. Ready for floor QC.',
    time_spent_minutes: 45,
  }, ACTOR, false);
  console.log('TICKET RESOLVED', ticketState);

  const ticket = (await pool.query(
    `SELECT ticket_id, ticket_number, status FROM support_tickets_v2 WHERE ticket_id = $1`,
    [created.ticket_id]
  )).rows[0];
  const work = (await pool.query(
    `SELECT wo_id, wo_number, status, document_number, floor_ticket_id, outcome
       FROM support_work_orders WHERE wo_id = $1`,
    [woId]
  )).rows[0];
  const whr = (await pool.query(
    `SELECT receipt_number, status FROM support_warehouse_receipts WHERE wo_id = $1 ORDER BY receipt_id DESC LIMIT 1`,
    [woId]
  )).rows[0];
  const serial = (await pool.query(
    `SELECT inventory_asset_code, serial_number, inventory_status, qc_status, current_customer_id
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [SERIAL_ID]
  )).rows[0];
  const floor = work.floor_ticket_id
    ? (await pool.query(
      `SELECT ticket_id, status, ticket_type, assigned_user_id, current_stage_id
         FROM tickets WHERE ticket_id = $1`,
      [work.floor_ticket_id]
    )).rows[0]
    : null;

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({
    laptop: TTSPL,
    serial,
    ticket,
    work_order: work,
    warehouse_receipt: whr,
    floor_ticket: floor,
    customer_url: `https://staging.rentfoxxy.com/lead-crm/customers/${CUSTOMER_ID}`,
    ticket_url: `https://staging.rentfoxxy.com/support/tickets/${ticket.ticket_id}`,
    job_url: `https://staging.rentfoxxy.com/support/jobs/${work.wo_id}`,
  }, null, 2));
}

main()
  .catch((e) => {
    console.error('FAILED', e.message);
    if (e.missing) console.error('missing', e.missing);
    if (e.errors) console.error('errors', e.errors);
    if (e.stack) console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
