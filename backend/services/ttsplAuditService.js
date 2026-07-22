const pool = require('../config/db');

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function syntheticId(prefix, seed) {
  let h = 0;
  const s = `${prefix}:${seed}`;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `syn-${Math.abs(h)}`;
}

function makeSyntheticEvent({
  eventType,
  description,
  createdAt,
  actorName,
  metadata = {},
  vendorSerialId
}) {
  const ts = createdAt ? new Date(createdAt).toISOString() : new Date().toISOString();
  return {
    log_id: syntheticId(eventType, `${ts}:${description}`),
    event_type: eventType,
    description,
    created_at: createdAt || new Date(),
    actor_name_resolved: actorName || null,
    actor_name: actorName || null,
    metadata,
    vendor_serial_id: vendorSerialId || null,
    synthetic: true
  };
}

function activityEventType(action) {
  const a = String(action || '').toLowerCase();
  if (a === 'created') return 'ticket_created';
  if (a.includes('stage') || a === 'assigned') return 'stage_changed';
  if (a === 'part_added') return 'parts_used';
  if (a === 'completed') return 'inventory_ready';
  if (a.includes('qc')) return 'qc2_passed';
  if (a.includes('chip')) return 'chip_repair_started';
  if (a.includes('body') || a.includes('paint')) return 'body_paint_started';
  if (a === 'diagnosis_failed') return 'diagnosis_failed';
  if (a === 'out_for_repair') return 'dispatched_to_vendor';
  if (a === 'returned_from_vendor') return 'returned_from_vendor';
  return 'default';
}

function mergeEvents(persisted, synthetic) {
  const seen = new Set();
  const out = [];
  for (const ev of [...persisted, ...synthetic]) {
    const key = `${ev.event_type}|${new Date(ev.created_at).toISOString()}|${String(ev.description || '').slice(0, 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  out.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return out;
}

async function resolveTtsplAsset(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;

  let vsnRes = await pool.query(
    `SELECT vsn.*,
            vpo.purchase_order_number,
            v.business_name AS vendor_name
     FROM vendor_serial_numbers vsn
     JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
     LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id
     WHERE vsn.deleted_at IS NULL
       AND (
         UPPER(COALESCE(vsn.inventory_asset_code, '')) = $1
         OR UPPER(vsn.serial_number) = $1
         OR UPPER(COALESCE(vsn.extra->>'ttspl_id', '')) = $1
         OR UPPER(COALESCE(vsn.extra->>'unique_product_serial', '')) = $1
       )
     ORDER BY vsn.serial_id DESC
     LIMIT 1`,
    [code]
  );

  if (!vsnRes.rows.length) {
    const invRes = await pool.query(
      `SELECT serial_number, machine_number FROM inventory
       WHERE UPPER(COALESCE(machine_number, '')) = $1
          OR UPPER(COALESCE(serial_number, '')) = $1
       ORDER BY inventory_id DESC
       LIMIT 1`,
      [code]
    );
    const inv = invRes.rows[0];
    if (inv?.serial_number) {
      vsnRes = await pool.query(
        `SELECT vsn.*,
                vpo.purchase_order_number,
                v.business_name AS vendor_name
         FROM vendor_serial_numbers vsn
         JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
         LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id
         WHERE vsn.deleted_at IS NULL AND UPPER(vsn.serial_number) = $1
         ORDER BY vsn.serial_id DESC
         LIMIT 1`,
        [normalizeCode(inv.serial_number)]
      );
    }
  }

  const vsn = vsnRes.rows[0] || null;
  const canonicalTtspl = normalizeCode(
    vsn?.inventory_asset_code
    || vsn?.extra?.ttspl_id
    || vsn?.extra?.unique_product_serial
    || code
  );
  const aliases = new Set(
    [code, canonicalTtspl, vsn?.serial_number, vsn?.extra?.ttspl_id, vsn?.extra?.unique_product_serial]
      .filter(Boolean)
      .map(normalizeCode)
  );

  return {
    code,
    canonicalTtspl,
    aliases: [...aliases],
    serialId: vsn?.serial_id || null,
    serialNumber: vsn?.serial_number || null,
    vsn
  };
}

async function logTtsplEvent({
  ttsplId,
  vendorSerialId,
  eventType,
  description,
  metadata = {},
  actorUserId,
  actorName,
  db
}) {
  if (!ttsplId) return;
  const client = db || pool;
  await client.query(
    `INSERT INTO ttspl_audit_log
      (ttspl_id, vendor_serial_id, event_type, description, metadata,
       actor_user_id, actor_name)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [
      normalizeCode(ttsplId) || ttsplId,
      vendorSerialId || null,
      eventType,
      description,
      JSON.stringify(metadata),
      actorUserId || null,
      actorName || null
    ]
  );
}

