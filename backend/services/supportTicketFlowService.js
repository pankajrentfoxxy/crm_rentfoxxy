'use strict';

const { computePriority } = require('./supportPriorityService');
const { recalcTicketSla, pauseSla, resumeSla } = require('./supportSlaService');
const { nextStkNumber } = require('./supportNumberService');
const {
  computeTicketStatus,
  computeAssetLineStatus,
  logEvent,
  forceTicketStatus,
} = require('./supportTicketStateService');
const { enqueueEmail } = require('./emailQueueService');

const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const OPEN = `('NEW','TRIAGED','ASSIGNED','IN_PROGRESS','PENDING')`;

function lineCode(i) {
  return `A${i + 1}`;
}

async function catalogChain(db, issueId) {
  const issue = (await db.query(
    'SELECT catalog_id, parent_id, code, name, is_safety, chargeable_default, requires_photo, default_wo_type, skill_required FROM support_issue_catalog WHERE catalog_id = $1',
    [issueId]
  )).rows[0];
  if (!issue || !issue.parent_id) return null;
  const subtype = (await db.query(
    'SELECT catalog_id, parent_id, code, name FROM support_issue_catalog WHERE catalog_id = $1',
    [issue.parent_id]
  )).rows[0];
  if (!subtype || !subtype.parent_id) return null;
  const type = (await db.query(
    'SELECT catalog_id, code, name FROM support_issue_catalog WHERE catalog_id = $1',
    [subtype.parent_id]
  )).rows[0];
  if (!type) return null;
  return { issue, subtype, type };
}

async function findRepeat(db, serialId, subtypeId, excludeTicketId) {
  if (!serialId || !subtypeId) return null;
  const r = await db.query(
    `SELECT t.ticket_id, t.ticket_number
       FROM support_ticket_assets a
       JOIN support_tickets_v2 t ON t.ticket_id = a.ticket_id
      WHERE a.serial_id = $1
        AND a.reported_subtype_id = $2
        AND t.status IN ('RESOLVED','CLOSED')
        AND COALESCE(t.resolved_at, t.closed_at) >= NOW() - INTERVAL '30 days'
        AND ($3::int IS NULL OR t.ticket_id <> $3)
      ORDER BY COALESCE(t.resolved_at, t.closed_at) DESC
      LIMIT 1`,
    [serialId, subtypeId, excludeTicketId || null]
  );
  return r.rows[0] || null;
}

async function loadCustomer(db, customerId) {
  const r = await db.query(
    `SELECT customer_id, name, company_name, email, phone, support_tier
       FROM customers WHERE customer_id = $1`,
    [customerId]
  );
  return r.rows[0] || null;
}

function validateResolveLine(body) {
  const missing = [];
  if (!body.found_issue_id) missing.push('found_issue_id');
  if (!body.resolution_code_id) missing.push('resolution_code_id');
  if (!body.root_cause_id) missing.push('root_cause_id');
  if (!body.liability) missing.push('liability');
  if (!Array.isArray(body.action_code_ids) || !body.action_code_ids.length) missing.push('action_code_ids');
  if (!body.resolution_notes || String(body.resolution_notes).trim().length < 20) missing.push('resolution_notes');
  return missing;
}

const PAUSE_CONTACT_METHODS = new Set(['CALL', 'EMAIL', 'WHATSAPP']);

function normalizePauseContactMethod(method) {
  const raw = String(method || '').toUpperCase();
  if (raw === 'PHONE') return 'CALL';
  return raw;
}

function validatePause(body) {
  const reason = String(body.reason || '').toUpperCase();
  if (reason !== 'PENDING_CUSTOMER') return null;
  const method = normalizePauseContactMethod(body.contact_method);
  if (!PAUSE_CONTACT_METHODS.has(method)) {
    return 'contact_method is required when pausing for the customer (CALL, EMAIL, or WHATSAPP)';
  }
  const ref = String(body.contact_reference || body.reference || '').trim();
  if (!ref) return 'contact_reference is required when pausing for the customer';
  return null;
}

