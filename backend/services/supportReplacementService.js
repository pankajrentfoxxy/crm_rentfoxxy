'use strict';

const crypto = require('crypto');
const { isPickupEligibleStatus } = require('./supportPickupEligibility');
const { createWorkOrder, loadWo, cancelWorkOrder, advance } = require('./supportWorkOrderService');
const { logEvent, computeTicketStatus } = require('./supportTicketStateService');
const { enqueueEmail } = require('./emailQueueService');

const REASONS = [
  'FAULTY_IRREPARABLE',
  'REPAIR_TOO_LONG',
  'UPGRADE_DOWNGRADE',
  'WRONG_UNIT_DELIVERED',
  'RESEND_AFTER_RETURN',
];

const NO_COLLECT_REASONS = new Set(['REPAIR_TOO_LONG', 'RESEND_AFTER_RETURN']);
const VALUE_MANAGER_THRESHOLD = 40000;

/** Collect leg is needed iff the old asset is still physically with the customer. */
function needsCollectLeg(oldAsset, reason) {
  if (NO_COLLECT_REASONS.has(String(reason || '').toUpperCase())) return false;
  if (!oldAsset) return false;
  return isPickupEligibleStatus(oldAsset.inventory_status)
    && oldAsset.current_customer_id != null;
}

function extraOf(row) {
  return (row && row.extra) || {};
}

function specField(extra, keys) {
  for (const k of keys) {
    if (extra[k]) return String(extra[k]);
  }
  return '';
}

function configMatchScore(oldExtra, newExtra) {
  const oldE = oldExtra || {};
  const newE = newExtra || {};
  const keys = [
    { keys: ['brand'], w: 20, name: 'brand' },
    { keys: ['model', 'model_name'], w: 25, name: 'model' },
    { keys: ['processor', 'cpu'], w: 15, name: 'cpu' },
    { keys: ['ram'], w: 15, name: 'ram' },
    { keys: ['storage'], w: 15, name: 'storage' },
    { keys: ['screen_size', 'screen'], w: 10, name: 'screen' },
  ];
  let score = 0;
  const downgrade_fields = [];
  for (const k of keys) {
    const ov = specField(oldE, k.keys).toLowerCase();
    const nv = specField(newE, k.keys).toLowerCase();
    if (!ov) { score += k.w; continue; }
    if (ov === nv) { score += k.w; continue; }
    const on = parseInt(ov, 10);
    const nn = parseInt(nv, 10);
    if (Number.isFinite(on) && Number.isFinite(nn) && nn >= on) score += k.w;
    else downgrade_fields.push(k.name);
  }
  return { score: Math.min(100, score), downgrade_fields };
}

function unitValue(serial) {
  const extra = extraOf(serial);
  return Number(
    extra.purchase_cost || extra.asset_value || (Number(serial.rent_monthly_rate || 0) * 12) || 0
  );
}

