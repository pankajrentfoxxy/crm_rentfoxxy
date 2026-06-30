const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { closeOpenWorkLogs } = require('./ticketWorkLogService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { generateVendorRepairPdf } = require('./vendorRepairPdfService');

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);
const HW_SW_STAGES = new Set([
  'Diagnosis', 'Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint',
]);

let schemaEnsured = false;

function currentFinancialYearLabel(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  const a = String(startYear % 100).padStart(2, '0');
  const b = String((startYear + 1) % 100).padStart(2, '0');
  return `${a}-${b}`;
}

async function ensureVendorRepairSchema() {
  if (schemaEnsured) return;
  const migrationPath = path.join(__dirname, '../migrations/121_diagnosis_failed_vendor_repair.sql');
  if (fs.existsSync(migrationPath)) {
    await pool.query(fs.readFileSync(migrationPath, 'utf8'));
  }
  schemaEnsured = true;
}

function configString(ticket) {
  return [ticket.brand, ticket.model, ticket.processor, ticket.generation, ticket.ram, ticket.storage]
    .filter(Boolean).join(' · ');
}

function saveEsign(prefix, dcNumber, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const dir = path.join(__dirname, '../uploads/vendor-repair');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
  const filename = `${prefix}_${safe}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(m[2], 'base64'));
  return `vendor-repair/${filename}`;
}

async function logTicketActivity(client, { ticketId, userId, action, notes, stageId }) {
  await client.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    [ticketId, stageId || null, userId || null, action, notes || null]
  );
}

async function nextVendorRepairDcNumber(client) {
  const fy = currentFinancialYearLabel();
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(dc_number, '/([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM vendor_repair_delivery_challans
      WHERE dc_number LIKE $1`,
    [`VRDC/${fy}/%`]
  );
  const seq = String(r.rows[0]?.n || 1).padStart(4, '0');
  return `VRDC/${fy}/${seq}`;
}

async function markDiagnosisFailed(client, {
  ticketId, reason, actorUserId, actorName,
}) {
  if (!reason?.trim()) throw new Error('Failure reason is required');

  const tRes = await client.query(
    `SELECT t.*, s.stage_name
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.ticket_id = $1 FOR UPDATE OF t`,
    [ticketId]
  );
  const ticket = tRes.rows[0];
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.status === 'diagnosis_failed') return { already_failed: true };
  if (['completed', 'cancelled', 'out_for_repair'].includes(ticket.status)) {
    throw new Error(`Cannot mark diagnosis failed from status "${ticket.status}"`);
  }
  if (ticket.stage_name && !HW_SW_STAGES.has(ticket.stage_name) && ticket.stage_name !== 'Floor Manager') {
    throw new Error('Diagnosis Failed is only available during Hardware & Software / Diagnosis stages');
  }

  await closeOpenWorkLogs(client, ticketId);

  await client.query(
    `UPDATE tickets SET
        status = 'diagnosis_failed',
        diagnosis_failed_at = NOW(),
        diagnosis_failed_reason = $2,
        diagnosis_failed_by = $3,
        previous_technician_id = assigned_user_id,
        previous_stage_id = current_stage_id,
        assigned_user_id = NULL,
        assigned_team_id = NULL,
        current_location = COALESCE(current_location, 'Warehouse'),
        highlighted = TRUE,
        highlighted_reason = $2,
        updated_at = NOW()
      WHERE ticket_id = $1`,
    [ticketId, reason.trim(), actorUserId]
  );

  if (ticket.vendor_serial_id) {
    await client.query(
      `UPDATE vendor_serial_numbers SET qc_status = 'pending', updated_at = NOW() WHERE serial_id = $1`,
      [ticket.vendor_serial_id]
    );
  }

  await logTicketActivity(client, {
    ticketId,
    userId: actorUserId,
    stageId: ticket.current_stage_id,
    action: 'diagnosis_failed',
    notes: reason.trim(),
  });

  await logTtsplEvent({
    ttsplId: ticket.ttspl_id,
    vendorSerialId: ticket.vendor_serial_id,
    eventType: 'diagnosis_failed',
    description: `Diagnosis failed: ${reason.trim()}`,
    metadata: {
      previous_technician_id: ticket.assigned_user_id,
      previous_stage_id: ticket.current_stage_id,
      previous_stage: ticket.stage_name,
    },
    actorUserId,
    actorName,
    db: client,
  });

  return { ticket_id: ticketId, status: 'diagnosis_failed' };
}

