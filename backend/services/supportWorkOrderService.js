'use strict';

const { nextWoNumber } = require('./supportNumberService');
const { instantiateWoSteps } = require('./supportWorkOrderSteps');
const { computeTicketStatus, computeAssetLineStatus, logEvent } = require('./supportTicketStateService');
const { catalogChain } = require('./supportTicketFlowService');
const effects = require('./workOrderEffects');

const TRANSITIONS = {
  DRAFT: ['PENDING_ASSIGNMENT', 'CANCELLED'],
  PENDING_ASSIGNMENT: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'PENDING_ASSIGNMENT', 'CANCELLED'],
  ACCEPTED: ['EN_ROUTE', 'ON_SITE', 'FAILED', 'CANCELLED'],
  EN_ROUTE: ['ON_SITE', 'FAILED', 'CANCELLED'],
  ON_SITE: ['IN_PROGRESS', 'FAILED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

const FAIL_REASONS = new Set([
  'CUSTOMER_UNAVAILABLE', 'SITE_ACCESS_DENIED', 'WRONG_PART', 'PART_FAULTY',
  'UNIT_NOT_READY', 'INSUFFICIENT_TIME', 'SAFETY_CONCERN', 'VEHICLE_BREAKDOWN', 'OTHER',
]);

const WO_TYPE_SECTION = {
  FIELD_VISIT: 'support_field_visit',
  REMOTE_FIX: 'support_field_visit',
  REPAIR_PICKUP: 'support_pickup_repair',
  SERVICE_RETURN: 'support_pickup_repair',
  RETURN_PICKUP: 'support_pickup_return',
  REPLACEMENT_DELIVERY: 'support_replacement',
  PART_DELIVERY: 'support_parts_request',
  PART_RETURN: 'support_parts_request',
};

function assertTransition(from, to, { skipsTravel } = {}) {
  const allowed = [...(TRANSITIONS[from] || [])];
  if (skipsTravel && from === 'ACCEPTED' && !allowed.includes('IN_PROGRESS')) {
    allowed.push('IN_PROGRESS');
  }
  if (skipsTravel && (to === 'EN_ROUTE' || to === 'ON_SITE')) {
    throw Object.assign(new Error(`Cannot move work order from ${from} to ${to}`), { status: 409 });
  }
  if (!allowed.includes(to)) {
    throw Object.assign(new Error(`Cannot move work order from ${from} to ${to}`), { status: 409 });
  }
}

async function typeSkipsTravel(client, woType) {
  const r = await client.query(
    `SELECT BOOL_OR(skips_travel) AS skips FROM support_work_order_type_config WHERE wo_type = $1`,
    [woType]
  );
  return Boolean(r.rows[0] && r.rows[0].skips);
}

async function loadWo(client, woId, { forUpdate } = {}) {
  const r = await client.query(
    `SELECT w.*, t.customer_id, t.ticket_number
       FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
      WHERE w.wo_id = $1
      ${forUpdate ? 'FOR UPDATE OF w' : ''}`,
    [woId]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Work order not found'), { status: 404 });
  return r.rows[0];
}

async function setStatus(client, wo, to, { actorId, summary, detail } = {}) {
  const skipsTravel = await typeSkipsTravel(client, wo.wo_type);
  assertTransition(wo.status, to, { skipsTravel });
  await client.query(
    `UPDATE support_work_orders
        SET status = $2::varchar,
            accepted_at = CASE WHEN $2::text = 'ACCEPTED' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
            en_route_at = CASE WHEN $2::text = 'EN_ROUTE' THEN COALESCE(en_route_at, NOW()) ELSE en_route_at END,
            on_site_at = CASE WHEN $2::text = 'ON_SITE' THEN COALESCE(on_site_at, NOW()) ELSE on_site_at END,
            completed_at = CASE WHEN $2::text = 'COMPLETED' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            updated_at = NOW()
      WHERE wo_id = $1`,
    [wo.wo_id, to]
  );
  await logEvent(client, {
    ticketId: wo.ticket_id,
    woId: wo.wo_id,
    eventType: 'WO_STATUS_CHANGED',
    actorId,
    summary: summary || `${wo.wo_number} ${wo.status} → ${to}`,
    detail: { from: wo.status, to, ...(detail || {}) },
  });
  wo.status = to;
  return wo;
}

function validateStepPayload(step, payload, wo, assets) {
  const p = payload || {};
  const kind = step.step_kind;
  if (kind === 'GPS') {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') {
      throw Object.assign(new Error('GPS payload needs numeric lat/lng'), { status: 400 });
    }
  } else if (kind === 'SCAN') {
    const scanned = String(p.scanned_value || '').trim();
    const expected = String(p.expected_value || assets[0]?.ttspl_id || assets[0]?.serial_number || '').trim();
    if (!scanned) throw Object.assign(new Error('scanned_value required'), { status: 400 });
    const ok = assets.some((a) => (
      scanned === String(a.ttspl_id || '')
      || scanned === String(a.serial_number || '')
      || scanned === String(a.serial_id || '')
    )) || (expected && scanned === expected);
    if (!ok) {
      throw Object.assign(new Error('ASSET_MISMATCH'), { status: 409, code: 'ASSET_MISMATCH' });
    }
  } else if (kind === 'PHOTO') {
    const ids = p.attachment_ids || [];
    if (!Array.isArray(ids) || ids.length < (step.min_count || 1)) {
      throw Object.assign(new Error(`Need at least ${step.min_count || 1} photos`), { status: 400 });
    }
  } else if (kind === 'CHECKLIST') {
    const items = p.items || [];
    if (!items.length || items.some((i) => i.checked !== true && i.checked !== false)) {
      throw Object.assign(new Error('Every checklist item must be answered'), { status: 400 });
    }
  } else if (kind === 'OTP') {
    if (String(p.otp || '') !== String(wo.customer_otp || '')) {
      throw Object.assign(new Error('OTP does not match'), { status: 400 });
    }
  } else if (kind === 'SIGNATURE') {
    if (!p.attachment_id) throw Object.assign(new Error('signature attachment_id required'), { status: 400 });
  }
}

async function instantiateSteps(client, woId, woType) {
  return instantiateWoSteps(client, woId, woType);
}

async function completeStep(client, { woId, stepCode, payload, userId }) {
  const wo = await loadWo(client, woId, { forUpdate: true });
  const step = (await client.query(
    `SELECT * FROM support_work_order_steps WHERE wo_id = $1 AND step_code = $2`,
    [woId, stepCode]
  )).rows[0];
  if (!step) throw Object.assign(new Error('Step not found'), { status: 404 });
  const assets = (await client.query(
    `SELECT a.serial_id, a.ttspl_id, a.serial_number, a.line_id
       FROM support_work_order_assets l
       JOIN support_ticket_assets a ON a.line_id = l.line_id
      WHERE l.wo_id = $1`,
    [woId]
  )).rows;
  validateStepPayload(step, payload, wo, assets);
  if (step.step_kind === 'OTP') {
    await client.query(
      `UPDATE support_work_orders SET otp_verified_at = NOW() WHERE wo_id = $1`,
      [woId]
    );
  }
  await client.query(
    `UPDATE support_work_order_steps
        SET status = 'DONE', payload = $3, completed_at = NOW(), completed_by = $4
      WHERE wo_id = $1 AND step_code = $2`,
    [woId, stepCode, JSON.stringify(payload || {}), userId || null]
  );
  const effect = effects[wo.wo_type];
  let extra = null;
  if (effect && effect.onStep) extra = await effect.onStep(client, wo, step, payload);
  await logEvent(client, {
    ticketId: wo.ticket_id,
    woId,
    eventType: 'WO_STEP_DONE',
    actorId: userId,
    summary: `${step.step_label} done`,
    detail: { step_code: stepCode },
  });
  return { ok: true, step_code: stepCode, extra };
}

async function checkMandatorySteps(client, woId) {
  const r = await client.query(
    `SELECT step_code FROM support_work_order_steps
      WHERE wo_id = $1 AND is_mandatory = TRUE AND status <> 'DONE'
      ORDER BY sort_order`,
    [woId]
  );
  const missing = r.rows.map((x) => x.step_code);
  return { ok: missing.length === 0, missing };
}

async function createWorkOrder(client, ticketId, body, actorId) {
  const woType = String(body.wo_type || '').toUpperCase();
  if (!WO_TYPE_SECTION[woType]) {
    throw Object.assign(new Error('Invalid wo_type'), { status: 400 });
  }
  const lineIds = (body.line_ids || []).map(Number).filter(Boolean);
  if (!lineIds.length) throw Object.assign(new Error('line_ids required'), { status: 400 });
  const ticket = (await client.query(
    'SELECT * FROM support_tickets_v2 WHERE ticket_id = $1',
    [ticketId]
  )).rows[0];
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  const lines = (await client.query(
    `SELECT * FROM support_ticket_assets WHERE ticket_id = $1 AND line_id = ANY($2::int[])`,
    [ticketId, lineIds]
  )).rows;
  if (lines.length !== lineIds.length) {
    throw Object.assign(new Error('One or more lines do not belong to this ticket'), { status: 400 });
  }
  const number = await nextWoNumber(client);
  const assignedTo = body.assigned_to || null;
  const initial = body.hold_as_draft ? 'DRAFT' : (assignedTo ? 'ASSIGNED' : 'PENDING_ASSIGNMENT');
  const slotStart = body.slot_start || body.scheduled_start || null;
  const slotEnd = body.slot_end || body.scheduled_end || null;
  const ins = await client.query(
    `INSERT INTO support_work_orders (
       wo_number, ticket_id, wo_type, status, assigned_to, assignment_group_id,
       scheduled_start, scheduled_end, method, notes,
       replacement_group_id, linked_wo_id,
       slot_start, slot_end, priority, sla_due_at, distance_km
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      number, ticketId, woType, initial, assignedTo, body.assignment_group_id || null,
      slotStart, slotEnd,
      body.method || null, body.notes || null,
      body.replacement_group_id || null, body.linked_wo_id || null,
      slotStart, slotEnd, ticket.priority || null, ticket.sla_resolution_due_at || null,
      body.distance_km != null ? Number(body.distance_km) : null,
    ]
  );
  const wo = ins.rows[0];
  for (const lineId of lineIds) {
    await client.query(
      `INSERT INTO support_work_order_assets (wo_id, line_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [wo.wo_id, lineId]
    );
  }
  await instantiateSteps(client, wo.wo_id, woType);
  await logEvent(client, {
    ticketId,
    woId: wo.wo_id,
    eventType: 'WO_CREATED',
    actorId,
    summary: `Created ${number} (${woType})`,
  });
  const effect = effects[woType];
  let extra = {};
  if (effect && effect.onCreate) extra = (await effect.onCreate(client, { ...wo, created_by: actorId })) || {};
  for (const line of lines) {
    await computeAssetLineStatus(client, line.line_id);
  }
  await computeTicketStatus(client, ticketId);
  const fresh = await loadWo(client, wo.wo_id);
  return { ...fresh, ...extra };
}

async function assignWorkOrder(client, woId, { userId, groupId, slot_start, slot_end }, actorId) {
  const wo = await loadWo(client, woId, { forUpdate: true });
  await client.query(
    `UPDATE support_work_orders
        SET assigned_to = $2,
            assignment_group_id = COALESCE($3, assignment_group_id),
            slot_start = COALESCE($4, slot_start),
            slot_end = COALESCE($5, slot_end),
            scheduled_start = COALESCE($4, scheduled_start),
            scheduled_end = COALESCE($5, scheduled_end),
            updated_at = NOW()
      WHERE wo_id = $1`,
    [woId, userId || null, groupId || null, slot_start || null, slot_end || null]
  );
  if (userId && (wo.status === 'DRAFT' || wo.status === 'PENDING_ASSIGNMENT')) {
    await setStatus(client, { ...wo, assigned_to: userId }, 'ASSIGNED', { actorId, summary: `Assigned ${wo.wo_number}` });
  } else if (!userId && wo.status === 'ASSIGNED') {
    await setStatus(client, wo, 'PENDING_ASSIGNMENT', { actorId, summary: `Unassigned ${wo.wo_number}` });
  }
  const effect = effects[wo.wo_type];
  if (effect && effect.onAssign) await effect.onAssign(client, wo, { userId, groupId });
  await computeTicketStatus(client, wo.ticket_id);
  return loadWo(client, woId);
}

async function advance(client, woId, to, actorId, extra = {}) {
  const wo = await loadWo(client, woId, { forUpdate: true });
  await setStatus(client, wo, to, { actorId, detail: extra });
  await computeTicketStatus(client, wo.ticket_id);
  return loadWo(client, woId);
}

async function verifyOtp(client, woId, otp, userId) {
  return completeStep(client, { woId, stepCode: 'CUSTOMER_OTP', payload: { otp }, userId });
}

async function completeWorkOrder(client, woId, body, actorId) {
  const wo = await loadWo(client, woId, { forUpdate: true });
  const skipsTravel = await typeSkipsTravel(client, wo.wo_type);
  if (wo.status === 'ON_SITE' || (skipsTravel && wo.status === 'ACCEPTED')) {
    await setStatus(client, wo, 'IN_PROGRESS', { actorId, summary: `Started ${wo.wo_number}` });
  }
  const gate = await checkMandatorySteps(client, woId);
  if (!gate.ok) {
    throw Object.assign(new Error('Mandatory steps incomplete'), { status: 409, missing: gate.missing });
  }
  if (!body.found_issue_id) throw Object.assign(new Error('found_issue_id required'), { status: 400 });
  if (!Array.isArray(body.action_code_ids) || !body.action_code_ids.length) {
    throw Object.assign(new Error('action_code_ids required'), { status: 400 });
  }
  if (!body.notes || String(body.notes).trim().length < 20) {
    throw Object.assign(new Error('notes must be at least 20 characters'), { status: 400 });
  }
  if (!body.outcome) throw Object.assign(new Error('outcome required'), { status: 400 });
  const chain = await catalogChain(client, body.found_issue_id);
  if (!chain) throw Object.assign(new Error('Invalid found_issue_id'), { status: 400 });
  const assets = (await client.query(
    `SELECT a.line_id FROM support_work_order_assets l
       JOIN support_ticket_assets a ON a.line_id = l.line_id
      WHERE l.wo_id = $1`,
    [woId]
  )).rows;
  for (const a of assets) {
    await client.query(
      `UPDATE support_ticket_assets SET
         found_type_id = $2, found_subtype_id = $3, found_issue_id = $4,
         time_spent_minutes = COALESCE($5, time_spent_minutes),
         updated_at = NOW()
       WHERE line_id = $1`,
      [a.line_id, chain.type.catalog_id, chain.subtype.catalog_id, chain.issue.catalog_id, body.time_spent_minutes || null]
    );
  }
  for (const actionId of body.action_code_ids) {
    await client.query(
      `INSERT INTO support_work_order_actions (wo_id, action_code_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [woId, actionId]
    );
  }
  await client.query(
    `UPDATE support_work_orders
        SET outcome = $2, notes = $3, time_spent_minutes = $4, updated_at = NOW()
      WHERE wo_id = $1`,
    [woId, body.outcome, body.notes, body.time_spent_minutes || null]
  );
  await setStatus(client, wo, 'COMPLETED', { actorId, summary: `Completed ${wo.wo_number}` });
  const effect = effects[wo.wo_type];
  let extra = {};
  if (effect && effect.onComplete) {
    extra = (await effect.onComplete(client, { ...wo, status: 'COMPLETED' }, { ...body, line_id: assets[0] && assets[0].line_id, userId: actorId })) || {};
  }
  for (const a of assets) await computeAssetLineStatus(client, a.line_id);
  await computeTicketStatus(client, wo.ticket_id);
  return { ...(await loadWo(client, woId)), ...extra };
}

async function failWorkOrder(client, woId, body, actorId) {
  const reason = String(body.failure_reason || '').toUpperCase();
  if (!FAIL_REASONS.has(reason)) {
    throw Object.assign(new Error('Invalid failure_reason'), { status: 400 });
  }
  const wo = await loadWo(client, woId, { forUpdate: true });
  await client.query(
    `UPDATE support_work_orders SET failure_reason = $2, notes = COALESCE($3, notes), updated_at = NOW() WHERE wo_id = $1`,
    [woId, reason, body.notes || null]
  );
  await setStatus(client, wo, 'FAILED', { actorId, summary: `Failed ${wo.wo_number}`, detail: { reason } });
  let retry = null;
  if (body.create_retry) {
    const number = await nextWoNumber(client);
    const ins = await client.query(
      `INSERT INTO support_work_orders (
         wo_number, ticket_id, wo_type, status, assignment_group_id, method, notes,
         attempt_number, previous_wo_id
       ) VALUES ($1,$2,$3,'PENDING_ASSIGNMENT',$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        number, wo.ticket_id, wo.wo_type, wo.assignment_group_id, wo.method, wo.notes,
        Number(wo.attempt_number || 1) + 1, wo.wo_id,
      ]
    );
    retry = ins.rows[0];
    const links = await client.query(
      'SELECT line_id FROM support_work_order_assets WHERE wo_id = $1',
      [woId]
    );
    for (const l of links.rows) {
      await client.query(
        `INSERT INTO support_work_order_assets (wo_id, line_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [retry.wo_id, l.line_id]
      );
    }
    await instantiateSteps(client, retry.wo_id, retry.wo_type);
    await logEvent(client, {
      ticketId: wo.ticket_id,
      woId: retry.wo_id,
      eventType: 'WO_RETRY_CREATED',
      actorId,
      summary: `Retry ${number} (attempt ${retry.attempt_number})`,
    });
  }
  await computeTicketStatus(client, wo.ticket_id);
  return { wo: await loadWo(client, woId), retry };
}

async function cancelWorkOrder(client, woId, actorId, reason) {
  const wo = await loadWo(client, woId, { forUpdate: true });
  await setStatus(client, wo, 'CANCELLED', { actorId, summary: reason || `Cancelled ${wo.wo_number}` });
  const effect = effects[wo.wo_type];
  if (effect && effect.onCancel) await effect.onCancel(client, wo);
  await computeTicketStatus(client, wo.ticket_id);
  return loadWo(client, woId);
}

async function maybeCreateServiceReturnFromFloorPass(client, floorTicketId) {
  if (!floorTicketId) return null;
  const src = await client.query(
    `SELECT * FROM support_work_orders
      WHERE floor_ticket_id = $1 AND wo_type = 'REPAIR_PICKUP' AND status = 'COMPLETED'
      ORDER BY wo_id DESC LIMIT 1`,
    [floorTicketId]
  );
  const wo = src.rows[0];
  if (!wo) return null;
  const existing = await client.query(
    `SELECT wo_id FROM support_work_orders
      WHERE wo_type = 'SERVICE_RETURN'
        AND (previous_wo_id = $1 OR linked_wo_id = $1)
      LIMIT 1`,
    [wo.wo_id, wo.ticket_id]
  );
  if (existing.rows[0]) return existing.rows[0];
  const created = await createWorkOrder(client, wo.ticket_id, {
    wo_type: 'SERVICE_RETURN',
    line_ids: (await client.query(
      'SELECT line_id FROM support_work_order_assets WHERE wo_id = $1',
      [wo.wo_id]
    )).rows.map((r) => r.line_id),
    notes: `Auto-created after floor QC #${floorTicketId}`,
  }, null);
  await client.query(
    `UPDATE support_work_orders SET linked_wo_id = $2, previous_wo_id = $3, updated_at = NOW() WHERE wo_id = $1`,
    [created.wo_id, wo.wo_id, wo.wo_id]
  );
  return created;
}

module.exports = {
  TRANSITIONS,
  WO_TYPE_SECTION,
  FAIL_REASONS,
  assertTransition,
  instantiateSteps,
  completeStep,
  checkMandatorySteps,
  createWorkOrder,
  assignWorkOrder,
  advance,
  verifyOtp,
  completeWorkOrder,
  failWorkOrder,
  cancelWorkOrder,
  loadWo,
  typeSkipsTravel,
  maybeCreateServiceReturnFromFloorPass,
};