async function loadSerial(client, serialId) {
  if (!serialId) return null;
  const r = await client.query(
    `SELECT serial_id, inventory_status, current_customer_id, rent_monthly_rate,
            inventory_asset_code AS ttspl_id, serial_number, extra,
            COALESCE(extra->>'brand','') AS brand,
            COALESCE(extra->>'model', extra->>'model_name','') AS model
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [serialId]
  );
  return r.rows[0] || null;
}

async function getPairedDelivery(client, groupId) {
  if (!groupId) return null;
  const r = await client.query(
    `SELECT * FROM support_work_orders
      WHERE replacement_group_id = $1 AND wo_type = 'REPLACEMENT_DELIVERY'
      ORDER BY wo_id DESC LIMIT 1`,
    [groupId]
  );
  return r.rows[0] || null;
}

async function pickApprover(client, role) {
  const r = await client.query(
    `SELECT user_id FROM users WHERE role = $1 ORDER BY user_id LIMIT 1`,
    [role]
  );
  return r.rows[0] ? r.rows[0].user_id : null;
}

async function amendSalesOrderLine(client, { oldSerialId, newRate }) {
  if (!oldSerialId || newRate == null) return null;
  try {
    const existing = await client.query(
      `SELECT sol.id, sol.rate, sol.sales_order_number
         FROM sales_order_serials sos
         JOIN sales_order_lines sol ON sol.id = sos.line_id
        WHERE sos.serial_id = $1
        ORDER BY sos.id DESC LIMIT 1`,
      [oldSerialId]
    );
    if (!existing.rows[0]) return null;
    await client.query(
      `UPDATE sales_order_lines SET rate = $2, updated_at = NOW() WHERE id = $1`,
      [existing.rows[0].id, newRate]
    );
    return existing.rows[0].id;
  } catch (e) {
    console.error('amendSalesOrderLine:', e);
    return null;
  }
}

async function replacementContext(client, lineId) {
  const line = (await client.query(
    `SELECT a.*, t.customer_id, t.site_id, t.ticket_id, t.ticket_number
       FROM support_ticket_assets a
       JOIN support_tickets_v2 t ON t.ticket_id = a.ticket_id
      WHERE a.line_id = $1`,
    [lineId]
  )).rows[0];
  if (!line) throw Object.assign(new Error('Line not found'), { status: 404 });
  const oldAsset = line.serial_id ? await loadSerial(client, line.serial_id) : null;
  const collectByReason = {};
  for (const reason of REASONS) {
    collectByReason[reason] = needsCollectLeg(oldAsset, reason);
  }
  const recent = (await client.query(
    `SELECT COUNT(*)::int AS n
       FROM support_replacements r
       JOIN support_tickets_v2 t ON t.ticket_id = r.ticket_id
      WHERE t.customer_id = $1
        AND r.created_at >= NOW() - INTERVAL '90 days'
        AND r.status <> 'CANCELLED'`,
    [line.customer_id]
  )).rows[0];
  const value = oldAsset ? unitValue(oldAsset) : 0;
  return {
    line,
    old_asset: oldAsset,
    needs_collect_leg: needsCollectLeg(oldAsset, 'FAULTY_IRREPARABLE'),
    collect_by_reason: collectByReason,
    thresholds: {
      unit_value: value,
      manager_value: value > VALUE_MANAGER_THRESHOLD,
      replacements_90d: recent.n,
      manager_frequency: recent.n >= 2,
    },
  };
}

function packCandidate(row, source, oldExtra, distanceKm) {
  const extra = extraOf(row);
  const match = configMatchScore(oldExtra, extra);
  return {
    serial_id: row.serial_id,
    ttspl_id: row.ttspl_id || row.inventory_asset_code,
    source,
    brand: row.brand || extra.brand || '',
    model: row.model || extra.model || extra.model_name || '',
    config: [extra.processor || extra.cpu, extra.ram, extra.storage].filter(Boolean).join(' · '),
    config_match_score: match.score,
    rate: Number(row.rent_monthly_rate || extra.rate || 0),
    location: extra.warehouse || extra.location || (source === 'BUFFER_ON_SITE' ? 'On site buffer' : 'Warehouse'),
    distance_km: distanceKm,
    downgrade_fields: match.downgrade_fields,
  };
}

async function listCandidates(client, lineId) {
  const ctx = await replacementContext(client, lineId);
  const oldExtra = extraOf(ctx.old_asset);
  const customerId = ctx.line.customer_id;
  const siteId = ctx.line.site_id;
  const candidates = [];

  const buffer = await client.query(
    `SELECT s.serial_id, s.inventory_asset_code AS ttspl_id, s.serial_number,
            s.rent_monthly_rate, s.extra,
            COALESCE(s.extra->>'brand','') AS brand,
            COALESCE(s.extra->>'model', s.extra->>'model_name','') AS model
       FROM customer_buffer_stock b
       JOIN vendor_serial_numbers s ON s.serial_id = b.serial_id
      WHERE b.customer_id = $1 AND b.status = 'AVAILABLE'
        AND ($2::int IS NULL OR b.site_id = $2 OR b.site_id IS NULL)
        AND s.deleted_at IS NULL`,
    [customerId, siteId || null]
  ).catch(() => ({ rows: [] }));
  for (const row of buffer.rows) {
    candidates.push(packCandidate(row, 'BUFFER_ON_SITE', oldExtra, 0));
  }

  const free = await client.query(
    `SELECT serial_id, inventory_asset_code AS ttspl_id, serial_number,
            rent_monthly_rate, extra,
            COALESCE(extra->>'brand','') AS brand,
            COALESCE(extra->>'model', extra->>'model_name','') AS model
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND inventory_status = 'in_stock'
        AND current_customer_id IS NULL
      ORDER BY serial_id DESC
      LIMIT 40`
  );
  for (const row of free.rows) {
    const packed = packCandidate(row, 'FREE_STOCK', oldExtra, 4.2);
    candidates.push(packed);
  }

  candidates.sort((a, b) => {
    if (a.source === 'BUFFER_ON_SITE' && b.source !== 'BUFFER_ON_SITE') return -1;
    if (b.source === 'BUFFER_ON_SITE' && a.source !== 'BUFFER_ON_SITE') return 1;
    return b.config_match_score - a.config_match_score;
  });
  return { old_asset: ctx.old_asset, candidates };
}

async function createApprovals(client, {
  ticketId, lineId, woId, amount, label, type, actorId,
}) {
  const row = (await client.query(
    `INSERT INTO support_approvals (
       ticket_id, line_id, wo_id, approval_type, status, amount, label, requested_by
     ) VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7)
     RETURNING *`,
    [ticketId, lineId, woId || null, type, amount || null, label, actorId || null]
  )).rows[0];
  return row;
}

async function createReplacement(client, lineId, body, actorId) {
  const reason = String(body.reason || '').toUpperCase();
  if (!REASONS.includes(reason)) {
    throw Object.assign(new Error('Invalid replacement reason'), { status: 400 });
  }
  const ctx = await replacementContext(client, lineId);
  const oldAsset = ctx.old_asset;
  if (!oldAsset && reason !== 'RESEND_AFTER_RETURN') {
    throw Object.assign(new Error('Old asset is required on this line'), { status: 400 });
  }
  const collect = needsCollectLeg(oldAsset, reason);
  const source = String(body.source || 'FREE_STOCK').toUpperCase();
  if (!['FREE_STOCK', 'BUFFER_ON_SITE', 'NEW_PROCUREMENT'].includes(source)) {
    throw Object.assign(new Error('Invalid source'), { status: 400 });
  }
  const newSerial = body.new_serial_id ? await loadSerial(client, Number(body.new_serial_id)) : null;
  if (source !== 'NEW_PROCUREMENT' && !newSerial) {
    throw Object.assign(new Error('new_serial_id required'), { status: 400 });
  }
  const oldRate = Number((oldAsset && oldAsset.rent_monthly_rate) || 0);
  const newRate = body.rate != null ? Number(body.rate) : Number((newSerial && newSerial.rent_monthly_rate) || oldRate);
  const rateChange = reason === 'UPGRADE_DOWNGRADE' || (oldRate > 0 && newRate > 0 && oldRate !== newRate);
  const match = configMatchScore(extraOf(oldAsset), extraOf(newSerial));
  const value = newSerial ? unitValue(newSerial) : unitValue(oldAsset);

  const approvalsNeeded = [];
  if (value > VALUE_MANAGER_THRESHOLD) {
    approvalsNeeded.push({ type: 'REPLACEMENT', amount: value, label: `Unit value ₹${value} exceeds ₹40,000` });
  }
  if (ctx.thresholds.replacements_90d >= 2) {
    approvalsNeeded.push({
      type: 'REPLACEMENT',
      amount: null,
      label: `${ctx.thresholds.replacements_90d + 1}th replacement in 90 days`,
    });
  }
  if (rateChange) {
    approvalsNeeded.push({ type: 'RATE_CHANGE', amount: newRate, label: `Rate ${oldRate} → ${newRate}` });
  }

  const groupId = crypto.randomUUID();
  const hold = approvalsNeeded.length > 0;
  const slotStart = body.slot && (body.slot.start || body.slot.scheduled_start) || body.scheduled_start || null;
  const slotEnd = body.slot && (body.slot.end || body.slot.scheduled_end) || body.scheduled_end || null;
  const assignTo = body.assign_to || body.assigned_to || null;

  const ins = await client.query(
    `INSERT INTO support_replacements (
       replacement_group_id, ticket_id, line_id, reason, old_serial_id, new_serial_id,
       old_rate, new_rate, rate_change, config_match_score, source, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      groupId, ctx.line.ticket_id, lineId, reason,
      oldAsset && oldAsset.serial_id, newSerial && newSerial.serial_id,
      oldRate, newRate, rateChange, match.score, source,
      hold ? 'PENDING_APPROVAL' : 'APPROVED',
      actorId || null,
    ]
  );
  const replacement = ins.rows[0];

  const delivery = await createWorkOrder(client, ctx.line.ticket_id, {
    wo_type: 'REPLACEMENT_DELIVERY',
    line_ids: [lineId],
    assigned_to: assignTo,
    scheduled_start: slotStart,
    scheduled_end: slotEnd,
    replacement_group_id: groupId,
    hold_as_draft: hold,
    notes: source === 'BUFFER_ON_SITE' ? 'On-site buffer swap' : `Replacement ${reason}`,
  }, actorId);

  let collectWo = null;
  if (collect) {
    collectWo = await createWorkOrder(client, ctx.line.ticket_id, {
      wo_type: 'RETURN_PICKUP',
      line_ids: [lineId],
      assigned_to: assignTo,
      scheduled_start: slotStart,
      scheduled_end: slotEnd,
      replacement_group_id: groupId,
      linked_wo_id: delivery.wo_id,
      hold_as_draft: hold,
      notes: `Collect old unit for replacement ${groupId}`,
    }, actorId);
    await client.query(
      `UPDATE support_work_orders SET linked_wo_id = $2, updated_at = NOW() WHERE wo_id = $1`,
      [delivery.wo_id, collectWo.wo_id]
    );
  }

  await client.query(
    `UPDATE support_replacements
        SET delivery_wo_id = $2, collect_wo_id = $3, updated_at = NOW()
      WHERE replacement_id = $1`,
    [replacement.replacement_id, delivery.wo_id, collectWo && collectWo.wo_id]
  );

  for (const a of approvalsNeeded) {
    await createApprovals(client, {
      ticketId: ctx.line.ticket_id,
      lineId,
      woId: delivery.wo_id,
      amount: a.amount,
      label: a.label,
      type: a.type,
      actorId,
    });
  }

  if (reason === 'WRONG_UNIT_DELIVERED') {
    await logEvent(client, {
      ticketId: ctx.line.ticket_id,
      lineId,
      woId: delivery.wo_id,
      eventType: 'DISPATCH_QUALITY',
      actorKind: 'SYSTEM',
      actorId,
      summary: 'Wrong unit delivered — internal quality event, no charge',
      detail: { old_serial_id: oldAsset && oldAsset.serial_id, new_serial_id: newSerial && newSerial.serial_id },
    });
  }

  if (source === 'BUFFER_ON_SITE' && newSerial) {
    await client.query(
      `UPDATE customer_buffer_stock SET status = 'DEPLOYED', updated_at = NOW()
        WHERE serial_id = $1 AND status = 'AVAILABLE'`,
      [newSerial.serial_id]
    ).catch(() => {});
  }

  await logEvent(client, {
    ticketId: ctx.line.ticket_id,
    lineId,
    woId: delivery.wo_id,
    eventType: 'REPLACEMENT_CREATED',
    actorId,
    summary: collect
      ? `Replacement pair created — deliver ${delivery.wo_number} and collect ${collectWo.wo_number}`
      : `Replacement delivery ${delivery.wo_number} (no collect — old unit not with customer)`,
    isCustomerVisible: true,
    detail: { replacement_group_id: groupId, reason, collect },
  });
  await computeTicketStatus(client, ctx.line.ticket_id);

  return {
    replacement: { ...replacement, delivery_wo_id: delivery.wo_id, collect_wo_id: collectWo && collectWo.wo_id },
    delivery,
    collect: collectWo,
    needs_collect_leg: collect,
    approvals: approvalsNeeded,
    hold_as_draft: hold,
  };
}