function nextPauseStreak(current) {
  return (Number(current) || 0) + 1;
}

function shouldFlagPauseAbuse(streak) {
  return Number(streak) >= 3;
}

function reopenWindowError(closedAt, now = new Date(), days = 7) {
  if (!closedAt) return null;
  const windowDays = Number(days) || 7;
  const ageMs = now.getTime() - new Date(closedAt).getTime();
  if (ageMs > windowDays * 86400000) return `Reopen window is ${windowDays} days`;
  return null;
}

function ticketResolveBlockers(lines, workOrders) {
  const blockers = [];
  for (const l of lines || []) {
    if (l.line_status === 'CANCELLED') continue;
    const missing = [];
    if (!l.resolution_code_id) missing.push('resolution_code');
    if (!l.root_cause_id) missing.push('root_cause');
    if (!l.liability) missing.push('liability');
    if (l.line_status !== 'RESOLVED' && !missing.length) missing.push('line_not_resolved');
    if (missing.length || l.line_status !== 'RESOLVED') {
      blockers.push({ line_code: l.line_code, missing: missing.length ? missing : ['line_not_resolved'] });
    }
  }
  for (const w of workOrders || []) {
    if (!['COMPLETED', 'CANCELLED'].includes(w.status)) {
      blockers.push({ wo_number: w.wo_number, status: w.status });
    }
  }
  return blockers;
}

function validateCreate(body) {
  const errors = {};
  const lines = Array.isArray(body.asset_lines) ? body.asset_lines : [];
  if (!body.customer_id) errors.customer_id = ['customer_id is required'];
  if (!body.channel) errors.channel = ['channel is required'];
  if (!body.contact_name) errors.contact_name = ['contact_name is required'];
  const phone = String(body.contact_phone || '').replace(/\D/g, '').slice(-10);
  if (!INDIAN_MOBILE.test(phone)) errors.contact_phone = ['valid Indian mobile required'];
  if (!lines.length) errors.asset_lines = ['at least one machine is required'];
  const lineErrors = {};
  lines.forEach((line, i) => {
    const e = [];
    if (!line.asset_unknown && !line.serial_id && !line.reported_issue_id) {
      /* still require classification even for unknown */
    }
    if (!line.reported_issue_id) e.push('reported_issue_id is required');
    if (!line.reported_description || String(line.reported_description).trim().length < 15) {
      e.push('reported_description too short');
    }
    if (e.length) lineErrors[i] = e;
  });
  if (Object.keys(lineErrors).length) {
    return { ok: false, message: 'Every machine must be classified', errors: lineErrors };
  }
  if (Object.keys(errors).length) {
    return { ok: false, message: 'Invalid ticket', errors };
  }
  return { ok: true, phone };
}

