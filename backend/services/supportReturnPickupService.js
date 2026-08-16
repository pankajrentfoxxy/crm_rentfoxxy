'use strict';

const crypto = require('crypto');
const { createTicket } = require('./supportTicketFlowService');
const { createWorkOrder, loadWo, advance } = require('./supportWorkOrderService');
const {
  GRADE_DEFS,
  REASON_L3,
  groupSerialsBySiteAndCapacity,
  loadCatalogs,
  computeChargeable,
  validateGrade,
  pickApprover,
} = require('./supportReturnGuards');

async function saveCondition(client, woId, body, userId) {
  const wo = await loadWo(client, woId);
  if (wo.wo_type !== 'RETURN_PICKUP') {
    throw Object.assign(new Error('Condition grading is only for return pickup'), { status: 400 });
  }
  const serialId = Number(body.serial_id);
  if (!serialId) throw Object.assign(new Error('serial_id required'), { status: 400 });
  const onWo = await client.query(
    `SELECT a.line_id, a.serial_id
       FROM support_work_order_assets l
       JOIN support_ticket_assets a ON a.line_id = l.line_id
      WHERE l.wo_id = $1 AND a.serial_id = $2`,
    [woId, serialId]
  );
  if (!onWo.rows[0]) throw Object.assign(new Error('Serial is not on this work order'), { status: 400 });

  const catalogs = await loadCatalogs(client);
  const charged = computeChargeable(body, catalogs);
  const { grade, photos } = validateGrade(body, charged.total);

  const upsert = await client.query(
    `INSERT INTO support_asset_condition (
       wo_id, line_id, serial_id, grade, damage_items, accessories, missing_items,
       chargeable_total, assessed_by, notes, photo_attachment_ids
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11::jsonb)
     ON CONFLICT (wo_id, serial_id) DO UPDATE SET
       grade = EXCLUDED.grade,
       damage_items = EXCLUDED.damage_items,
       accessories = EXCLUDED.accessories,
       missing_items = EXCLUDED.missing_items,
       chargeable_total = EXCLUDED.chargeable_total,
       assessed_by = EXCLUDED.assessed_by,
       assessed_at = NOW(),
       notes = EXCLUDED.notes,
       photo_attachment_ids = EXCLUDED.photo_attachment_ids
     RETURNING *`,
    [
      woId,
      onWo.rows[0].line_id,
      serialId,
      grade,
      JSON.stringify(body.damage_items || []),
      JSON.stringify(body.accessories || {}),
      JSON.stringify(charged.missing),
      charged.total,
      userId || null,
      body.notes || null,
      JSON.stringify(photos),
    ]
  );

  let approval = null;
  let extraLine = null;
  if (charged.total > 0) {
    extraLine = (await client.query(
      `INSERT INTO customer_invoice_extra_lines (
         ticket_id, line_id, customer_id, charge_type, description, amount, status,
         evidence_urls, photo_attachment_ids, wo_id, serial_id
       ) VALUES ($1,$2,$3,'DAMAGE','Return condition charges',$4,'PENDING',$5::jsonb,$6::jsonb,$7,$8)
       RETURNING *`,
      [
        wo.ticket_id, onWo.rows[0].line_id, wo.customer_id, charged.total,
        JSON.stringify(photos), JSON.stringify(photos), woId, serialId,
      ]
    )).rows[0];
    await pickApprover(client, charged.total);
    approval = (await client.query(
      `INSERT INTO support_approvals (
         ticket_id, line_id, wo_id, approval_type, status, amount, label, requested_by
       ) VALUES ($1,$2,$3,'DAMAGE_CHARGE','PENDING',$4,$5,$6)
       RETURNING *`,
      [
        wo.ticket_id, onWo.rows[0].line_id, woId, charged.total,
        `Damage / missing accessories on serial ${serialId}`,
        userId || null,
      ]
    )).rows[0];
    if (extraLine && approval) {
      await client.query(
        `UPDATE customer_invoice_extra_lines SET approval_id = $2 WHERE extra_line_id = $1`,
        [extraLine.extra_line_id, approval.approval_id]
      );
    }
  }

  return { condition: upsert.rows[0], extra_line: extraLine, approval, grade_definition: GRADE_DEFS[grade] };
}