async function patchReplacement(client, id, body, actorId) {
  const row = (await client.query(
    `SELECT * FROM support_replacements WHERE replacement_id = $1`,
    [id]
  )).rows[0];
  if (!row) throw Object.assign(new Error('Replacement not found'), { status: 404 });
  await client.query(
    `UPDATE support_replacements SET
       new_serial_id = COALESCE($2, new_serial_id),
       new_rate = COALESCE($3, new_rate),
       source = COALESCE($4, source),
       updated_at = NOW()
     WHERE replacement_id = $1`,
    [id, body.new_serial_id || null, body.rate != null ? body.rate : null, body.source || null]
  );
  if (row.delivery_wo_id && (body.scheduled_start || body.assigned_to || body.assign_to)) {
    await client.query(
      `UPDATE support_work_orders SET
         scheduled_start = COALESCE($2, scheduled_start),
         scheduled_end = COALESCE($3, scheduled_end),
         assigned_to = COALESCE($4, assigned_to),
         updated_at = NOW()
       WHERE wo_id = $1`,
      [
        row.delivery_wo_id,
        body.scheduled_start || (body.slot && body.slot.start) || null,
        body.scheduled_end || (body.slot && body.slot.end) || null,
        body.assign_to || body.assigned_to || null,
      ]
    );
    if (row.collect_wo_id) {
      await client.query(
        `UPDATE support_work_orders SET
           scheduled_start = COALESCE($2, scheduled_start),
           scheduled_end = COALESCE($3, scheduled_end),
           assigned_to = COALESCE($4, assigned_to),
           updated_at = NOW()
         WHERE wo_id = $1`,
        [
          row.collect_wo_id,
          body.scheduled_start || (body.slot && body.slot.start) || null,
          body.scheduled_end || (body.slot && body.slot.end) || null,
          body.assign_to || body.assigned_to || null,
        ]
      );
    }
  }
  void actorId;
  return (await client.query(`SELECT * FROM support_replacements WHERE replacement_id = $1`, [id])).rows[0];
}