async function createTicket(db, body, actorId) {
  const v = validateCreate(body);
  if (!v.ok) {
    const err = Object.assign(new Error(v.message), { status: 400, errors: v.errors });
    throw err;
  }
  const customer = await loadCustomer(db, body.customer_id);
  if (!customer) throw Object.assign(new Error('Customer not found'), { status: 400 });

  if (body.site_id) {
    const site = await db.query(
      'SELECT customer_address_id FROM customer_addresses WHERE customer_address_id = $1 AND customer_id = $2',
      [body.site_id, body.customer_id]
    );
    if (!site.rows[0]) throw Object.assign(new Error('Site does not belong to this customer'), { status: 400 });
  }

  const prepared = [];
  for (const line of body.asset_lines) {
    const chain = await catalogChain(db, line.reported_issue_id);
    if (!chain) throw Object.assign(new Error('Invalid reported_issue_id'), { status: 400 });
    if (line.serial_id) {
      const ser = await db.query(
        `SELECT serial_id, inventory_asset_code, serial_number, current_customer_id
           FROM vendor_serial_numbers
          WHERE serial_id = $1 AND deleted_at IS NULL`,
        [line.serial_id]
      );
      if (!ser.rows[0]) throw Object.assign(new Error('Serial not found'), { status: 400 });
      if (Number(ser.rows[0].current_customer_id) !== Number(body.customer_id)) {
        throw Object.assign(new Error('Serial does not belong to this customer'), { status: 400 });
      }
      line._serial = ser.rows[0];
    }
    const repeat = await findRepeat(db, line.serial_id, chain.subtype.catalog_id, null);
    const pri = computePriority({
      impact: Number(line.impact) || 2,
      urgency: Number(line.urgency) || 2,
      supportTier: customer.support_tier,
      isSafety: chain.issue.is_safety,
      isRepeat: Boolean(repeat),
      contactIsVip: Boolean(body.contact_is_vip),
      isSlaComplaint: chain.type.code === 'SVC' && chain.subtype.code === 'SVC-SLA',
    });
    prepared.push({ line, chain, repeat, pri });
  }

  const ticketPriority = Math.min(...prepared.map((p) => p.pri.priority));
  const allReasons = prepared.flatMap((p) => p.pri.reasons);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const number = await nextStkNumber(client);
    const ins = await client.query(
      `INSERT INTO support_tickets_v2 (
         ticket_number, ticket_class, channel, status, priority, impact, urgency,
         customer_id, site_id, site_label, contact_name, contact_phone, contact_email,
         contact_is_vip, subject, assignment_group_id, assigned_to,
         preferred_slot_start, preferred_slot_end, internal_note, created_by
       ) VALUES (
         $1,$2,$3,'NEW',$4,$5,$6,
         $7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16,
         $17,$18,$19,$20
       ) RETURNING *`,
      [
        number,
        body.ticket_class || 'INCIDENT',
        body.channel,
        ticketPriority,
        prepared[0].line.impact || 2,
        prepared[0].line.urgency || 2,
        body.customer_id,
        body.site_id || null,
        body.site_label || null,
        body.contact_name,
        v.phone,
        body.contact_email || null,
        Boolean(body.contact_is_vip),
        body.subject || `${prepared.length} machine(s) — ${customer.company_name || customer.name}`,
        body.assignment_group_id || null,
        body.assigned_to || null,
        body.preferred_slot_start || null,
        body.preferred_slot_end || null,
        body.internal_note || null,
        actorId || null,
      ]
    );
    const ticket = ins.rows[0];

    for (let i = 0; i < prepared.length; i += 1) {
      const p = prepared[i];
      const serial = p.line._serial;
      const lineIns = await client.query(
        `INSERT INTO support_ticket_assets (
           ticket_id, line_code, serial_id, ttspl_id, serial_number, asset_unknown,
           reported_type_id, reported_subtype_id, reported_issue_id, reported_description,
           impact, urgency, is_repeat, repeat_of_ticket_id, is_safety, line_status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'OPEN')
         RETURNING line_id`,
        [
          ticket.ticket_id,
          lineCode(i),
          p.line.serial_id || (serial && serial.serial_id) || null,
          p.line.ttspl_id || (serial && serial.inventory_asset_code) || null,
          p.line.serial_number || (serial && serial.serial_number) || null,
          Boolean(p.line.asset_unknown),
          p.chain.type.catalog_id,
          p.chain.subtype.catalog_id,
          p.chain.issue.catalog_id,
          String(p.line.reported_description).trim(),
          Number(p.line.impact) || 2,
          Number(p.line.urgency) || 2,
          Boolean(p.repeat),
          p.repeat ? p.repeat.ticket_id : null,
          Boolean(p.chain.issue.is_safety),
        ]
      );
      if (p.repeat) {
        await client.query(
          `INSERT INTO support_ticket_links (from_ticket_id, to_ticket_id, link_type, created_by)
           VALUES ($1,$2,'REPEAT_OF',$3)
           ON CONFLICT DO NOTHING`,
          [ticket.ticket_id, p.repeat.ticket_id, actorId || null]
        );
      }
      const ids = p.line.attachment_ids || [];
      if (ids.length) {
        await client.query(
          `UPDATE support_attachments SET ticket_id = $1, line_id = $2 WHERE attachment_id = ANY($3::int[])`,
          [ticket.ticket_id, lineIns.rows[0].line_id, ids]
        );
      }
      await logEvent(client, {
        ticketId: ticket.ticket_id,
        lineId: lineIns.rows[0].line_id,
        eventType: 'LINE_ADDED',
        actorId,
        summary: `${lineCode(i)} added`,
      });
    }

    if (body.link && body.link.target_ticket_id && body.link.link_type) {
      await client.query(
        `INSERT INTO support_ticket_links (from_ticket_id, to_ticket_id, link_type, created_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [ticket.ticket_id, body.link.target_ticket_id, body.link.link_type, actorId || null]
      );
    }

    await logEvent(client, {
      ticketId: ticket.ticket_id,
      eventType: 'TICKET_CREATED',
      actorId,
      summary: `Created ${number}`,
      isCustomerVisible: true,
    });
    await logEvent(client, {
      ticketId: ticket.ticket_id,
      eventType: 'PRIORITY_COMPUTED',
      actorKind: 'SYSTEM',
      summary: `Priority P${ticketPriority}`,
      detail: { priority: ticketPriority, reasons: allReasons },
    });

    const sla = await recalcTicketSla(client, ticket.ticket_id, {
      customerId: body.customer_id,
      ticketClass: body.ticket_class || 'INCIDENT',
      priority: ticketPriority,
      supportTier: customer.support_tier,
    });
    await logEvent(client, {
      ticketId: ticket.ticket_id,
      eventType: 'SLA_SET',
      actorKind: 'SYSTEM',
      summary: `SLA ${sla.policy && sla.policy.name}`,
      detail: {
        response_due_at: sla.sla_response_due_at,
        resolution_due_at: sla.sla_resolution_due_at,
      },
    });

    await computeTicketStatus(client, ticket.ticket_id);
    await client.query('COMMIT');

    if (body.contact_email || customer.email) {
      enqueueEmail({
        toEmail: body.contact_email || customer.email,
        subject: `Support ticket ${number} logged`,
        bodyText: `We have logged ${number}: ${ticket.subject || ''}\nWe will update you as we progress.`,
        dedupeKey: `stk-created-${ticket.ticket_id}`,
      }).catch((e) => console.error('createTicket email:', e));
    }

    return { ticket_id: ticket.ticket_id, ticket_number: number, priority: ticketPriority, reasons: allReasons };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function resolveLine(db, lineId, body, actorId, canCharge) {
  const missing = validateResolveLine(body);
  if (missing.length) {
    throw Object.assign(new Error('Resolve fields incomplete'), { status: 400, missing });
  }
  if (body.liability === 'CUSTOMER_CHARGEABLE') {
    if (!canCharge) throw Object.assign(new Error('support_charges permission required'), { status: 403 });
    if (!(Number(body.chargeable_amount) > 0)) {
      throw Object.assign(new Error('chargeable_amount required'), { status: 400 });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const line = (await client.query(
      `SELECT a.*, t.customer_id, t.ticket_id
         FROM support_ticket_assets a
         JOIN support_tickets_v2 t ON t.ticket_id = a.ticket_id
        WHERE a.line_id = $1`,
      [lineId]
    )).rows[0];
    if (!line) throw Object.assign(new Error('Line not found'), { status: 404 });

    if (body.liability === 'CUSTOMER_CHARGEABLE') {
      const photos = await client.query(
        `SELECT 1 FROM support_attachments
          WHERE line_id = $1 AND kind ILIKE 'PHOTO%'
          LIMIT 1`,
        [lineId]
      );
      if (!photos.rows[0]) {
        throw Object.assign(new Error('Photo evidence required for a chargeable line'), { status: 400 });
      }
    }

    const found = await catalogChain(client, body.found_issue_id);
    if (!found) throw Object.assign(new Error('Invalid found_issue_id'), { status: 400 });

    await client.query(
      `UPDATE support_ticket_assets SET
         found_type_id = $2, found_subtype_id = $3, found_issue_id = $4,
         resolution_code_id = $5, root_cause_id = $6, liability = $7,
         chargeable_amount = $8, resolution_notes = $9, time_spent_minutes = $10,
         updated_at = NOW()
       WHERE line_id = $1`,
      [
        lineId, found.type.catalog_id, found.subtype.catalog_id, found.issue.catalog_id,
        body.resolution_code_id, body.root_cause_id, body.liability,
        body.chargeable_amount || null, String(body.resolution_notes).trim(),
        body.time_spent_minutes || null,
      ]
    );

    if (Number(found.issue.catalog_id) !== Number(line.reported_issue_id)) {
      await logEvent(client, {
        ticketId: line.ticket_id,
        lineId,
        eventType: 'RECLASSIFIED',
        actorId,
        summary: `Found ${found.issue.name} (reported was different)`,
        detail: { reported_issue_id: line.reported_issue_id, found_issue_id: found.issue.catalog_id },
      });
    }

    for (const actionId of body.action_code_ids) {
      const wo = await client.query(
        `SELECT w.wo_id FROM support_work_orders w
           JOIN support_work_order_assets a ON a.wo_id = w.wo_id
          WHERE a.line_id = $1 LIMIT 1`,
        [lineId]
      );
      if (wo.rows[0]) {
        await client.query(
          `INSERT INTO support_work_order_actions (wo_id, action_code_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [wo.rows[0].wo_id, actionId]
        );
      }
    }

    if (body.liability === 'CUSTOMER_CHARGEABLE') {
      await client.query(
        `INSERT INTO customer_invoice_extra_lines (
           ticket_id, line_id, customer_id, charge_type, description, amount, status
         ) VALUES ($1,$2,$3,'SUPPORT_CHARGE',$4,$5,'PENDING')`,
        [line.ticket_id, lineId, line.customer_id, line.resolution_notes, body.chargeable_amount]
      );
      await client.query(
        `INSERT INTO support_approvals (
           ticket_id, line_id, approval_type, status, amount, label, requested_by, customer_side
         ) VALUES ($1,$2,'DAMAGE_CHARGE','PENDING',$3,$4,$5,true)`,
        [line.ticket_id, lineId, body.chargeable_amount, `Chargeable · ₹${body.chargeable_amount}`, actorId]
      );
      await client.query(
        `UPDATE support_tickets_v2 SET pending_reason = 'PENDING_APPROVAL', updated_at = NOW()
          WHERE ticket_id = $1`,
        [line.ticket_id]
      );
    }
    if (body.liability === 'VENDOR_WARRANTY') {
      await client.query(
        `INSERT INTO vendor_warranty_claims (ticket_id, line_id, serial_id, status, notes)
         VALUES ($1,$2,$3,'OPEN',$4)`,
        [line.ticket_id, lineId, line.serial_id, body.resolution_notes]
      );
    }

    await logEvent(client, {
      ticketId: line.ticket_id,
      lineId,
      eventType: 'LINE_RESOLVED',
      actorId,
      summary: `Resolved ${line.line_code}`,
      isCustomerVisible: true,
    });
    await computeAssetLineStatus(client, lineId);
    const ticketState = await computeTicketStatus(client, line.ticket_id);
    await client.query('COMMIT');
    return ticketState;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  createTicket,
  resolveLine,
  catalogChain,
  findRepeat,
  loadCustomer,
  validateCreate,
  validateResolveLine,
  validatePause,
  normalizePauseContactMethod,
  nextPauseStreak,
  shouldFlagPauseAbuse,
  reopenWindowError,
  ticketResolveBlockers,
  INDIAN_MOBILE,
  OPEN,
  pauseSla,
  resumeSla,
  forceTicketStatus,
  computeTicketStatus,
  logEvent,
  recalcTicketSla,
};
