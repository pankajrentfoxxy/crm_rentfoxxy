'use strict';

const { generatePrqNumber } = require('./partIdService');
const { createWorkOrder } = require('./supportWorkOrderService');
const { computeAssetLineStatus, computeTicketStatus, logEvent } = require('./supportTicketStateService');
const { pauseSla, resumeSla } = require('./supportSlaService');
const { generatePartDc, generatePartReturnDc } = require('./supportWoDocuments');
const {
  OPEN_FIELD_PART_STATUSES,
  QUEUE_CHIPS,
  queueOrderSql,
  assertPhotos,
  filterCompatibleParts,
} = require('./supportPartStatus');

const { getNumber } = require('./supportSettingsService');
const LIST_SQL = `
  pr.request_id, pr.request_number, pr.legacy_request_number, pr.context, pr.status_v2,
  pr.part_id, pr.part_name, pr.quantity, pr.liability, pr.charge_amount, pr.fulfilment_mode,
  pr.collect_old_part, pr.old_part_returned, pr.instance_id, pr.work_order_id, pr.return_wo_id,
  pr.fulfilment_document, pr.support_ticket_id, pr.support_line_id, pr.ticket_id,
  pr.requested_by, pr.rejection_reason, pr.created_at, pr.photo_attachment_ids,
  p.quantity AS stock_qty, p.part_name AS catalog_name,
  t.ticket_number, t.priority, t.sla_resolution_due_at, t.sla_paused, t.subject,
  a.ttspl_id, a.serial_number, a.line_code, a.line_status,
  u.name AS requested_by_name
`;

function fail(message, status, code) {
  const e = Object.assign(new Error(message), { status });
  if (code) e.code = code;
  throw e;
}

async function loadRequest(client, requestId, { forUpdate } = {}) {
  const r = await client.query(
    `SELECT pr.*, p.part_name AS catalog_name, p.quantity AS stock_qty, p.cost AS part_cost
       FROM part_requests pr
       LEFT JOIN parts p ON p.part_id = pr.part_id
      WHERE pr.request_id = $1 ${forUpdate ? 'FOR UPDATE OF pr' : ''}`,
    [requestId]
  );
  if (!r.rows[0]) fail('Part request not found', 404);
  return r.rows[0];
}

async function nextSpcNumber(client) {
  const r = await client.query(
    `UPDATE sm_document_sequences
        SET last_value = last_value + 1, updated_at = NOW()
      WHERE doc_type = 'support_part_challan'
      RETURNING last_value, prefix`
  );
  if (!r.rows[0]) {
    await client.query(
      `INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
       VALUES ('support_part_challan', 1, 'SPC-')
       ON CONFLICT (doc_type) DO UPDATE SET last_value = sm_document_sequences.last_value + 1
       RETURNING last_value, prefix`
    );
    const again = await client.query(
      `SELECT last_value, prefix FROM sm_document_sequences WHERE doc_type = 'support_part_challan'`
    );
    return `${again.rows[0].prefix || 'SPC-'}${String(again.rows[0].last_value).padStart(6, '0')}`;
  }
  return `${r.rows[0].prefix || 'SPC-'}${String(r.rows[0].last_value).padStart(6, '0')}`;
}

async function refreshLine(client, lineId) {
  if (lineId) await computeAssetLineStatus(client, lineId);
}