async function waiveCollect(client, id, reason, actorId) {
  if (!String(reason || '').trim()) {
    throw Object.assign(new Error('Waiver reason required'), { status: 400 });
  }
  const row = (await client.query(
    `SELECT * FROM support_replacements WHERE replacement_id = $1`,
    [id]
  )).rows[0];
  if (!row) throw Object.assign(new Error('Replacement not found'), { status: 404 });
  await client.query(
    `UPDATE support_replacements
        SET collect_waived = TRUE, collect_waived_reason = $2, updated_at = NOW()
      WHERE replacement_id = $1`,
    [id, String(reason).trim()]
  );
  await logEvent(client, {
    ticketId: row.ticket_id,
    lineId: row.line_id,
    woId: row.collect_wo_id,
    eventType: 'COLLECT_WAIVED',
    actorId,
    summary: `Collect-before-delivery waived: ${String(reason).trim()}`,
    detail: { replacement_id: id },
  });
  return { replacement_id: id, collect_waived: true };
}

async function cancelReplacement(client, id, actorId) {
  const row = (await client.query(
    `SELECT * FROM support_replacements WHERE replacement_id = $1`,
    [id]
  )).rows[0];
  if (!row) throw Object.assign(new Error('Replacement not found'), { status: 404 });
  if (row.delivery_wo_id) {
    const d = await loadWo(client, row.delivery_wo_id);
    if (!['COMPLETED', 'CANCELLED'].includes(d.status)) {
      await cancelWorkOrder(client, row.delivery_wo_id, actorId, 'Replacement cancelled');
    }
  }
  if (row.collect_wo_id) {
    const c = await loadWo(client, row.collect_wo_id);
    if (!['COMPLETED', 'CANCELLED'].includes(c.status)) {
      await cancelWorkOrder(client, row.collect_wo_id, actorId, 'Replacement cancelled');
    }
  }
  await client.query(
    `UPDATE support_replacements SET status = 'CANCELLED', updated_at = NOW() WHERE replacement_id = $1`,
    [id]
  );
  await logEvent(client, {
    ticketId: row.ticket_id,
    lineId: row.line_id,
    eventType: 'REPLACEMENT_CANCELLED',
    actorId,
    summary: 'Replacement cancelled',
  });
  return { replacement_id: id, status: 'CANCELLED' };
}