async function logGrnReceive({
  ttsplId,
  vendorSerialId,
  serialNumber,
  poLabel,
  actorUserId,
  db
}) {
  const label = ttsplId || serialNumber;
  if (!label) return;
  await logTtsplEvent({
    ttsplId: label,
    vendorSerialId,
    eventType: 'received',
    description: `Unit received via GRN${poLabel ? ` (PO ${poLabel})` : ''} — serial ${serialNumber}`,
    metadata: { serial_number: serialNumber, po: poLabel || null },
    actorUserId,
    db
  });
}

async function logConfigChange({
  ttsplId,
  vendorSerialId,
  ticketId,
  changedBy,
  changeType,
  fieldName,
  oldValue,
  newValue,
  notes,
  partUsedId,
  partCost = 0,
  db
}) {
  if (!ttsplId) return;
  const client = db || pool;
  await client.query(
    `INSERT INTO ttspl_config_history
      (ttspl_id, vendor_serial_id, ticket_id, changed_by, change_type,
       field_name, old_value, new_value, notes, part_used_id, part_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      normalizeCode(ttsplId) || ttsplId,
      vendorSerialId || null,
      ticketId || null,
      changedBy || null,
      changeType,
      fieldName,
      oldValue || null,
      newValue || null,
      notes || null,
      partUsedId || null,
      partCost
    ]
  );
}

async function fetchPersistedAuditLog(ctx) {
  const { aliases, serialId } = ctx;
  const params = [aliases];
  let where = `UPPER(l.ttspl_id) = ANY($1::text[])`;
  if (serialId) {
    params.push(serialId);
    where += ` OR l.vendor_serial_id = $${params.length}`;
  }
  const res = await pool.query(
    `SELECT l.*, COALESCE(l.actor_name, u.name) AS actor_name_resolved
     FROM ttspl_audit_log l
     LEFT JOIN users u ON u.user_id = l.actor_user_id
     WHERE ${where}
     ORDER BY l.created_at ASC`,
    params
  );
  return res.rows.map((row) => ({ ...row, synthetic: false }));
}

async function fetchConfigHistory(ctx) {
  const { aliases, serialId } = ctx;
  const params = [aliases];
  let where = `UPPER(h.ttspl_id) = ANY($1::text[])`;
  if (serialId) {
    params.push(serialId);
    where += ` OR h.vendor_serial_id = $${params.length}`;
  }
  const res = await pool.query(
    `SELECT h.*, u.name AS changed_by_name
     FROM ttspl_config_history h
     LEFT JOIN users u ON u.user_id = h.changed_by
     WHERE ${where}
     ORDER BY h.created_at ASC`,
    params
  );
  return res.rows;
}

async function buildSyntheticLifecycleEvents(ctx) {
  const events = [];
  const { vsn, serialId, canonicalTtspl, aliases, serialNumber } = ctx;
  if (!vsn && !serialId) return events;

  if (vsn) {
    const poLabel = vsn.purchase_order_number || (vsn.po_id ? String(vsn.po_id) : '');
    events.push(makeSyntheticEvent({
      eventType: 'received',
      description: `Unit received via GRN${poLabel ? ` (PO ${poLabel})` : ''} — serial ${vsn.serial_number}`,
      createdAt: vsn.created_at,
      vendorSerialId: serialId,
      metadata: {
        po_id: vsn.po_id,
        grn_id: vsn.grn_id,
        serial_number: vsn.serial_number,
        vendor: vsn.vendor_name || null
      }
    }));

    if (vsn.inventory_asset_code) {
      events.push(makeSyntheticEvent({
        eventType: 'inventory_created',
        description: `TTSPL asset code assigned: ${vsn.inventory_asset_code}`,
        createdAt: vsn.created_at,
        vendorSerialId: serialId,
        metadata: { ttspl_id: canonicalTtspl }
      }));
    }

    const qc = String(vsn.qc_status || '').toLowerCase();
    const qcAt = vsn.status_changed_at || vsn.updated_at || vsn.created_at;
    if (qc === 'passed') {
      events.push(makeSyntheticEvent({
        eventType: 'qc2_passed',
        description: 'Vendor QC passed — unit ready for inventory',
        createdAt: qcAt,
        vendorSerialId: serialId,
        metadata: { qc_status: qc, inventory_status: vsn.inventory_status }
      }));
    } else if (qc === 'failed' || qc === 'dead') {
      events.push(makeSyntheticEvent({
        eventType: 'qc1_failed',
        description: `Vendor QC ${qc}${vsn.remark ? `: ${vsn.remark}` : ''}`,
        createdAt: qcAt,
        vendorSerialId: serialId,
        metadata: { qc_status: qc }
      }));
    } else if (qc === 'pending') {
      events.push(makeSyntheticEvent({
        eventType: 'qc_started',
        description: 'Unit pending vendor/QC check',
        createdAt: vsn.created_at,
        vendorSerialId: serialId
      }));
    }

    const invSt = String(vsn.inventory_status || '').toLowerCase();
    if (invSt && vsn.status_changed_at && !['pending', ''].includes(invSt)) {
      events.push(makeSyntheticEvent({
        eventType: `status_${invSt}`,
        description: `Inventory status: ${invSt.replace(/_/g, ' ')}`,
        createdAt: vsn.status_changed_at,
        vendorSerialId: serialId,
        metadata: {
          inventory_status: invSt,
          customer_id: vsn.current_customer_id,
          dc_number: vsn.current_dc_number,
          entity: vsn.current_entity
        }
      }));
    }

    if (vsn.dispatched_at) {
      events.push(makeSyntheticEvent({
        eventType: 'status_in_transit',
        description: `Dispatched${vsn.current_dc_number ? ` on ${vsn.current_dc_number}` : ''}${vsn.dispatch_mode ? ` (${vsn.dispatch_mode})` : ''}`,
        createdAt: vsn.dispatched_at,
        vendorSerialId: serialId,
        metadata: { dc_number: vsn.current_dc_number, dispatch_mode: vsn.dispatch_mode }
      }));
    }
    if (vsn.delivered_at) {
      events.push(makeSyntheticEvent({
        eventType: 'status_delivered',
        description: `Delivered to customer${vsn.current_dc_number ? ` (${vsn.current_dc_number})` : ''}`,
        createdAt: vsn.delivered_at,
        vendorSerialId: serialId
      }));
    }
    if (vsn.returned_at) {
      events.push(makeSyntheticEvent({
        eventType: 'returned',
        description: 'Returned from customer',
        createdAt: vsn.returned_at,
        vendorSerialId: serialId
      }));
    }
  }

  const aliasArr = aliases.length ? aliases : [canonicalTtspl];

  const [
    invRes,
    allocRes,
    transitionsRes,
    ticketsRes,
    activitiesRes,
    soSerialsRes,
    dcRes,
    repairRes,
    supportRes
  ] = await Promise.all([
    pool.query(
      `SELECT inventory_id, status, stage, created_at, updated_at
       FROM inventory
       WHERE UPPER(COALESCE(machine_number, '')) = ANY($1::text[])
          OR UPPER(COALESCE(serial_number, '')) = ANY($1::text[])
       ORDER BY created_at ASC`,
      [aliasArr]
    ),
    serialNumber || canonicalTtspl
      ? pool.query(
        `SELECT action_taken, qc_status, remarks, added_date, checked_by, log_type
         FROM allocation_logs
         WHERE UPPER(serial_number) = ANY($1::text[])
            OR UPPER(COALESCE(unique_id, '')) = ANY($1::text[])
         ORDER BY added_date ASC`,
        [aliasArr]
      )
      : Promise.resolve({ rows: [] }),
    serialId
      ? pool.query(
        `SELECT ist.*, u.name AS actor_name
         FROM inventory_status_transitions ist
         LEFT JOIN users u ON u.user_id = ist.actor_user_id
         WHERE ist.serial_id = $1
            OR UPPER(COALESCE(ist.ttspl_id, '')) = ANY($2::text[])
         ORDER BY ist.created_at ASC`,
        [serialId, aliasArr]
      )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.status, t.ticket_type,
              t.created_at, t.completed_at, s.stage_name, u.name AS assigned_name
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
       LEFT JOIN users u ON u.user_id = t.assigned_user_id
       WHERE ($1::int IS NOT NULL AND t.vendor_serial_id = $1)
          OR UPPER(COALESCE(t.ttspl_id, '')) = ANY($2::text[])
          OR UPPER(COALESCE(t.serial_number, '')) = ANY($2::text[])
       ORDER BY t.created_at ASC`,
      [serialId, aliasArr]
    ),
    pool.query(
      `SELECT a.activity_id, a.action, a.notes, a.created_at, u.name AS actor_name,
              s.stage_name, a.ticket_id
       FROM activities a
       JOIN tickets t ON t.ticket_id = a.ticket_id
       LEFT JOIN users u ON u.user_id = a.user_id
       LEFT JOIN stages s ON s.stage_id = a.stage_id
       WHERE ($1::int IS NOT NULL AND t.vendor_serial_id = $1)
          OR UPPER(COALESCE(t.ttspl_id, '')) = ANY($2::text[])
          OR UPPER(COALESCE(t.serial_number, '')) = ANY($2::text[])
       ORDER BY a.created_at ASC`,
      [serialId, aliasArr]
    ),
    pool.query(
      `SELECT sos.*, u.name AS created_by_name
       FROM sales_order_serials sos
       LEFT JOIN users u ON u.user_id = sos.created_by
       WHERE ($1::int IS NOT NULL AND sos.serial_id = $1)
          OR UPPER(COALESCE(sos.ttspl_id, '')) = ANY($2::text[])
          OR UPPER(COALESCE(sos.serial_number, '')) = ANY($2::text[])
       ORDER BY sos.created_at ASC`,
      [serialId, aliasArr]
    ),
    pool.query(
      `SELECT dcl.dc_number, dcl.sales_order_number, dcl.status, dcl.movement_type,
              dcl.customer_name, dcl.created_at, dcl.updated_at, u.name AS created_by_name
       FROM delivery_challan_lines dcl
       LEFT JOIN users u ON u.user_id = dcl.created_by
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(
           CASE jsonb_typeof(COALESCE(dcl.serial_number, 'null'::jsonb))
             WHEN 'array' THEN dcl.serial_number
             ELSE '[]'::jsonb
           END
         ) elem WHERE UPPER(elem) = ANY($1::text[])
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(COALESCE(dcl.delivered_serial_numbers, '[]'::jsonb)) elem
         WHERE UPPER(elem) = ANY($1::text[])
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(COALESCE(dcl.pickuped_serial_numbers, '[]'::jsonb)) elem
         WHERE UPPER(elem) = ANY($1::text[])
       )
       ORDER BY dcl.created_at ASC`,
      [aliasArr]
    ),
    serialId
      ? pool.query(
        `SELECT id, type, remarks, repair_start_date, repair_end_date, created_at
         FROM repair_logs
         WHERE serial_number_id = $1
         ORDER BY created_at ASC`,
        [serialId]
      )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT st.id, st.status, st.created_at, sti.issue_category_label, sti.remarks
       FROM support_ticket_items sti
       JOIN support_tickets st ON st.id = sti.ticket_id
       WHERE UPPER(COALESCE(sti.unique_serial_number, '')) = ANY($1::text[])
          OR UPPER(COALESCE(sti.serial_number, '')) = ANY($1::text[])
       ORDER BY st.created_at ASC`,
      [aliasArr]
    )
  ]);

  for (const inv of invRes.rows) {
    events.push(makeSyntheticEvent({
      eventType: 'inventory_ready',
      description: `Inventory record: ${inv.status || 'Unknown'}${inv.stage ? ` — ${inv.stage}` : ''}`,
      createdAt: inv.created_at,
      metadata: { inventory_id: inv.inventory_id, status: inv.status, stage: inv.stage }
    }));
  }

  for (const row of allocRes.rows) {
    const qc = String(row.qc_status || '').toLowerCase();
    let eventType = 'default';
    if (qc === 'passed') eventType = 'qc2_passed';
    else if (qc === 'failed') eventType = 'qc1_failed';
    else if (String(row.action_taken || '').toLowerCase().includes('assign')) eventType = 'vendor_assigned';

    events.push(makeSyntheticEvent({
      eventType,
      description: row.remarks
        || (row.action_taken ? `Vendor allocation: ${row.action_taken}` : 'Vendor allocation update'),
      createdAt: row.added_date,
      actorName: row.checked_by,
      vendorSerialId: serialId,
      metadata: {
        action_taken: row.action_taken,
        qc_status: row.qc_status,
        log_type: row.log_type
      }
    }));
  }

  for (const tr of transitionsRes.rows) {
    events.push(makeSyntheticEvent({
      eventType: `status_${String(tr.to_status || '').toLowerCase()}`,
      description: tr.reason || `Status: ${tr.from_status || 'new'} → ${tr.to_status}`,
      createdAt: tr.created_at,
      actorName: tr.actor_name,
      vendorSerialId: serialId,
      metadata: {
        from: tr.from_status,
        to: tr.to_status,
        dc_number: tr.dc_number,
        customer_id: tr.customer_id,
        entity: tr.entity_code
      }
    }));
  }

  for (const t of ticketsRes.rows) {
    events.push(makeSyntheticEvent({
      eventType: 'ticket_created',
      description: `${t.ticket_type || 'Repair'} ticket #${t.ticket_id} opened${t.stage_name ? ` (${t.stage_name})` : ''}`,
      createdAt: t.created_at,
      actorName: t.assigned_name,
      vendorSerialId: serialId,
      metadata: { ticket_id: t.ticket_id, ticket_type: t.ticket_type, status: t.status }
    }));
    if (t.completed_at && t.status === 'completed') {
      events.push(makeSyntheticEvent({
        eventType: 'inventory_ready',
        description: `Ticket #${t.ticket_id} completed`,
        createdAt: t.completed_at,
        vendorSerialId: serialId,
        metadata: { ticket_id: t.ticket_id }
      }));
    }
  }

  for (const a of activitiesRes.rows) {
    const desc = a.notes || `${a.action}${a.stage_name ? ` — ${a.stage_name}` : ''}`;
    events.push(makeSyntheticEvent({
      eventType: activityEventType(a.action),
      description: desc,
      createdAt: a.created_at,
      actorName: a.actor_name,
      vendorSerialId: serialId,
      metadata: { ticket_id: a.ticket_id, action: a.action, stage: a.stage_name }
    }));
  }

  for (const sos of soSerialsRes.rows) {
    events.push(makeSyntheticEvent({
      eventType: 'sales_order_created',
      description: `Attached to sales order ${sos.sales_order_number}${sos.dc_number ? ` (DC ${sos.dc_number})` : ''}`,
      createdAt: sos.created_at,
      actorName: sos.created_by_name,
      vendorSerialId: serialId,
      metadata: {
        sales_order_number: sos.sales_order_number,
        status: sos.status,
        qc_status: sos.qc_status,
        dc_number: sos.dc_number
      }
    }));
    if (sos.status === 'dispatched' && sos.updated_at) {
      events.push(makeSyntheticEvent({
        eventType: 'status_in_transit',
        description: `Dispatched on SO ${sos.sales_order_number}${sos.dc_number ? ` — ${sos.dc_number}` : ''}`,
        createdAt: sos.updated_at,
        vendorSerialId: serialId,
        metadata: { sales_order_number: sos.sales_order_number, dc_number: sos.dc_number }
      }));
    }
  }

  for (const dc of dcRes.rows) {
    const isReturn = String(dc.movement_type || '').toLowerCase() === 'return';
    events.push(makeSyntheticEvent({
      eventType: isReturn ? 'returned' : 'delivery_challan_created',
      description: isReturn
        ? `Return DC ${dc.dc_number} — ${dc.customer_name || 'customer'}`
        : `Delivery challan ${dc.dc_number} created${dc.sales_order_number ? ` (SO ${dc.sales_order_number})` : ''}`,
      createdAt: dc.created_at,
      actorName: dc.created_by_name,
      vendorSerialId: serialId,
      metadata: {
        dc_number: dc.dc_number,
        sales_order_number: dc.sales_order_number,
        status: dc.status,
        movement_type: dc.movement_type
      }
    }));
    if (dc.status === 'delivered' && dc.updated_at) {
      events.push(makeSyntheticEvent({
        eventType: 'status_delivered',
        description: `DC ${dc.dc_number} marked delivered`,
        createdAt: dc.updated_at,
        vendorSerialId: serialId,
        metadata: { dc_number: dc.dc_number }
      }));
    }
  }

  for (const r of repairRes.rows) {
    events.push(makeSyntheticEvent({
      eventType: 'chip_repair_started',
      description: r.remarks || `Repair/service (${r.type || 'service'})`,
      createdAt: r.repair_start_date || r.created_at,
      vendorSerialId: serialId,
      metadata: { repair_id: r.id, type: r.type, repair_end_date: r.repair_end_date }
    }));
  }

  for (const st of supportRes.rows) {
    events.push(makeSyntheticEvent({
      eventType: 'support_ticket',
      description: `Support ticket #${st.id}${st.issue_category_label ? `: ${st.issue_category_label}` : ''}`,
      createdAt: st.created_at,
      vendorSerialId: serialId,
      metadata: { support_ticket_id: st.id, status: st.status, remarks: st.remarks }
    }));
  }

  return events;
}