async function warehouseReceipt(client, woId, body, userId) {
  const wo = await loadWo(client, woId);
  if (wo.wo_type !== 'RETURN_PICKUP') {
    throw Object.assign(new Error('Warehouse receipt is only for return pickup'), { status: 400 });
  }
  const serialIds = (body.serial_ids || []).map(Number).filter(Boolean);
  if (!serialIds.length) throw Object.assign(new Error('serial_ids required'), { status: 400 });
  if (!body.scanned && !body.short_shipment_reason) {
    throw Object.assign(new Error('Unscanned serials need a short-shipment reason'), { status: 400 });
  }
  const expected = await client.query(
    `SELECT a.serial_id FROM support_work_order_assets l
       JOIN support_ticket_assets a ON a.line_id = l.line_id
      WHERE l.wo_id = $1 AND a.serial_id IS NOT NULL`,
    [woId]
  );
  const expectedIds = new Set(expected.rows.map((r) => Number(r.serial_id)));
  const missing = [...expectedIds].filter((id) => !serialIds.includes(id));
  if (missing.length && !body.short_shipment_reason) {
    throw Object.assign(new Error('Cannot submit with unscanned serials unless a short-shipment reason is given'), { status: 400 });
  }
  const { onWarehouseReceipt } = require('./workOrderEffects/returnPickup');
  const extra = await onWarehouseReceipt(client, wo, { serialIds, userId });
  await client.query(
    `UPDATE support_work_order_steps
        SET status = 'DONE', completed_at = NOW(), payload = $2, completed_by = $3
      WHERE wo_id = $1 AND step_code = 'WH_RECEIPT' AND status <> 'DONE'`,
    [woId, JSON.stringify({
      serial_ids: serialIds,
      scanned: true,
      short_shipment_reason: body.short_shipment_reason || null,
    }), userId || null]
  );
  return { ok: true, ...extra, missing };
}

async function resolveL3(client, reason) {
  const code = REASON_L3[String(reason || 'END_OF_CONTRACT').toUpperCase()] || 'LOG-RET-EOC';
  const r = await client.query(
    `SELECT catalog_id FROM support_issue_catalog WHERE code = $1 LIMIT 1`,
    [code]
  );
  if (!r.rows[0]) throw Object.assign(new Error(`Return reason ${code} is not in the catalogue`), { status: 400 });
  return r.rows[0].catalog_id;
}