async function releaseReplacementApprovals(client, approval, userId) {
  const repl = (await client.query(
    `SELECT * FROM support_replacements
      WHERE delivery_wo_id = $1 OR ticket_id = $2
      ORDER BY replacement_id DESC LIMIT 1`,
    [approval.wo_id, approval.ticket_id]
  )).rows[0];
  if (!repl) return;
  const pending = (await client.query(
    `SELECT COUNT(*)::int AS n FROM support_approvals
      WHERE ticket_id = $1 AND status = 'PENDING'
        AND approval_type IN ('REPLACEMENT','RATE_CHANGE')
        AND (wo_id = $2 OR wo_id IS NULL)`,
    [repl.ticket_id, repl.delivery_wo_id]
  )).rows[0];
  if (pending.n > 0) return;
  if (repl.rate_change) {
    const soId = await amendSalesOrderLine(client, {
      oldSerialId: repl.old_serial_id,
      newRate: repl.new_rate,
    });
    if (soId) {
      await client.query(
        `UPDATE support_replacements SET sales_order_line_id = $2, updated_at = NOW() WHERE replacement_id = $1`,
        [repl.replacement_id, soId]
      );
    }
  }
  await client.query(
    `UPDATE support_replacements SET status = 'APPROVED', updated_at = NOW()
      WHERE replacement_id = $1 AND status = 'PENDING_APPROVAL'`,
    [repl.replacement_id]
  );
  for (const woId of [repl.delivery_wo_id, repl.collect_wo_id].filter(Boolean)) {
    const wo = await loadWo(client, woId, { forUpdate: true });
    if (wo.status === 'DRAFT') await advance(client, woId, 'PENDING_ASSIGNMENT', userId);
  }
}