async function computeCostSummary(ctx) {
  const { aliases, serialId, canonicalTtspl } = ctx;
  const aliasArr = aliases.length ? aliases : [canonicalTtspl];

  const [partsRes, baseRes] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(tp.quantity_used * COALESCE(tp.unit_cost, p.cost, 0)), 0)::numeric AS parts_cost
       FROM tickets t
       JOIN ticket_parts tp ON tp.ticket_id = t.ticket_id
       LEFT JOIN parts p ON p.part_id = tp.part_id
       WHERE ($1::int IS NOT NULL AND t.vendor_serial_id = $1)
          OR UPPER(COALESCE(t.ttspl_id, '')) = ANY($2::text[])
          OR UPPER(COALESCE(t.serial_number, '')) = ANY($2::text[])`,
      [serialId, aliasArr]
    ),
    serialId
      ? pool.query(
        `SELECT COALESCE(MAX(vpd.rate), 0)::numeric AS base_cost
         FROM vendor_serial_numbers vsn
         LEFT JOIN vendor_product_details vpd ON vpd.po_id = vsn.po_id
         WHERE vsn.serial_id = $1`,
        [serialId]
      )
      : pool.query(
        `SELECT COALESCE(MAX(vpd.rate), 0)::numeric AS base_cost
         FROM vendor_serial_numbers vsn
         LEFT JOIN vendor_product_details vpd ON vpd.po_id = vsn.po_id
         WHERE UPPER(COALESCE(vsn.inventory_asset_code, '')) = ANY($1::text[])`,
        [aliasArr]
      )
  ]);

  const partsCost = parseFloat(partsRes.rows[0]?.parts_cost) || 0;
  const baseCost = parseFloat(baseRes.rows[0]?.base_cost) || 0;

  return {
    parts_cost: partsCost,
    base_cost: baseCost,
    total_cost: partsCost + baseCost
  };
}

async function getTtsplHistory(rawCode) {
  const ctx = await resolveTtsplAsset(rawCode);
  if (!ctx) {
    return {
      auditLog: [],
      configHistory: [],
      costSummary: { parts_cost: 0, base_cost: 0, total_cost: 0 },
      asset: null
    };
  }

  const [persistedAudit, configHistory, synthetic, costSummary] = await Promise.all([
    fetchPersistedAuditLog(ctx),
    fetchConfigHistory(ctx),
    buildSyntheticLifecycleEvents(ctx),
    computeCostSummary(ctx)
  ]);

  const auditLog = mergeEvents(persistedAudit, synthetic);

  return {
    auditLog,
    configHistory,
    costSummary,
    asset: {
      ttspl_id: ctx.canonicalTtspl,
      serial_id: ctx.serialId,
      serial_number: ctx.serialNumber
    }
  };
}

module.exports = {
  logTtsplEvent,
  logGrnReceive,
  logConfigChange,
  getTtsplHistory,
  resolveTtsplAsset
};