async function listDiagnosisFailedTickets() {
  const { rows } = await pool.query(
    `SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.status, t.brand, t.model,
            t.processor, t.ram, t.storage, t.diagnosis_failed_at,
            t.diagnosis_failed_reason, t.current_location, t.created_at,
            t.previous_technician_id, t.previous_stage_id,
            COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), '') AS generation,
            ps.stage_name AS previous_stage_name,
            pu.name AS previous_technician_name
       FROM tickets t
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id
       LEFT JOIN stages ps ON ps.stage_id = t.previous_stage_id
       LEFT JOIN users pu ON pu.user_id = t.previous_technician_id
      WHERE t.status = 'diagnosis_failed'
      ORDER BY t.diagnosis_failed_at DESC NULLS LAST, t.ticket_id DESC`
  );
  return rows.map((r) => ({
    ...r,
    configuration: configString(r),
  }));
}

async function createOutForRepairDc(client, {
  ticketIds,
  vendorId,
  vendorName,
  vendorAddress,
  contactPerson,
  contactMobile,
  expectedReturnDate,
  remarks,
  warehouseName,
  warehouseAddress,
  actorUserId,
  actorName,
}) {
  if (!Array.isArray(ticketIds) || !ticketIds.length) {
    throw new Error('Select at least one laptop');
  }
  if (!vendorName?.trim()) throw new Error('Vendor name is required');
  if (!vendorAddress?.trim()) throw new Error('Vendor address is required');

  const tRes = await client.query(
    `SELECT t.*, s.stage_name,
            COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), '') AS generation
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id
      WHERE t.ticket_id = ANY($1::int[]) FOR UPDATE OF t`,
    [ticketIds]
  );
  if (tRes.rows.length !== ticketIds.length) {
    throw new Error('One or more tickets were not found');
  }
  const invalid = tRes.rows.filter((t) => t.status !== 'diagnosis_failed');
  if (invalid.length) {
    throw new Error('All selected laptops must be in Diagnosis Failed status');
  }

  const dcNumber = await nextVendorRepairDcNumber(client);
  await client.query(
    `INSERT INTO vendor_repair_delivery_challans (
        dc_number, vendor_id, vendor_name, vendor_address, contact_person, contact_mobile,
        expected_return_date, remarks, warehouse_name, warehouse_address, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11)`,
    [
      dcNumber,
      vendorId || null,
      vendorName.trim(),
      vendorAddress.trim(),
      contactPerson?.trim() || null,
      contactMobile?.trim() || null,
      expectedReturnDate || null,
      remarks?.trim() || null,
      warehouseName?.trim() || process.env.COMPANY_NAME || 'Rentfoxxy Warehouse',
      warehouseAddress?.trim() || null,
      actorUserId,
    ]
  );

  for (const ticket of tRes.rows) {
    const configuration = configString(ticket);
    await client.query(
      `INSERT INTO vendor_repair_dc_items (dc_number, ticket_id, serial_id, ttspl_id, serial_number, configuration)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [dcNumber, ticket.ticket_id, ticket.vendor_serial_id, ticket.ttspl_id, ticket.serial_number, configuration]
    );
    await client.query(
      `UPDATE tickets SET vendor_repair_dc_number = $2, current_location = 'Warehouse — pending dispatch', updated_at = NOW()
        WHERE ticket_id = $1`,
      [ticket.ticket_id, dcNumber]
    );
    await logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'vendor_dc_generated',
      description: `Vendor repair DC ${dcNumber} created`,
      metadata: { dc_number: dcNumber, vendor_name: vendorName.trim() },
      actorUserId,
      actorName,
      db: client,
    });
    await logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'vendor_assigned',
      description: `Assigned to repair vendor: ${vendorName.trim()}`,
      metadata: { dc_number: dcNumber, vendor_name: vendorName.trim() },
      actorUserId,
      actorName,
      db: client,
    });
  }

  return { dc_number: dcNumber };
}

async function getVendorRepairDc(dcNumber) {
  const headRes = await pool.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) return null;
  const itemsRes = await pool.query(
    `SELECT i.*, t.status AS ticket_status, t.diagnosis_failed_reason
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
      WHERE i.dc_number = $1
      ORDER BY i.id ASC`,
    [dcNumber]
  );
  return { ...head, items: itemsRes.rows };
}

async function signDispatchDc(client, {
  dcNumber,
  warehouseEsign,
  vendorEsign,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (head.status === 'dispatched') return { already_dispatched: true };
  if (head.status === 'returned') throw new Error('DC already returned');

  const whUrl = warehouseEsign ? saveEsign('wh_dispatch', dcNumber, warehouseEsign) : head.warehouse_dispatch_esign_url;
  const vUrl = vendorEsign ? saveEsign('vendor_dispatch', dcNumber, vendorEsign) : head.vendor_dispatch_esign_url;
  if (!whUrl || !vUrl) throw new Error('Warehouse and vendor dispatch e-signatures are required');

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        warehouse_dispatch_esign_url = $2,
        vendor_dispatch_esign_url = $3,
        status = 'dispatched',
        dispatched_at = NOW(),
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, whUrl, vUrl]
  );

  const itemsRes = await client.query(
    `SELECT i.ticket_id, i.serial_id, i.ttspl_id, t.ttspl_id AS ticket_ttspl, t.vendor_serial_id
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
      WHERE i.dc_number = $1`,
    [dcNumber]
  );

  for (const item of itemsRes.rows) {
    await client.query(
      `UPDATE tickets SET status = 'out_for_repair', current_location = $2, updated_at = NOW()
        WHERE ticket_id = $1`,
      [item.ticket_id, `Out for repair — ${head.vendor_name}`]
    );
    if (item.vendor_serial_id || item.serial_id) {
      await client.query(
        `UPDATE vendor_serial_numbers SET
            qc_status = 'out_for_repair',
            extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
          WHERE serial_id = $1`,
        [
          item.vendor_serial_id || item.serial_id,
          JSON.stringify({ location: 'out_for_repair', vendor_repair_dc: dcNumber }),
        ]
      );
    }
    await logTtsplEvent({
      ttsplId: item.ttspl_id || item.ticket_ttspl,
      vendorSerialId: item.vendor_serial_id || item.serial_id,
      eventType: 'dispatched_to_vendor',
      description: `Dispatched to vendor via ${dcNumber}`,
      metadata: { dc_number: dcNumber, vendor_name: head.vendor_name },
      actorUserId,
      actorName,
      db: client,
    });
    await logTtsplEvent({
      ttsplId: item.ttspl_id || item.ticket_ttspl,
      vendorSerialId: item.vendor_serial_id || item.serial_id,
      eventType: 'esign_completed',
      description: `Dispatch e-sign completed for ${dcNumber}`,
      metadata: { dc_number: dcNumber },
      actorUserId,
      actorName,
      db: client,
    });
    await logTicketActivity(client, {
      ticketId: item.ticket_id,
      userId: actorUserId,
      action: 'out_for_repair',
      notes: `Dispatched to ${head.vendor_name} (${dcNumber})`,
    });
  }

  const pdfPath = await generateVendorRepairPdf(dcNumber);

  return { dc_number: dcNumber, status: 'dispatched', pdf_path: pdfPath };
}

async function receiveFromVendor(client, {
  dcNumber,
  warehouseEsign,
  vendorEsign,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (head.status !== 'dispatched') throw new Error('DC must be dispatched before receiving back');

  const whUrl = warehouseEsign ? saveEsign('wh_return', dcNumber, warehouseEsign) : head.warehouse_return_esign_url;
  const vUrl = vendorEsign ? saveEsign('vendor_return', dcNumber, vendorEsign) : head.vendor_return_esign_url;
  if (!whUrl || !vUrl) throw new Error('Warehouse and vendor return e-signatures are required');

  const qcStageRes = await client.query(`SELECT stage_id, team_id FROM stages WHERE stage_name = 'QC1' LIMIT 1`);
  const qcStageId = qcStageRes.rows[0]?.stage_id || null;
  const qcTeamId = qcStageRes.rows[0]?.team_id || null;

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        warehouse_return_esign_url = $2,
        vendor_return_esign_url = $3,
        status = 'returned',
        returned_at = NOW(),
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, whUrl, vUrl]
  );

  const itemsRes = await client.query(
    `SELECT i.*, t.*
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
      WHERE i.dc_number = $1`,
    [dcNumber]
  );

  for (const item of itemsRes.rows) {
    await client.query(
      `UPDATE tickets SET
          status = 'in_progress',
          current_stage_id = COALESCE($2, current_stage_id),
          assigned_user_id = NULL,
          assigned_team_id = $3,
          current_location = 'Warehouse — QC Process',
          highlighted = TRUE,
          highlighted_reason = 'Returned from vendor repair — QC Process',
          updated_at = NOW()
        WHERE ticket_id = $1`,
      [item.ticket_id, qcStageId, qcTeamId]
    );

    if (item.vendor_serial_id || item.serial_id) {
      await client.query(
        `UPDATE vendor_serial_numbers SET
            qc_status = 'pending',
            inventory_status = COALESCE(inventory_status, 'in_stock'),
            extra = COALESCE(extra, '{}'::jsonb) || '{"location":"warehouse_qc"}'::jsonb,
            updated_at = NOW()
          WHERE serial_id = $1`,
        [item.vendor_serial_id || item.serial_id]
      );
    }

    await logTicketActivity(client, {
      ticketId: item.ticket_id,
      userId: actorUserId,
      action: 'returned_from_vendor',
      notes: `Received from vendor via ${dcNumber} — re-entered QC Process`,
      stageId: qcStageId,
    });

    await logTtsplEvent({
      ttsplId: item.ttspl_id,
      vendorSerialId: item.vendor_serial_id || item.serial_id,
      eventType: 'returned_from_vendor',
      description: `Returned from vendor repair (${dcNumber}) — QC Process`,
      metadata: { dc_number: dcNumber, reentered_stage: 'QC1' },
      actorUserId,
      actorName,
      db: client,
    });

    await logTtsplEvent({
      ttsplId: item.ttspl_id,
      vendorSerialId: item.vendor_serial_id || item.serial_id,
      eventType: 'vendor_return',
      description: `Vendor return acknowledgement (${dcNumber})`,
      metadata: { dc_number: dcNumber },
      actorUserId,
      actorName,
      db: client,
    });

    await logTtsplEvent({
      ttsplId: item.ttspl_id,
      vendorSerialId: item.vendor_serial_id || item.serial_id,
      eventType: 'received_at_warehouse',
      description: `Received at warehouse from vendor (${dcNumber})`,
      metadata: { dc_number: dcNumber },
      actorUserId,
      actorName,
      db: client,
    });

    await logTtsplEvent({
      ttsplId: item.ttspl_id,
      vendorSerialId: item.vendor_serial_id || item.serial_id,
      eventType: 'reentered_qc_process',
      description: 'Ticket re-entered production workflow at QC1',
      metadata: { ticket_id: item.ticket_id, dc_number: dcNumber },
      actorUserId,
      actorName,
      db: client,
    });
  }

  return { dc_number: dcNumber, status: 'returned', tickets_updated: itemsRes.rows.length };
}

function effectiveQcStatusSql(alias = 'vsn') {
  return `COALESCE(
    NULLIF(TRIM(${alias}.qc_status), ''),
    NULLIF(TRIM(${alias}.extra->>'status'), ''),
    'pending'
  )`;
}

/** ERP / migrated laptops marked out_for_repare (not on an active vendor-repair DC). */
function erpOutForRepareSql(alias = 'vsn') {
  const eff = effectiveQcStatusSql(alias);
  return `${alias}.deleted_at IS NULL
    AND ${alias}.po_id IS NOT NULL
    AND (
      ${eff} = 'out_for_repare'
      OR ${alias}.inventory_status IN ('out_for_repare', 'in_repair')
      OR COALESCE(NULLIF(TRIM(${alias}.extra->>'action_status'), ''), '') = 'out_for_repare'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM vendor_repair_dc_items vri
        JOIN vendor_repair_delivery_challans vrd ON vrd.dc_number = vri.dc_number
        JOIN tickets vt ON vt.ticket_id = vri.ticket_id
       WHERE vrd.status = 'dispatched'
         AND vt.status = 'out_for_repair'
         AND (
           vri.serial_id = ${alias}.serial_id
           OR vri.serial_number = ${alias}.serial_number
           OR vri.ttspl_id = ${alias}.inventory_asset_code
         )
    )`;
}

function mapErpOutForRepareRow(row) {
  const extra = typeof row.vsn_extra === 'object' && row.vsn_extra ? row.vsn_extra : {};
  const brand = extra.brand || row.pd_brand || null;
  const model = extra.model || extra.model_name || row.pd_model || null;
  return {
    id: `erp:${row.serial_id}`,
    source: 'erp',
    serial_id: row.serial_id,
    ticket_id: row.open_ticket_id || null,
    ttspl_id: row.ttspl_id || row.inventory_asset_code || null,
    serial_number: row.serial_number,
    brand,
    model,
    configuration: configString({
      brand,
      model,
      processor: extra.processor || row.pd_processor,
      generation: extra.generation || row.pd_generation,
      ram: extra.ram || row.pd_ram,
      storage: extra.storage || row.pd_storage,
    }),
    vendor_name: extra.vendor_name || row.vendor_name || 'External vendor',
    vendor_address: extra.vendor_address || row.vendor_address || null,
    dc_number: null,
    dc_label: 'ERP / Legacy',
    out_date: extra.repair_start_date || row.updated_at,
    expected_return_date: null,
    current_status: 'Out For Repare',
    remarks: row.remark || extra.action_remark || null,
    sort_ts: row.updated_at,
  };
}

function mapVendorDcRow(r) {
  const extra = typeof r.vsn_extra === 'object' && r.vsn_extra ? r.vsn_extra : {};
  return {
    id: `vdc:${r.id}`,
    source: 'vendor_dc',
    serial_id: r.serial_id || null,
    ticket_id: r.ticket_id,
    ttspl_id: r.ttspl_id,
    serial_number: r.serial_number,
    brand: extra.brand || r.ticket_brand || null,
    model: extra.model || r.ticket_model || null,
    configuration: r.configuration || configString({
      brand: extra.brand || r.ticket_brand,
      model: extra.model || r.ticket_model,
      processor: extra.processor,
      generation: extra.generation,
      ram: extra.ram,
      storage: extra.storage,
    }),
    vendor_name: r.vendor_name,
    vendor_address: r.vendor_address,
    dc_number: r.dc_number,
    dc_label: r.dc_number,
    out_date: r.out_date,
    expected_return_date: r.expected_return_date,
    current_status: 'Out for Repair',
    remarks: r.remarks,
    sort_ts: r.dispatched_at,
  };
}

async function listOutForRepairInventory({
  search,
  vendor,
  dcNumber,
  page = 1,
  limit = 25,
} = {}) {
  await ensureVendorRepairSchema();

  const vendorParams = [];
  let vendorWhere = `WHERE d.status = 'dispatched' AND t.status = 'out_for_repair'`;
  if (search?.trim()) {
    vendorParams.push(`%${search.trim()}%`);
    const i = vendorParams.length;
    vendorWhere += ` AND (
      COALESCE(i.ttspl_id, '') ILIKE $${i}
      OR COALESCE(i.serial_number, '') ILIKE $${i}
      OR COALESCE(d.vendor_name, '') ILIKE $${i}
      OR COALESCE(d.dc_number, '') ILIKE $${i}
      OR COALESCE(i.configuration, '') ILIKE $${i}
      OR COALESCE(t.brand, '') ILIKE $${i}
      OR COALESCE(t.model, '') ILIKE $${i}
    )`;
  }
  if (vendor?.trim()) {
    vendorParams.push(`%${vendor.trim()}%`);
    vendorWhere += ` AND d.vendor_name ILIKE $${vendorParams.length}`;
  }
  if (dcNumber?.trim()) {
    vendorParams.push(`%${dcNumber.trim()}%`);
    vendorWhere += ` AND d.dc_number ILIKE $${vendorParams.length}`;
  }

  const erpParams = [];
  let erpSearchSql = '';
  if (search?.trim()) {
    erpParams.push(`%${search.trim()}%`);
    const i = erpParams.length;
    erpSearchSql = ` AND (
      COALESCE(vsn.inventory_asset_code, '') ILIKE $${i}
      OR vsn.serial_number ILIKE $${i}
      OR COALESCE(vsn.extra->>'vendor_name', '') ILIKE $${i}
      OR COALESCE(v.business_name, '') ILIKE $${i}
      OR COALESCE(vsn.extra->>'brand', vpd.brand, '') ILIKE $${i}
      OR COALESCE(vsn.extra->>'model', vpd.model, '') ILIKE $${i}
    )`;
  }
  if (vendor?.trim()) {
    erpParams.push(`%${vendor.trim()}%`);
    erpSearchSql += ` AND (
      COALESCE(vsn.extra->>'vendor_name', '') ILIKE $${erpParams.length}
      OR COALESCE(v.business_name, '') ILIKE $${erpParams.length}
    )`;
  }
  if (dcNumber?.trim()) {
    erpSearchSql += ' AND FALSE';
  }

  const vendorFrom = `
    FROM vendor_repair_dc_items i
    JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number
    JOIN tickets t ON t.ticket_id = i.ticket_id
    LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = COALESCE(i.serial_id, t.vendor_serial_id)
    ${vendorWhere}
  `;

  const erpFrom = `
    FROM vendor_serial_numbers vsn
    INNER JOIN vendor_purchase_orders p ON p.po_id = vsn.po_id AND p.deleted_at IS NULL
    LEFT JOIN vendor_product_details vpd
      ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
    LEFT JOIN vendors v ON v.vendor_id = COALESCE(
      NULLIF(vsn.extra->>'repair_vendor_id', '')::int,
      NULLIF(vsn.extra->>'seller_id', '')::int,
      p.vendor_id
    ) AND v.deleted_at IS NULL
    WHERE ${erpOutForRepareSql('vsn')}
    ${erpSearchSql}
  `;

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 25));
  const offset = (safePage - 1) * safeLimit;

  const [vendorCountR, erpCountR] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total ${vendorFrom}`, vendorParams),
    pool.query(`SELECT COUNT(*)::int AS total ${erpFrom}`, erpParams),
  ]);
  const total = (vendorCountR.rows[0]?.total || 0) + (erpCountR.rows[0]?.total || 0);

  const fetchEach = safePage === 1 ? safeLimit : safePage * safeLimit;
  const [vendorRowsR, erpRowsR] = await Promise.all([
    pool.query(
      `SELECT i.id, i.ticket_id, i.ttspl_id, i.serial_number, i.serial_id, i.configuration,
              t.status AS ticket_status,
              t.brand AS ticket_brand, t.model AS ticket_model,
              d.dc_number, d.vendor_name, d.vendor_address,
              d.out_date, d.expected_return_date, d.remarks, d.dispatched_at,
              vsn.extra AS vsn_extra
       ${vendorFrom}
       ORDER BY d.dispatched_at DESC NULLS LAST, i.id DESC
       LIMIT ${fetchEach}`,
      vendorParams
    ),
    pool.query(
      `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.remark, vsn.updated_at,
              vsn.extra AS vsn_extra,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'unique_product_serial') AS ttspl_id,
              vpd.brand AS pd_brand, vpd.model AS pd_model,
              vpd.processor AS pd_processor, vpd.generation AS pd_generation,
              vpd.ram AS pd_ram, vpd.storage AS pd_storage,
              COALESCE(vsn.extra->>'vendor_name', v.business_name, v.first_name) AS vendor_name,
              v.address AS vendor_address,
              (SELECT t.ticket_id FROM tickets t
                WHERE t.vendor_serial_id = vsn.serial_id
                  AND t.status IN ('in_progress', 'on_hold')
                ORDER BY t.created_at DESC LIMIT 1) AS open_ticket_id
       ${erpFrom}
       ORDER BY vsn.updated_at DESC NULLS LAST, vsn.serial_id DESC
       LIMIT ${fetchEach}`,
      erpParams
    ),
  ]);

  const merged = [
    ...vendorRowsR.rows.map(mapVendorDcRow),
    ...erpRowsR.rows.map(mapErpOutForRepareRow),
  ].sort((a, b) => {
    const ta = a.sort_ts ? new Date(a.sort_ts).getTime() : 0;
    const tb = b.sort_ts ? new Date(b.sort_ts).getTime() : 0;
    return tb - ta;
  });

  const data = merged.slice(offset, offset + safeLimit).map(({ sort_ts, ...row }) => row);

  return {
    data,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

async function countOutForRepairInventory() {
  await ensureVendorRepairSchema();
  const [vendorR, erpR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS c
         FROM vendor_repair_dc_items i
         JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number
         JOIN tickets t ON t.ticket_id = i.ticket_id
        WHERE d.status = 'dispatched' AND t.status = 'out_for_repair'`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c
         FROM vendor_serial_numbers vsn
        WHERE ${erpOutForRepareSql('vsn')}`
    ),
  ]);
  return (vendorR.rows[0]?.c || 0) + (erpR.rows[0]?.c || 0);
}