async function onDataTransfer(client, wo, choice) {
  const value = String(choice || '').toUpperCase();
  if (!['NOT_REQUIRED', 'DONE_ON_SITE', 'CUSTOMER_WILL_DO', 'BACKUP_TAKEN'].includes(value)) {
    throw Object.assign(new Error('Invalid data_transfer value'), { status: 400 });
  }
  await client.query(
    `UPDATE support_replacements SET data_transfer = $2, updated_at = NOW()
      WHERE delivery_wo_id = $1 OR replacement_group_id = $3`,
    [wo.wo_id, value, wo.replacement_group_id]
  );
  if (value !== 'CUSTOMER_WILL_DO') return { data_transfer: value };
  const repl = (await client.query(
    `SELECT * FROM support_replacements WHERE delivery_wo_id = $1 OR replacement_group_id = $2
      ORDER BY replacement_id DESC LIMIT 1`,
    [wo.wo_id, wo.replacement_group_id]
  )).rows[0];
  if (repl && repl.collect_wo_id) {
    await client.query(
      `UPDATE support_work_orders
          SET scheduled_start = COALESCE(scheduled_start, NOW()) + INTERVAL '1 day',
              scheduled_end = COALESCE(scheduled_end, NOW()) + INTERVAL '1 day',
              updated_at = NOW()
        WHERE wo_id = $1`,
      [repl.collect_wo_id]
    );
    const ticket = (await client.query(
      `SELECT contact_email, contact_name, ticket_number FROM support_tickets_v2 WHERE ticket_id = $1`,
      [wo.ticket_id]
    )).rows[0];
    if (ticket && ticket.contact_email) {
      enqueueEmail({
        toEmail: ticket.contact_email,
        subject: `${ticket.ticket_number} — we will collect the old unit tomorrow`,
        bodyText: `Hi ${ticket.contact_name || ''},\nYou asked to move your files yourself. We will collect the old unit tomorrow.`,
        dedupeKey: `repl-collect-tomorrow-${repl.replacement_id}`,
      }).catch((e) => console.error('data transfer email:', e));
    }
    await logEvent(client, {
      ticketId: wo.ticket_id,
      woId: repl.collect_wo_id,
      eventType: 'COLLECT_RESCHEDULED',
      actorKind: 'SYSTEM',
      summary: 'Collect rescheduled to next day — customer will transfer data',
      isCustomerVisible: true,
    });
  }
  return { data_transfer: value, collect_rescheduled: true };
}

async function sameDaySameRate(client, wo) {
  if (!wo.replacement_group_id) return false;
  const repl = (await client.query(
    `SELECT * FROM support_replacements WHERE replacement_group_id = $1 ORDER BY replacement_id DESC LIMIT 1`,
    [wo.replacement_group_id]
  )).rows[0];
  if (!repl || repl.rate_change) return false;
  const delivery = await getPairedDelivery(client, wo.replacement_group_id);
  if (!delivery || delivery.status !== 'COMPLETED' || !delivery.completed_at) return false;
  const d = new Date(delivery.completed_at).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return d === today;
}

module.exports = {
  REASONS,
  needsCollectLeg,
  configMatchScore,
  unitValue,
  getPairedDelivery,
  replacementContext,
  listCandidates,
  createReplacement,
  patchReplacement,
  waiveCollect,
  cancelReplacement,
  releaseReplacementApprovals,
  onDataTransfer,
  sameDaySameRate,
  amendSalesOrderLine,
};