async function createBulkReturn(pool, body, actorId) {
  const customerId = Number(body.customer_id);
  if (!customerId) throw Object.assign(new Error('customer_id required'), { status: 400 });
  const capacity = Number(body.vehicle_capacity) || 25;
  const reason = String(body.reason || 'END_OF_CONTRACT').toUpperCase();
  let items = [];
  if (Array.isArray(body.sites) && body.sites.length) {
    for (const site of body.sites) {
      for (const sid of site.serial_ids || []) {
        items.push({ serial_id: Number(sid), site_id: site.site_id || null });
      }
    }
  } else {
    const siteId = body.site_id || null;
    items = (body.serial_ids || []).map((id) => ({ serial_id: Number(id), site_id: siteId }));
  }
  items = items.filter((x) => x.serial_id);
  if (!items.length) throw Object.assign(new Error('serial_ids required'), { status: 400 });

  const issueId = await resolveL3(pool, reason);
  const customer = (await pool.query(
    `SELECT customer_id, name, company_name, email, phone FROM customers WHERE customer_id = $1`,
    [customerId]
  )).rows[0];
  if (!customer) throw Object.assign(new Error('Customer not found'), { status: 400 });

  const desc = `Bulk return ${reason.replace(/_/g, ' ').toLowerCase()} for ${items.length} asset(s).`;
  const created = await createTicket(pool, {
    customer_id: customerId,
    ticket_class: 'REQUEST',
    channel: body.channel || 'INTERNAL',
    contact_name: body.contact_name || customer.name || customer.company_name,
    contact_phone: body.contact_phone || customer.phone,
    contact_email: body.contact_email || customer.email,
    site_id: body.site_id || null,
    site_label: body.site_label || null,
    subject: `Bulk return — ${items.length} asset(s)`,
    asset_lines: items.map((it) => ({
      serial_id: it.serial_id,
      reported_issue_id: issueId,
      reported_description: desc,
      impact: 2,
      urgency: 2,
    })),
  }, actorId);

  const lines = (await pool.query(
    `SELECT line_id, serial_id FROM support_ticket_assets WHERE ticket_id = $1 ORDER BY line_id`,
    [created.ticket_id]
  )).rows;
  const lineBySerial = new Map(lines.map((l) => [Number(l.serial_id), l.line_id]));
  const groups = groupSerialsBySiteAndCapacity(items, capacity);
  const bulkGroupId = crypto.randomUUID();
  const target = body.target_date ? new Date(body.target_date) : null;

  const client = await pool.connect();
  const wos = [];
  try {
    await client.query('BEGIN');
    for (const g of groups) {
      const lineIds = g.serial_ids.map((id) => lineBySerial.get(Number(id))).filter(Boolean);
      const wo = await createWorkOrder(client, created.ticket_id, {
        wo_type: 'RETURN_PICKUP',
        line_ids: lineIds,
        scheduled_start: target ? target.toISOString() : null,
        notes: `Bulk return group ${bulkGroupId}`,
      }, actorId);
      await client.query(
        `UPDATE support_work_orders
            SET bulk_group_id = $2, site_id = COALESCE($3, site_id), updated_at = NOW()
          WHERE wo_id = $1`,
        [wo.wo_id, bulkGroupId, g.site_id || body.site_id || null]
      );
      wos.push({ ...wo, bulk_group_id: bulkGroupId, site_id: g.site_id || body.site_id || null });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  return {
    ticket_id: created.ticket_id,
    ticket_number: created.ticket_number,
    bulk_group_id: bulkGroupId,
    work_orders: wos,
    group_count: wos.length,
    asset_count: items.length,
  };
}

async function getBulkGroup(client, groupId) {
  const wos = (await client.query(
    `SELECT w.*, t.ticket_number, t.customer_id
       FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
      WHERE w.bulk_group_id = $1
      ORDER BY w.wo_id`,
    [groupId]
  )).rows;
  if (!wos.length) throw Object.assign(new Error('Bulk group not found'), { status: 404 });
  return { bulk_group_id: groupId, ticket_id: wos[0].ticket_id, work_orders: wos };
}

async function decideApproval(client, approvalId, body, userId) {
  const decision = String(body.decision || body.status || '').toUpperCase();
  if (!['APPROVED', 'REJECTED', 'WAIVED'].includes(decision)) {
    throw Object.assign(new Error('decision must be APPROVED, REJECTED, or WAIVED'), { status: 400 });
  }
  if (decision === 'WAIVED' && !String(body.reason || '').trim()) {
    throw Object.assign(new Error('Waiver reason required'), { status: 400 });
  }
  const row = (await client.query(
    `SELECT * FROM support_approvals WHERE approval_id = $1 FOR UPDATE`,
    [approvalId]
  )).rows[0];
  if (!row) throw Object.assign(new Error('Approval not found'), { status: 404 });
  if (row.status !== 'PENDING') {
    throw Object.assign(new Error('Approval already decided'), { status: 409 });
  }
  await client.query(
    `UPDATE support_approvals
        SET status = $2, decided_by = $3, decided_at = NOW(), decision_reason = $4
      WHERE approval_id = $1`,
    [approvalId, decision, userId || null, body.reason || null]
  );
  if (row.approval_type === 'DAMAGE_CHARGE') {
    const extraStatus = decision === 'APPROVED' ? 'APPROVED' : decision;
    await client.query(
      `UPDATE customer_invoice_extra_lines
          SET status = $2, waived_reason = $3, updated_at = NOW()
        WHERE approval_id = $1 OR (wo_id = $4 AND status = 'PENDING')`,
      [approvalId, extraStatus, decision === 'WAIVED' ? body.reason : null, row.wo_id]
    );
  }
  if (row.approval_type === 'EARLY_TERMINATION' && (decision === 'APPROVED' || decision === 'WAIVED') && row.wo_id) {
    const wo = await loadWo(client, row.wo_id, { forUpdate: true });
    if (wo.status === 'DRAFT') {
      await advance(client, row.wo_id, 'PENDING_ASSIGNMENT', userId);
    }
  }
  if (['REPLACEMENT', 'RATE_CHANGE'].includes(row.approval_type) && (decision === 'APPROVED' || decision === 'WAIVED')) {
    const { releaseReplacementApprovals } = require('./supportReplacementService');
    await releaseReplacementApprovals(client, row, userId);
  }
  return { approval_id: approvalId, status: decision };
}

module.exports = {
  saveCondition,
  warehouseReceipt,
  createBulkReturn,
  getBulkGroup,
  decideApproval,
};