async function setPendingCustomer(client, ticketId, actorId, note) {
  if (!ticketId) return;
  await client.query(
    `UPDATE support_tickets_v2 SET pending_reason = 'PENDING_CUSTOMER', sla_paused = TRUE, updated_at = NOW()
      WHERE ticket_id = $1`,
    [ticketId]
  );
  try {
    await pauseSla(client, ticketId, 'PENDING_CUSTOMER', actorId, note, new Date(), true);
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  await computeTicketStatus(client, ticketId);
}

async function clearPendingCustomer(client, ticketId, actorId) {
  if (!ticketId) return;
  try {
    await resumeSla(client, ticketId, actorId);
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  await client.query(
    `UPDATE support_tickets_v2
        SET pending_reason = NULL, sla_paused = FALSE, updated_at = NOW()
      WHERE ticket_id = $1 AND pending_reason = 'PENDING_CUSTOMER'`,
    [ticketId]
  );
  await computeTicketStatus(client, ticketId);
}

function sameDayWindow() {
  const start = new Date();
  start.setHours(9, 30, 0, 0);
  const end = new Date();
  end.setHours(18, 30, 0, 0);
  return { scheduled_start: start, scheduled_end: end };
}

async function compatibleParts(db, serialId) {
  if (!serialId) fail('serial_id required', 400);
  const serial = (await db.query(
    `SELECT serial_id, serial_number, extra FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  )).rows[0];
  if (!serial) fail('Serial not found', 404);
  const extra = serial.extra || {};
  const brand = extra.brand || extra.Brand || null;
  const model = extra.model || extra.model_name || extra.Model || null;
  const configKey = extra.config_key || extra.config || null;

  const catalogue = (await db.query(
    `SELECT part_id, part_name, part_sku, category, quantity, cost, location_code,
            selling_price, gst_rate, hsn_code
       FROM parts
      WHERE COALESCE(archived, FALSE) = FALSE
      ORDER BY part_name`
  )).rows;

  const compat = await db.query(
    `SELECT part_id, brand, model, config_key
       FROM part_compatibility
      WHERE ($1::text IS NULL OR brand IS NULL OR LOWER(brand) = LOWER($1))
        AND ($2::text IS NULL OR model IS NULL OR LOWER(model) = LOWER($2))
        AND ($3::text IS NULL OR config_key IS NULL OR config_key = $3)`,
    [brand, model, configKey]
  ).catch(() => ({ rows: [] }));

  const anyForModel = await db.query(
    `SELECT 1 FROM part_compatibility
      WHERE ($1::text IS NULL OR LOWER(brand) = LOWER($1))
        AND ($2::text IS NULL OR LOWER(model) = LOWER($2))
      LIMIT 1`,
    [brand, model]
  ).catch(() => ({ rows: [] }));

  const filtered = anyForModel.rows.length
    ? filterCompatibleParts(catalogue, compat.rows)
    : filterCompatibleParts(catalogue, []);

  return {
    ...filtered,
    serial: { serial_id: serial.serial_id, serial_number: serial.serial_number, brand, model },
  };
}

async function createPartRequest(client, body, actorId) {
  const photos = assertPhotos(body.photo_attachment_ids);
  const partId = Number(body.part_id);
  const lineId = Number(body.support_line_id);
  const ticketId = Number(body.support_ticket_id);
  if (!partId || !lineId || !ticketId) fail('part_id, support_line_id and support_ticket_id are required', 400);

  const part = (await client.query(
    'SELECT part_id, part_name, quantity, selling_price, gst_rate, hsn_code FROM parts WHERE part_id = $1',
    [partId]
  )).rows[0];
  if (!part) fail('Part not found', 404);

  const line = (await client.query(
    `SELECT a.*, t.ticket_id, t.customer_id
       FROM support_ticket_assets a
       JOIN support_tickets_v2 t ON t.ticket_id = a.ticket_id
      WHERE a.line_id = $1 AND a.ticket_id = $2`,
    [lineId, ticketId]
  )).rows[0];
  if (!line) fail('Asset line not found on this ticket', 404);

  const inStock = Number(part.quantity) > 0 || (await client.query(
    `SELECT 1 FROM part_instances WHERE part_id = $1 AND status = 'in_stock' LIMIT 1`,
    [partId]
  )).rows.length > 0;

  const { resolveAttribution } = require('./supportFaultAttribution');
  const attr = resolveAttribution(body.fault_attribution) || resolveAttribution(
    body.liability === 'CUSTOMER_CHARGEABLE' ? 'CUSTOMER_DAMAGE' : body.liability === 'VENDOR_WARRANTY' ? 'VENDOR_WARRANTY' : 'COMPANY_FAULT'
  );
  const liability = attr.liability;
  const chargeable = attr.chargeable;
  if (chargeable && (part.selling_price == null || Number(part.selling_price) <= 0) && body.unit_selling_price == null) {
    fail('No selling price set for this part. Ask Parts to set it before raising a charge.', 400);
  }
  if (chargeable && (!photos || !photos.length)) {
    fail('Photos are required for a customer-chargeable part', 400);
  }
  const qty = Number(body.quantity) || 1;
  const unitPrice = chargeable
    ? Number(body.unit_selling_price != null ? body.unit_selling_price : part.selling_price)
    : null;
  const chargeAmount = chargeable ? Number((unitPrice * qty).toFixed(2)) : null;
  const statusV2 = inStock ? 'REQUESTED' : 'ESCALATED_TO_PROCUREMENT';
  const number = await generatePrqNumber(client);

  const ins = await client.query(
    `INSERT INTO part_requests (
       ticket_id, requested_by, part_name, description, status, request_number,
       part_id, quantity, context, support_ticket_id, support_line_id, work_order_id, status_v2,
       liability, charge_amount, collect_old_part, photo_attachment_ids, updated_at,
       fault_attribution, unit_selling_price, price_override_reason, needs_lead_approval,
       requested_before_visit
     ) VALUES (
       NULL, $1, $2, $3, $4, $5,
       $6, $7, 'FIELD', $8, $9, $10, $11,
       $12, $13, $14, $15::jsonb, NOW(),
       $16, $17, $18, $19, $20
     ) RETURNING *`,
    [
      actorId, part.part_name, body.reason || null, inStock ? 'pending' : 'escalated', number,
      partId, qty, ticketId, lineId, body.work_order_id || null, statusV2,
      liability, chargeAmount,
      Boolean(body.collect_old_part), JSON.stringify(photos),
      attr.code, unitPrice, body.price_override_reason || null, Boolean(attr.needsApproval),
      Boolean(body.requested_before_visit),
    ]
  );
  const row = ins.rows[0];

  if (attr.needsApproval) {
    const appr = await client.query(
      `INSERT INTO support_approvals (
         ticket_id, line_id, approval_type, status, amount, label, requested_by, customer_side
       ) VALUES ($1,$2,'CHARGEABLE_PART','PENDING',$3,$4,$5,TRUE)
       RETURNING approval_id`,
      [ticketId, lineId, row.charge_amount || 0, `Chargeable part ${number}`, actorId]
    );
    await client.query('UPDATE part_requests SET approval_id = $2 WHERE request_id = $1', [
      row.request_id, appr.rows[0].approval_id,
    ]);
    row.approval_id = appr.rows[0].approval_id;
    await setPendingCustomer(client, ticketId, actorId, `Chargeable part ${number}`);
  }

  await logEvent(client, {
    ticketId,
    lineId,
    eventType: 'PART_REQUESTED',
    actorId,
    summary: `${number} · ${part.part_name}${inStock ? '' : ' · out of stock'}`,
    detail: { request_id: row.request_id, status_v2: statusV2, liability },
  });
  await refreshLine(client, lineId);
  return row;
}

function listFrom(where, params, sort) {
  return {
    sql: `SELECT ${LIST_SQL}
            FROM part_requests pr
            LEFT JOIN parts p ON p.part_id = pr.part_id
            LEFT JOIN support_tickets_v2 t ON t.ticket_id = pr.support_ticket_id
            LEFT JOIN support_ticket_assets a ON a.line_id = pr.support_line_id
            LEFT JOIN users u ON u.user_id = pr.requested_by
           ${where}
           ORDER BY ${queueOrderSql(sort)}`,
    params,
  };
}

async function listRequests(db, query, user) {
  const conds = ['1=1'];
  const params = [];
  if (query.context) {
    params.push(String(query.context).toUpperCase());
    conds.push(`pr.context = $${params.length}`);
  }
  if (query.status) {
    params.push(String(query.status).toUpperCase());
    conds.push(`pr.status_v2 = $${params.length}`);
  }
  if (query.priority) {
    params.push(Number(query.priority));
    conds.push(`t.priority = $${params.length}`);
  }
  if (query.own_only) {
    params.push(user.user_id);
    conds.push(`pr.requested_by = $${params.length}`);
  }
  const { sql, params: p } = listFrom(`WHERE ${conds.join(' AND ')}`, params, query.sort);
  return (await db.query(sql, p)).rows;
}

async function listQueue(db, query) {
  const conds = [`pr.status_v2 IS NOT NULL`];
  const params = [];
  if (query.context && query.context !== 'ALL') {
    params.push(String(query.context).toUpperCase());
    conds.push(`pr.context = $${params.length}`);
  }
  const chip = query.chip;
  if (chip === 'old_return') {
    conds.push(`pr.collect_old_part = TRUE AND pr.status_v2 = 'CONSUMED' AND COALESCE(pr.old_part_returned, FALSE) = FALSE`);
  } else if (QUEUE_CHIPS[chip]) {
    params.push(QUEUE_CHIPS[chip]);
    conds.push(`pr.status_v2 = ANY($${params.length}::text[])`);
  }
  const { sql, params: p } = listFrom(`WHERE ${conds.join(' AND ')}`, params, query.sort);
  return (await db.query(sql, p)).rows;
}

async function approveRequest(client, requestId, body, actorId, { canLead } = {}) {
  const row = await loadRequest(client, requestId, { forUpdate: true });
  if (!['REQUESTED', 'ESCALATED_TO_PROCUREMENT'].includes(row.status_v2)) {
    fail(`Cannot approve a request in ${row.status_v2}`, 409);
  }
  const amount = Number(body.charge_amount != null ? body.charge_amount : row.charge_amount || 0);
  const leadLimit = await getNumber(client, 'parts_lead_threshold', 5000);
  if (amount > leadLimit && !canLead) {
    fail(`Lead must approve parts over ₹${leadLimit}`, 403, 'LEAD_REQUIRED');
  }
  if (row.liability === 'CUSTOMER_CHARGEABLE') {
    const open = await client.query(
      `SELECT approval_id FROM support_approvals
        WHERE ticket_id = $1 AND approval_type = 'CHARGEABLE_PART' AND status = 'PENDING'
        LIMIT 1`,
      [row.support_ticket_id]
    );
    if (open.rows[0] && !canLead) {
      fail('Customer / lead must approve the charge first', 409, 'CHARGE_PENDING');
    }
    if (open.rows[0] && canLead) {
      await client.query(
        `UPDATE support_approvals SET status = 'APPROVED', decided_by = $2, decided_at = NOW()
          WHERE approval_id = $1`,
        [open.rows[0].approval_id, actorId]
      );
    }
    await clearPendingCustomer(client, row.support_ticket_id, actorId);
  }

  const mode = String(body.fulfilment_mode || 'WAREHOUSE_HANDOVER').toUpperCase();
  if (!['WAREHOUSE_HANDOVER', 'COURIER_TO_CUSTOMER', 'COURIER_TO_TECH'].includes(mode)) {
    fail('Invalid fulfilment_mode', 400);
  }

  let instanceId = body.instance_id ? Number(body.instance_id) : row.instance_id;
  if (!instanceId && row.part_id) {
    const pick = await client.query(
      `SELECT instance_id FROM part_instances
        WHERE part_id = $1 AND status = 'in_stock'
        ORDER BY instance_id LIMIT 1`,
      [row.part_id]
    );
    instanceId = pick.rows[0] && pick.rows[0].instance_id;
  }
  if (instanceId) {
    const reserved = await client.query(
      `UPDATE part_instances SET status = 'reserved', updated_at = NOW()
        WHERE instance_id = $1 AND status IN ('in_stock','reserved')
        RETURNING instance_id`,
      [instanceId]
    );
    if (!reserved.rows[0]) fail('Part instance is not available', 409);
  }

  await client.query(
    `UPDATE part_requests
        SET status_v2 = 'RESERVED', status = 'approved', instance_id = $2,
            fulfilment_mode = $3, approved_by = $4, approved_at = NOW(),
            charge_amount = COALESCE($5, charge_amount),
            collect_old_part = COALESCE($6, collect_old_part),
            liability = COALESCE($7, liability),
            updated_at = NOW()
      WHERE request_id = $1`,
    [
      requestId, instanceId || null, mode, actorId,
      body.charge_amount != null ? Number(body.charge_amount) : null,
      body.collect_old_part != null ? Boolean(body.collect_old_part) : null,
      body.liability || null,
    ]
  );

  let wo = null;
  let document = null;
  if (row.support_ticket_id && row.support_line_id) {
    const window = sameDayWindow();
    wo = await createWorkOrder(client, row.support_ticket_id, {
      wo_type: 'PART_DELIVERY',
      line_ids: [row.support_line_id],
      assigned_to: row.requested_by,
      scheduled_start: window.scheduled_start,
      scheduled_end: window.scheduled_end,
      notes: `Part ${row.request_number}`,
    }, actorId);
    if (mode === 'WAREHOUSE_HANDOVER') {
      document = await nextSpcNumber(client);
    } else {
      document = await generatePartDc(client, wo, { partName: row.part_name || row.catalog_name });
    }
    await client.query(
      `UPDATE part_requests
          SET work_order_id = $2, fulfilment_document = $3, updated_at = NOW()
        WHERE request_id = $1`,
      [requestId, wo.wo_id, document]
    );
  }

  await logEvent(client, {
    ticketId: row.support_ticket_id,
    lineId: row.support_line_id,
    woId: wo && wo.wo_id,
    eventType: 'PART_APPROVED',
    actorId,
    summary: `Approved ${row.request_number} · ${mode}`,
    detail: { instance_id: instanceId, document, wo_id: wo && wo.wo_id },
  });
  await refreshLine(client, row.support_line_id);
  return { ...(await loadRequest(client, requestId)), work_order: wo, fulfilment_document: document };
}

async function rejectRequest(client, requestId, reason, actorId) {
  const row = await loadRequest(client, requestId, { forUpdate: true });
  if (!reason) fail('reason required', 400);
  await client.query(
    `UPDATE part_requests
        SET status_v2 = 'REJECTED', status = 'rejected', rejection_reason = $2, updated_at = NOW()
      WHERE request_id = $1`,
    [requestId, reason]
  );
  if (row.instance_id) {
    await client.query(
      `UPDATE part_instances SET status = 'in_stock', updated_at = NOW()
        WHERE instance_id = $1 AND status = 'reserved'`,
      [row.instance_id]
    );
  }
  await logEvent(client, {
    ticketId: row.support_ticket_id, lineId: row.support_line_id, actorId,
    eventType: 'PART_REJECTED', summary: `Rejected ${row.request_number}`, detail: { reason },
  });
  await refreshLine(client, row.support_line_id);
  return loadRequest(client, requestId);
}

async function escalateRequest(client, requestId, actorId) {
  const row = await loadRequest(client, requestId, { forUpdate: true });
  await client.query(
    `UPDATE part_requests
        SET status_v2 = 'ESCALATED_TO_PROCUREMENT', status = 'escalated',
            escalated_by = $2, escalated_at = NOW(), updated_at = NOW()
      WHERE request_id = $1`,
    [requestId, actorId]
  );
  await logEvent(client, {
    ticketId: row.support_ticket_id, lineId: row.support_line_id, actorId,
    eventType: 'PART_ESCALATED', summary: `Escalated ${row.request_number}`,
  });
  await refreshLine(client, row.support_line_id);
  return loadRequest(client, requestId);
}

async function issueRequest(client, requestId, body, actorId) {
  const row = await loadRequest(client, requestId, { forUpdate: true });
  if (!['RESERVED', 'APPROVED'].includes(row.status_v2)) {
    fail(`Cannot issue a request in ${row.status_v2}`, 409);
  }
  if (row.needs_lead_approval) {
    const ap = row.approval_id
      ? (await client.query(
        `SELECT status FROM support_approvals WHERE approval_id = $1`,
        [row.approval_id]
      )).rows[0]
      : null;
    if (!ap || ap.status !== 'APPROVED') {
      fail('This part needs support-lead approval before it can be issued', 409);
    }
  }
  if (!body.signature_attachment_id) fail('signature_attachment_id required', 400);
  if (row.instance_id) {
    await client.query(
      `UPDATE part_instances SET status = 'with_technician', updated_at = NOW()
        WHERE instance_id = $1`,
      [row.instance_id]
    );
  }
  await client.query(
    `UPDATE part_requests SET status_v2 = 'ISSUED', status = 'approved', updated_at = NOW()
      WHERE request_id = $1`,
    [requestId]
  );
  await logEvent(client, {
    ticketId: row.support_ticket_id, lineId: row.support_line_id, woId: row.work_order_id,
    actorId, eventType: 'PART_ISSUED', summary: `Issued ${row.request_number}`,
    detail: { signature_attachment_id: body.signature_attachment_id },
  });
  await refreshLine(client, row.support_line_id);
  return loadRequest(client, requestId);
}

function assertOwn(row, userId) {
  if (Number(row.requested_by) !== Number(userId)) {
    fail('You can only consume or return your own part request', 403);
  }
}

async function consumePart(client, requestId, body, actorId) {
  const row = await loadRequest(client, requestId, { forUpdate: true });
  if (row.status_v2 === 'CONSUMED') return row;
  if (!['ISSUED', 'IN_TRANSIT', 'DELIVERED', 'RESERVED'].includes(row.status_v2)) {
    fail(`Cannot consume a request in ${row.status_v2}`, 409);
  }
  assertOwn(row, actorId);
  const photos = assertPhotos(body.photo_attachment_ids || (body.fitted_photo_attachment_id ? [body.fitted_photo_attachment_id] : []));

  if (row.instance_id) {
    const scanned = body.instance_id || body.part_instance_id || body.prt_id;
    if (scanned) {
      const inst = await client.query(
        `SELECT instance_id, prt_id, part_id FROM part_instances
          WHERE instance_id::text = $1 OR prt_id = $1`,
        [String(scanned)]
      );
      const hit = inst.rows[0];
      if (!hit || Number(hit.instance_id) !== Number(row.instance_id) || Number(hit.part_id) !== Number(row.part_id)) {
        fail('Scanned part does not match the reserved instance', 409, 'PART_MISMATCH');
      }
    }
  }

  if (row.support_line_id) {
    const line = (await client.query(
      'SELECT serial_number, ttspl_id, serial_id FROM support_ticket_assets WHERE line_id = $1',
      [row.support_line_id]
    )).rows[0];
    const scannedAsset = String(body.asset_serial || body.serial_number || '').trim();
    if (scannedAsset) {
      const ok = [line && line.serial_number, line && line.ttspl_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase() === scannedAsset.toLowerCase());
      if (!ok) fail('Scanned laptop serial does not match this machine', 409, 'ASSET_MISMATCH');
    } else {
      fail('Laptop serial scan is required', 400);
    }
    if (row.instance_id && line) {
      await client.query(
        `UPDATE part_instances
            SET status = 'installed', installed_ttspl_id = $2, installed_at = NOW(), updated_at = NOW()
          WHERE instance_id = $1`,
        [row.instance_id, line.ttspl_id || null]
      );
      if (line.serial_id && row.part_cost) {
        await client.query(
          `UPDATE vendor_serial_numbers
              SET extra = COALESCE(extra,'{}'::jsonb)
                  || jsonb_build_object('support_part_tco',
                       COALESCE((extra->>'support_part_tco')::numeric, 0) + $2::numeric)
            WHERE serial_id = $1`,
          [line.serial_id, Number(row.part_cost) || 0]
        );
      }
    }
  }

  if (row.part_id) {
    await client.query(
      `UPDATE parts SET quantity = GREATEST(0, COALESCE(quantity,0) - $2), updated_at = NOW()
        WHERE part_id = $1`,
      [row.part_id, Number(row.quantity) || 1]
    );
  }

  await client.query(
    `UPDATE part_requests
        SET status_v2 = 'CONSUMED', status = 'attached', attached_at = NOW(), attached_by = $2,
            photo_attachment_ids = photo_attachment_ids || $3::jsonb, updated_at = NOW()
      WHERE request_id = $1`,
    [requestId, actorId, JSON.stringify(photos)]
  );

  if (row.liability === 'CUSTOMER_CHARGEABLE' && Number(row.charge_amount) > 0 && row.support_ticket_id) {
    const ticket = (await client.query(
      'SELECT customer_id FROM support_tickets_v2 WHERE ticket_id = $1',
      [row.support_ticket_id]
    )).rows[0];
    await client.query(
      `INSERT INTO customer_invoice_extra_lines (
         ticket_id, line_id, customer_id, charge_type, description, amount, status, photo_attachment_ids,
         billing_mode, source_part_request_id, source_wo_id, unit_price, quantity, gst_rate, hsn_code,
         raised_at, raised_by
       ) VALUES (
         $1,$2,$3,'CHARGEABLE_PART',$4,$5,'PENDING',$6::jsonb,
         'MONTHLY',$7,$8,$9,$10,$11,$12, NOW(), $13
       )`,
      [
        row.support_ticket_id, row.support_line_id, ticket && ticket.customer_id,
        `Part ${row.request_number} · ${row.part_name || row.catalog_name}`,
        row.charge_amount, JSON.stringify(photos),
        row.request_id, row.work_order_id || null,
        row.unit_selling_price || row.charge_amount,
        Number(row.quantity) || 1, 18, null, actorId,
      ]
    );
  }

  let returnWo = null;
  if (row.collect_old_part && row.support_ticket_id && row.support_line_id && !row.return_wo_id) {
    const window = sameDayWindow();
    returnWo = await createWorkOrder(client, row.support_ticket_id, {
      wo_type: 'PART_RETURN',
      line_ids: [row.support_line_id],
      assigned_to: row.requested_by,
      linked_wo_id: row.work_order_id || null,
      scheduled_start: window.scheduled_start,
      scheduled_end: window.scheduled_end,
      notes: `Old part return for ${row.request_number}`,
    }, actorId);
    await client.query(
      `UPDATE part_requests SET return_wo_id = $2, updated_at = NOW() WHERE request_id = $1`,
      [requestId, returnWo.wo_id]
    );
  }

  await logEvent(client, {
    ticketId: row.support_ticket_id, lineId: row.support_line_id, woId: row.work_order_id,
    actorId, eventType: 'PART_CONSUMED', summary: `Fitted ${row.request_number}`,
    detail: { return_wo_id: returnWo && returnWo.wo_id },
  });
  await refreshLine(client, row.support_line_id);
  return { ...(await loadRequest(client, requestId)), return_wo: returnWo };
}

async function returnUnused(client, requestId, actorId) {
  const row = await loadRequest(client, requestId, { forUpdate: true });
  assertOwn(row, actorId);
  if (row.instance_id) {
    await client.query(
      `UPDATE part_instances SET status = 'in_stock', updated_at = NOW() WHERE instance_id = $1`,
      [row.instance_id]
    );
  }
  await client.query(
    `UPDATE part_requests SET status_v2 = 'RETURNED_UNUSED', updated_at = NOW() WHERE request_id = $1`,
    [requestId]
  );
  await logEvent(client, {
    ticketId: row.support_ticket_id, lineId: row.support_line_id, actorId,
    eventType: 'PART_RETURNED_UNUSED', summary: `Unused return ${row.request_number}`,
  });
  await refreshLine(client, row.support_line_id);
  return loadRequest(client, requestId);
}

async function cancelRequest(client, requestId, actorId) {
  const row = await loadRequest(client, requestId, { forUpdate: true });
  if (!['REQUESTED', 'ESCALATED_TO_PROCUREMENT'].includes(row.status_v2)) {
    fail(`Cannot cancel a request in ${row.status_v2}`, 409);
  }
  await client.query(
    `UPDATE part_requests SET status_v2 = 'CANCELLED', status = 'cancelled', updated_at = NOW()
      WHERE request_id = $1`,
    [requestId]
  );
  await logEvent(client, {
    ticketId: row.support_ticket_id, lineId: row.support_line_id, actorId,
    eventType: 'PART_CANCELLED', summary: `Cancelled ${row.request_number}`,
  });
  await refreshLine(client, row.support_line_id);
  return loadRequest(client, requestId);
}

async function requestByWo(client, woId) {
  const r = await client.query(
    `SELECT * FROM part_requests
      WHERE work_order_id = $1 OR return_wo_id = $1
      ORDER BY request_id DESC LIMIT 1`,
    [woId]
  );
  return r.rows[0] || null;
}

module.exports = {
  compatibleParts,
  createPartRequest,
  listRequests,
  listQueue,
  approveRequest,
  rejectRequest,
  escalateRequest,
  issueRequest,
  consumePart,
  returnUnused,
  cancelRequest,
  loadRequest,
  requestByWo,
  OPEN_FIELD_PART_STATUSES,
};