/** Receive an ERP / legacy out_for_repare laptop back to QC Process. */
async function receiveErpRepairBack(client, { serialId, actorUserId, actorName, createFloorTicket = true }) {
  const sid = Number(serialId);
  if (!sid) throw new Error('Invalid serial id');

  const cur = await client.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.qc_status, vsn.extra
       FROM vendor_serial_numbers vsn
      WHERE vsn.serial_id = $1 AND ${erpOutForRepareSql('vsn')}
      FOR UPDATE OF vsn`,
    [sid]
  );
  if (!cur.rows.length) {
    throw new Error('Serial is not in Out For Repare status or is already on a vendor repair DC');
  }
  const row = cur.rows[0];
  const extra = typeof row.extra === 'object' && row.extra ? { ...row.extra } : {};

  extra.status = 'pending';
  extra.action_status = 'repared';
  extra.status2 = 'repared';
  extra.came_from = extra.came_from || 'External vendor';
  extra.repair_received_at = new Date().toISOString();

  await client.query(
    `UPDATE vendor_serial_numbers
        SET qc_status = 'pending',
            inventory_status = 'in_stock',
            extra = $1::jsonb,
            updated_at = NOW()
      WHERE serial_id = $2`,
    [JSON.stringify(extra), sid]
  );

  const ttsplId = row.inventory_asset_code || row.serial_number;
  await logTtsplEvent({
    ttsplId,
    vendorSerialId: sid,
    eventType: 'repair_received',
    description: 'Received back from external repair — moved to QC Process',
    metadata: { previous_qc_status: row.qc_status },
    actorUserId,
    actorName,
    db: client,
  });

  let ticketId = null;
  if (createFloorTicket) {
    const { createProductionTicketForQcSerial } = require('./qcProcessIntakeService');
    const ticketResult = await createProductionTicketForQcSerial(
      client,
      { serialId: sid, serialNumber: row.serial_number },
      actorUserId
    );
    if (ticketResult.ok) ticketId = ticketResult.data?.ticket_id || null;
  }

  return {
    serial_id: sid,
    serial_number: row.serial_number,
    qc_status: 'pending',
    ticket_id: ticketId,
  };
}

module.exports = {
  ensureVendorRepairSchema,
  WAREHOUSE_ROLES,
  markDiagnosisFailed,
  listDiagnosisFailedTickets,
  createOutForRepairDc,
  getVendorRepairDc,
  signDispatchDc,
  receiveFromVendor,
  listOutForRepairInventory,
  countOutForRepairInventory,
  receiveErpRepairBack,
};
