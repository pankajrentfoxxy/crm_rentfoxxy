const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { closeOpenWorkLogs } = require('./ticketWorkLogService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { logProductionHistory } = require('./ticketWorkflowHistoryService');
const { generateVendorRepairPdf } = require('./vendorRepairPdfService');
const { appendDateRangeClauses } = require('../utils/dateRangeFilter');
const {
  pickSpecFilters,
  hasSpecFilters,
  buildTicketSpecFilter,
  appendRepairSpecClauses,
  vendorRepairSpecExpr,
  erpRepairSpecExpr,
} = require('../utils/inventorySpecFilter');
const {
  serialIdentityKey,
  findBlockingTicket,
  findActiveVrdcItemForSerial,
} = require('../utils/floorTicketSerialGuard');
const { transitionAsset, STATUS } = require('./inventoryStateMachine');
const {
  HSN_DEFAULTS,
  resolveDefaultHsn: defaultHsnForTxn,
  resolveHsnForPersist,
  resolveHsnForDisplay,
  canOverrideHsn,
  normalizeHsnCode,
} = require('../constants/hsnDefaults');
const {
  EWAY_VALUE_THRESHOLD,
  parseItemPrice,
  normalizeEwayBillNumber,
  validateEwayForConsignment,
  saveEsign,
  saveDispatchPod,
  normalizeShipBy,
  shipByToDispatchMode,
  validateDispatchDetails,
  dispatchPayloadFromBody,
  nextVendorRepairDcNumber,
  buildVrdcConfigurationString,
  resolveVrdcItemSpecs,
  enrichVrdcItemRow,
} = require('./vendorRepairDcShared');
const {
  normalizeCondition,
  requiresConfigVerification,
  conditionHighlight,
} = require('../constants/laptopConditions');

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);
const HW_SW_STAGES = new Set([
  'Diagnosis', 'Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint',
]);
/** @deprecated Use defaultHsnForTxn('repair') — kept for controller compat */
const DEFAULT_HSN = HSN_DEFAULTS.repair;

let schemaEnsured = false;
let schemaEnsurePromise = null;

async function ensureVendorRepairSchema() {
  if (schemaEnsured) return;
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = (async () => {
      for (const file of [
        '121_diagnosis_failed_vendor_repair.sql',
        '124_vendor_repair_enhancements.sql',
        '125_vendor_repair_dispatch.sql',
        '129_vendor_repair_dispatch_pod.sql',
        '130_vendor_repair_replacement.sql',
        '131_vendor_repair_signatures.sql',
        '148_vrdc_price_hsn_eway.sql',
        '215_vrdc_eway_accounts.sql',
        '222_vrdc_gate_flow.sql',
        '223_vrdc_receive_condition.sql',
        '224_vrdc_return_captured_serial.sql',
      ]) {
        const migrationPath = path.join(__dirname, '../migrations', file);
        if (fs.existsSync(migrationPath)) {
          await pool.query(fs.readFileSync(migrationPath, 'utf8'));
        }
      }
      schemaEnsured = true;
    })().finally(() => {
      schemaEnsurePromise = null;
    });
  }
  await schemaEnsurePromise;
}

function configString(ticket) {
  return buildVrdcConfigurationString(ticket);
}

async function resolveDefaultHsn(_client) {
  return defaultHsnForTxn('repair');
}

function normalizeHsn(raw, fallback) {
  const n = normalizeHsnCode(raw);
  return n || fallback || HSN_DEFAULTS.repair;
}

/** Transition inventory via state machine; also updates qc_status / extra when provided. */
async function transitionRepairSerial(client, {
  serialId,
  toStatus,
  reason,
  dcNumber,
  actorUserId,
  actorName,
  qcStatus = null,
  extraPatch = null,
}) {
  if (!serialId) return null;
  const result = await transitionAsset(client, {
    serialId,
    toStatus,
    reason,
    dcNumber: dcNumber || null,
    actorUserId: actorUserId || null,
    actorName: actorName || null,
  });
  if (qcStatus != null || extraPatch) {
    await client.query(
      `UPDATE vendor_serial_numbers SET
          qc_status = COALESCE($2, qc_status),
          extra = CASE
            WHEN $3::jsonb IS NULL THEN extra
            ELSE COALESCE(extra, '{}'::jsonb) || $3::jsonb
          END,
          updated_at = NOW()
        WHERE serial_id = $1`,
      [serialId, qcStatus, extraPatch ? JSON.stringify(extraPatch) : null]
    );
  }
  return result;
}

async function logTicketActivity(client, { ticketId, userId, action, notes, stageId }) {
  await client.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    [ticketId, stageId || null, userId || null, action, notes || null]
  );
}

async function safeLogTtsplEvent(args) {
  try {
    await logTtsplEvent(args);
  } catch (err) {
    console.warn('[vendorRepairDc] ttspl audit skipped:', err.message);
  }
}

function snapshotFromSpecs(specs = {}) {
  return {
    brand: specs.brand || null,
    model: specs.model || null,
    processor: specs.processor || null,
    generation: specs.generation || null,
    ram: specs.ram || null,
    ssd: specs.storage || specs.ssd || null,
    gpu: specs.gpu || null,
  };
}

async function nextReceiveDcNumber(client, dispatchDcNumber) {
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(receive_dc_number, '-R([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM vendor_repair_receive_challans
      WHERE dc_number = $1`,
    [dispatchDcNumber]
  );
  const seq = String(r.rows[0]?.n || 1).padStart(2, '0');
  return `${dispatchDcNumber}-R${seq}`;
}

async function nextReplacementDcNumber(client, dispatchDcNumber) {
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(replacement_dc_number, '-REP([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM vendor_repair_dc_items
      WHERE dc_number = $1 AND replacement_dc_number IS NOT NULL`,
    [dispatchDcNumber]
  );
  const seq = String(r.rows[0]?.n || 1).padStart(2, '0');
  return `${dispatchDcNumber}-REP${seq}`;
}

function normalizeReceiveItems(bodyItems, ticketIds) {
  const map = new Map();
  if (Array.isArray(bodyItems)) {
    for (const row of bodyItems) {
      const tid = Number(row.ticket_id ?? row.ticketId);
      if (!tid) continue;
      map.set(tid, {
        receive_mode: row.receive_mode === 'replacement' ? 'replacement' : 'repaired',
        verified_serial: row.verified_serial || row.verifiedSerial || '',
        wh_esign: row.wh_esign || row.warehouse_esign || null,
        wh_signer_name: row.wh_signer_name || row.whSignerName || '',
        vendor_esign: row.vendor_esign || null,
        vendor_signer_name: row.vendor_signer_name || row.vendorSignerName || '',
        replacement_serial_number: row.replacement_serial_number || row.replacementSerialNumber || '',
        replacement_brand: row.replacement_brand || row.replacementBrand || '',
        replacement_model: row.replacement_model || row.replacementModel || '',
        replacement_generation: row.replacement_generation || row.replacementGeneration || '',
        laptop_condition: normalizeCondition(row.laptop_condition || row.laptopCondition || row.received_condition),
        bypass_gate_flow: row.bypass_gate_flow === true || row.bypassGateFlow === true,
      });
    }
  }
  if (Array.isArray(ticketIds)) {
    for (const tid of ticketIds.map(Number).filter(Boolean)) {
      if (!map.has(tid)) map.set(tid, { receive_mode: 'repaired' });
    }
  }
  return map;
}

function serialMatchesExpected(verified, item) {
  const v = String(verified || '').trim().toUpperCase();
  if (!v) return false;
  const candidates = [
    item.serial_number,
    item.ttspl_id,
    item.ticket_serial_number,
  ].map((s) => String(s || '').trim().toUpperCase()).filter(Boolean);
  return candidates.includes(v);
}

function parseItemConfiguration(item) {
  const parts = String(item.configuration || '').split('·').map((s) => s.trim()).filter(Boolean);
  return {
    brand: parts[0] || '',
    model: parts[1] || '',
    processor: parts[2] || '',
    generation: parts[3] || '',
    ram: parts[4] || '',
    storage: parts[5] || '',
  };
}

async function resolveReplacementPoGrn(client, { originalSerialId, vendorId, replacementDcNumber }) {
  if (originalSerialId) {
    const orig = await client.query(
      `SELECT po_id, grn_id FROM vendor_serial_numbers
        WHERE serial_id = $1 AND deleted_at IS NULL`,
      [originalSerialId]
    );
    const row = orig.rows[0];
    if (row?.po_id && row?.grn_id) {
      return { poId: row.po_id, grnId: row.grn_id };
    }
    if (row?.grn_id) {
      const grn = await client.query(
        `SELECT po_id FROM vendor_goods_received_notes WHERE grn_id = $1`,
        [row.grn_id]
      );
      if (grn.rows[0]?.po_id) {
        return { poId: grn.rows[0].po_id, grnId: row.grn_id };
      }
    }
  }

  if (!vendorId) {
    throw new Error('Vendor is required to register a replacement laptop');
  }

  const poNumber = `VR-REP-${String(replacementDcNumber || Date.now()).replace(/\//g, '-')}`;
  const today = new Date().toISOString().slice(0, 10);
  const poIns = await client.query(
    `INSERT INTO vendor_purchase_orders (
       purchase_order_number, purchase_order_date, purchase_order_type, vendor_id,
       po_state, is_same_state, sub_total_amount, total_amount,
       line_items, assets_details, remarks, status, invoice_created
     ) VALUES ($1, $2::date, 'vendor_repair_replacement', $3, 'Warehouse', TRUE, 0, 0,
       '[]'::jsonb, '{}'::jsonb, $4, 'approved', FALSE)
     RETURNING po_id`,
    [
      poNumber,
      today,
      vendorId,
      `Vendor repair replacement intake — ${replacementDcNumber || ''}`,
    ]
  );
  const poId = poIns.rows[0].po_id;
  const grnIns = await client.query(
    `INSERT INTO vendor_goods_received_notes (po_id, meta, bill_status)
     VALUES ($1, $2::jsonb, 'pending')
     RETURNING grn_id`,
    [
      poId,
      JSON.stringify({
        intake_source: 'vendor_repair_replacement',
        replacement_dc_number: replacementDcNumber || null,
      }),
    ]
  );
  return { poId, grnId: grnIns.rows[0].grn_id };
}

async function upsertReplacementSerial(client, {
  serialNumber,
  brand,
  model,
  generation,
  vendorId,
  originalTtsplId,
  originalSerial,
  originalSerialId,
  replacementDcNumber,
}) {
  const sn = String(serialNumber || '').trim();
  if (!sn) throw new Error('Replacement serial number is required');

  const existing = await client.query(
    `SELECT serial_id, inventory_asset_code, serial_number
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND UPPER(TRIM(serial_number)) = UPPER($1)
      LIMIT 1`,
    [sn]
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE vendor_serial_numbers SET
          extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb,
          updated_at = NOW()
        WHERE serial_id = $1`,
      [
        existing.rows[0].serial_id,
        JSON.stringify({
          asset_tag: 'replacement',
          brand: brand || null,
          model: model || null,
          generation: generation || null,
          replaced_ttspl_id: originalTtsplId || null,
          replaced_serial: originalSerial || null,
          replacement_dc_number: replacementDcNumber || null,
        }),
      ]
    );
    return existing.rows[0];
  }

  const { allocateTtsplCodes } = require('./vendorInventoryAssetCodeService');
  const [ttspl] = await allocateTtsplCodes(client, 1);
  const configuration = [brand, model, generation].filter(Boolean).join(' · ');
  const { poId, grnId } = await resolveReplacementPoGrn(client, {
    originalSerialId,
    vendorId,
    replacementDcNumber,
  });
  const ins = await client.query(
    `INSERT INTO vendor_serial_numbers (
        po_id, grn_id, serial_number, inventory_asset_code, qc_status, inventory_status, extra, updated_at
     ) VALUES ($1, $2, $3, $4, 'pending', 'in_stock', $5::jsonb, NOW())
     RETURNING serial_id, inventory_asset_code, serial_number`,
    [
      poId,
      grnId,
      sn,
      ttspl,
      JSON.stringify({
        asset_tag: 'replacement',
        brand: brand || null,
        model: model || null,
        generation: generation || null,
        source: 'vendor_repair_replacement',
        vendor_id: vendorId || null,
        configuration,
        replaced_ttspl_id: originalTtsplId || null,
        replaced_serial: originalSerial || null,
        replacement_dc_number: replacementDcNumber || null,
      }),
    ]
  );
  return ins.rows[0];
}

const { formatCompanyBlock } = require('../utils/companyDefaults');

function defaultBillingAddress() {
  return formatCompanyBlock();
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

  const otherFailed = await findBlockingTicket(client, {
    serialNumber: ticket.serial_number,
    ttsplId: ticket.ttspl_id,
    vendorSerialId: ticket.vendor_serial_id,
    excludeTicketId: ticketId,
  });
  if (otherFailed?.status === 'diagnosis_failed') {
    throw new Error(
      `This laptop already has Diagnosis Failed ticket #${otherFailed.ticket_id}. `
      + 'Use that ticket for vendor repair — do not mark another ticket as diagnosis failed for the same unit.'
    );
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

  const afterRes = await client.query('SELECT * FROM tickets WHERE ticket_id = $1', [ticketId]);
  await logProductionHistory(client, {
    ticketBefore: ticket,
    ticketAfter: afterRes.rows[0] || ticket,
    beforeStageName: ticket.stage_name,
    source: 'markDiagnosisFailed',
    remarks: reason.trim(),
    failureReason: reason.trim(),
    actor: { user_id: actorUserId, name: actorName || 'System' },
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

async function listDiagnosisFailedTickets({
  dateFrom,
  dateTo,
  brand,
  model,
  processor,
  generation,
  ram,
  storage,
  screen_size,
  gpu,
} = {}) {
  const specFilters = pickSpecFilters({
    brand, model, processor, generation, ram, storage, screen_size, gpu,
  });
  const params = [];
  const specFilter = buildTicketSpecFilter(specFilters, params, 't');
  const ticketJoins = specFilter.joinSql || `
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id AND vsn.deleted_at IS NULL
       LEFT JOIN inventory inv ON LOWER(TRIM(inv.serial_number)) = LOWER(TRIM(t.serial_number))`;
  const dateClauses = appendDateRangeClauses({
    expr: 'COALESCE(t.diagnosis_failed_at, t.created_at)',
    dateFrom,
    dateTo,
    params,
  });
  const dateSql = dateClauses.length ? ` AND ${dateClauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.status, t.brand, t.model,
            t.processor, t.ram, t.storage, t.diagnosis_failed_at,
            t.diagnosis_failed_reason, t.current_location, t.created_at,
            t.previous_technician_id, t.previous_stage_id,
            vsn.extra AS serial_extra,
            COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), inv.generation, '') AS generation,
            COALESCE(NULLIF(TRIM(vsn.extra->>'brand'), ''), t.brand) AS brand,
            COALESCE(NULLIF(TRIM(vsn.extra->>'model'), ''), NULLIF(TRIM(vsn.extra->>'model_name'), ''), t.model) AS model,
            COALESCE(NULLIF(TRIM(vsn.extra->>'processor'), ''), t.processor) AS processor,
            COALESCE(NULLIF(TRIM(vsn.extra->>'ram'), ''), t.ram) AS ram,
            COALESCE(NULLIF(TRIM(vsn.extra->>'storage'), ''), t.storage) AS storage,
            ps.stage_name AS previous_stage_name,
            pu.name AS previous_technician_name
       FROM tickets t
       ${ticketJoins}
       LEFT JOIN stages ps ON ps.stage_id = t.previous_stage_id
       LEFT JOIN users pu ON pu.user_id = t.previous_technician_id
      WHERE t.status = 'diagnosis_failed'
        AND NOT EXISTS (
          SELECT 1 FROM vendor_repair_dc_items vi
          JOIN vendor_repair_delivery_challans vd ON vd.dc_number = vi.dc_number
          WHERE vi.ticket_id = t.ticket_id
            AND vd.status IN ('draft', 'dispatched', 'partially_returned')
        )${dateSql}${specFilter.whereSql}
      ORDER BY t.diagnosis_failed_at DESC NULLS LAST, t.ticket_id DESC`,
    params
  );
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = serialIdentityKey(row);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    deduped.push(row);
  }
  return deduped.map((r) => ({
    ...r,
    configuration: buildVrdcConfigurationString({ ...r, extra: r.serial_extra }),
  }));
}

async function createOutForRepairDc(client, {
  ticketIds,
  vendorId,
  vendorName,
  vendorAddress,
  vendorBillingAddress,
  billingAddress,
  shippingAddress,
  contactPerson,
  contactMobile,
  expectedReturnDate,
  remarks,
  warehouseName,
  warehouseAddress,
  itemRemarks = {},
  itemPrices = {},
  itemHsnCodes = {},
  itemVerifications = {},
  ewayBillNumber,
  ewayBillDate,
  ship_by,
  shipBy,
  dispatch_mode,
  courier_name,
  awb_number,
  courier_tracking_url,
  porter_tracking_id,
  porter_order_id,
  porter_booking_url,
  delivery_person_id,
  actorUserId,
  actorName,
  actorRole,
}) {
  if (!Array.isArray(ticketIds) || !ticketIds.length) {
    throw new Error('Select at least one laptop');
  }
  if (!vendorName?.trim()) throw new Error('Vendor name is required');
  const vendorBillAddr = (vendorBillingAddress || vendorAddress)?.trim();
  const shipAddr = shippingAddress?.trim();
  if (!vendorBillAddr) throw new Error('Vendor billing address is required');
  if (!shipAddr) throw new Error('Vendor shipping address is required');
  const billAddr = defaultBillingAddress();
  const dispatch = dispatchPayloadFromBody({
    ship_by: ship_by || shipBy,
    dispatch_mode,
    courier_name,
    awb_number,
    courier_tracking_url,
    porter_tracking_id,
    porter_order_id,
    porter_booking_url,
    delivery_person_id,
  });

  const tRes = await client.query(
    `SELECT t.*, s.stage_name,
            vsn.extra AS serial_extra,
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

  const { assertTtsplAndSerial, resolveItemVerifications } = require('../utils/machineIdentityVerify');
  const verifications = resolveItemVerifications(itemVerifications, ticketIds);
  for (const ticket of tRes.rows) {
    const v = verifications.get(Number(ticket.ticket_id)) || { ttspl: '', serial: '' };
    assertTtsplAndSerial({
      expectedTtspl: ticket.ttspl_id,
      expectedSerial: ticket.serial_number,
      verifiedTtspl: v.ttspl,
      verifiedSerial: v.serial,
      label: ticket.ttspl_id || `#${ticket.ticket_id}`,
    });
  }
  if (invalid.length) {
    throw new Error('All selected laptops must be in Diagnosis Failed status');
  }

  const seenSerials = new Map();
  for (const ticket of tRes.rows) {
    const key = serialIdentityKey(ticket);
    if (key) {
      if (seenSerials.has(key)) {
        throw new Error(
          `Duplicate laptop in selection (${ticket.serial_number || ticket.ttspl_id}) — `
          + `tickets #${seenSerials.get(key)} and #${ticket.ticket_id}`
        );
      }
      seenSerials.set(key, ticket.ticket_id);
    }
    const onDc = await findActiveVrdcItemForSerial(client, {
      serialId: ticket.vendor_serial_id,
      serialNumber: ticket.serial_number,
      ttsplId: ticket.ttspl_id,
      excludeTicketId: ticket.ticket_id,
    });
    if (onDc) {
      throw new Error(
        `Laptop ${ticket.ttspl_id || ticket.serial_number} is already on vendor repair DC ${onDc.dc_number} `
        + `(ticket #${onDc.ticket_id})`
      );
    }
  }

  const defaultHsn = defaultHsnForTxn('repair');
  let totalDeclared = 0;
  const itemFieldMap = {};
  for (const ticket of tRes.rows) {
    const tid = ticket.ticket_id;
    const price = parseItemPrice(
      itemPrices[tid] ?? itemPrices[String(tid)] ?? null
    );
    const hsn = resolveHsnForPersist({
      transactionType: 'repair',
      override: itemHsnCodes[tid] ?? itemHsnCodes[String(tid)] ?? null,
      role: actorRole,
    });
    if (price != null) totalDeclared += price;
    itemFieldMap[tid] = { price, hsn };
  }
  const eway = validateEwayForConsignment({
    totalValue: totalDeclared,
    ewayBillNumber,
    ewayBillDate,
    requireEway: false,
  });

  const dcNumber = await nextVendorRepairDcNumber(client);
  await client.query(
    `INSERT INTO vendor_repair_delivery_challans (
        dc_number, vendor_id, vendor_name, vendor_address, billing_address, shipping_address,
        contact_person, contact_mobile,
        expected_return_date, remarks, warehouse_name, warehouse_address, status, created_by,
        items_dispatched_count, items_received_count,
        ship_by, dispatch_mode, courier_name, awb_number, courier_tracking_url,
        porter_tracking_id, porter_order_id, porter_booking_url, delivery_person_id,
        eway_bill_number, eway_bill_date, item_domain
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,0,0,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'laptop')`,
    [
      dcNumber,
      vendorId || null,
      vendorName.trim(),
      vendorBillAddr,
      billAddr,
      shipAddr,
      contactPerson?.trim() || null,
      contactMobile?.trim() || null,
      expectedReturnDate || null,
      remarks?.trim() || null,
      warehouseName?.trim() || 'TRUETECH SERVICES PRIVATE LIMITED',
      warehouseAddress?.trim() || billAddr,
      actorUserId,
      dispatch.ship_by,
      dispatch.dispatch_mode,
      dispatch.courier_name,
      dispatch.awb_number,
      dispatch.courier_tracking_url,
      dispatch.porter_tracking_id,
      dispatch.porter_order_id,
      dispatch.porter_booking_url,
      dispatch.delivery_person_id,
      eway.eway_bill_number,
      eway.eway_bill_date,
    ]
  );

  for (const ticket of tRes.rows) {
    const configuration = buildVrdcConfigurationString({ ...ticket, extra: ticket.serial_extra });
    const itemRemark = itemRemarks[ticket.ticket_id]
      || itemRemarks[String(ticket.ticket_id)]
      || ticket.diagnosis_failed_reason
      || null;
    const fields = itemFieldMap[ticket.ticket_id] || { price: null, hsn: defaultHsn };
    const specs = resolveVrdcItemSpecs({ ...ticket, extra: ticket.serial_extra });
    const extra = ticket.serial_extra && typeof ticket.serial_extra === 'object' ? ticket.serial_extra : {};
    const dispatchSnapshot = snapshotFromSpecs({ ...specs, gpu: extra.gpu || ticket.gpu });
    await client.query(
      `INSERT INTO vendor_repair_dc_items (
          dc_number, ticket_id, serial_id, ttspl_id, serial_number, configuration, item_remarks, item_status,
          price, hsn_code, dispatch_config_snapshot
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10::jsonb)`,
      [
        dcNumber, ticket.ticket_id, ticket.vendor_serial_id, ticket.ttspl_id, ticket.serial_number,
        configuration, itemRemark, fields.price, fields.hsn, JSON.stringify(dispatchSnapshot),
      ]
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
    await logTicketActivity(client, {
      ticketId: ticket.ticket_id,
      userId: actorUserId,
      action: 'vrdc_created',
      notes: `Out for Repair VRDC ${dcNumber} created${eway.eway_required ? ' — E-way Bill required before PDF download' : ''}`,
      stageId: ticket.current_stage_id,
    });
  }

  return { dc_number: dcNumber, total_declared: totalDeclared, eway_required: eway.eway_required };
}

function vendorDisplayName(vendor) {
  if (!vendor) return '';
  return vendor.business_name
    || [vendor.first_name, vendor.last_name].filter(Boolean).join(' ').trim()
    || vendor.f_name
    || '';
}

function formatVendorBillingFromRow(vendor) {
  if (!vendor) return '';
  const lines = [vendorDisplayName(vendor)].filter(Boolean);
  const street = [vendor.address, vendor.city, vendor.state, vendor.pincode].filter(Boolean).join(', ');
  if (street) lines.push(street);
  return lines.join('\n');
}

function formatVendorShippingFromRow(vendor) {
  if (!vendor) return '';
  if (vendor.shipping_same !== false) return formatVendorBillingFromRow(vendor);
  const lines = [vendorDisplayName(vendor)].filter(Boolean);
  const street = [vendor.shipping_address, vendor.shipping_city, vendor.shipping_state, vendor.shipping_pincode]
    .filter(Boolean).join(', ');
  if (street) lines.push(street);
  return lines.join('\n');
}

/** Remove duplicate laptops from a draft VRDC (keeps newest ticket per serial). */
async function dedupeDraftVrdcItems(dcNumber) {
  const client = await pool.connect();
  let removed = 0;
  let cancelledTicketIds = [];
  let shouldRegeneratePdf = false;
  try {
    await client.query('BEGIN');
    // Never hold a row lock while generating PDFs — that deadlocks other readers/writers.
    await client.query('SET LOCAL lock_timeout = 5000');
    const headRes = await client.query(
      `SELECT status FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
      [dcNumber]
    );
    if (!headRes.rows.length || headRes.rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      return { removed: 0 };
    }

    const itemsRes = await client.query(
      `SELECT i.*, t.status AS ticket_status
         FROM vendor_repair_dc_items i
         JOIN tickets t ON t.ticket_id = i.ticket_id
        WHERE i.dc_number = $1
        ORDER BY i.ticket_id ASC, i.id ASC`,
      [dcNumber]
    );

    const keepByKey = new Map();
    const toRemove = [];
    for (const item of itemsRes.rows) {
      const key = serialIdentityKey(item);
      if (!key) continue;
      const existing = keepByKey.get(key);
      if (!existing) {
        keepByKey.set(key, item);
        continue;
      }
      if (item.ticket_id > existing.ticket_id) {
        toRemove.push(existing);
        keepByKey.set(key, item);
      } else {
        toRemove.push(item);
      }
    }

    for (const dup of toRemove) {
      await client.query(`DELETE FROM vendor_repair_dc_items WHERE id = $1`, [dup.id]);
      await client.query(
        `UPDATE tickets
            SET vendor_repair_dc_number = NULL,
                status = CASE WHEN status = 'diagnosis_failed' THEN 'cancelled' ELSE status END,
                updated_at = NOW()
          WHERE ticket_id = $1 AND vendor_repair_dc_number = $2`,
        [dup.ticket_id, dcNumber]
      );
      await logTicketActivity(client, {
        ticketId: dup.ticket_id,
        userId: null,
        action: 'cancelled',
        notes: `Removed duplicate from draft VRDC ${dcNumber} — superseded by newer ticket for same laptop`,
      });
    }

    if (toRemove.length) {
      await client.query(
        `UPDATE vendor_repair_delivery_challans SET updated_at = NOW() WHERE dc_number = $1`,
        [dcNumber]
      );
      removed = toRemove.length;
      cancelledTicketIds = toRemove.map((r) => r.ticket_id);
      shouldRegeneratePdf = true;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (shouldRegeneratePdf) {
    try {
      const pdfPath = await generateVendorRepairPdf(dcNumber);
      if (pdfPath) {
        await pool.query(
          `UPDATE vendor_repair_delivery_challans SET pdf_path = $2, updated_at = NOW() WHERE dc_number = $1`,
          [dcNumber, pdfPath]
        );
      }
    } catch (_) { /* best-effort */ }
  }

  return { removed, cancelled_ticket_ids: cancelledTicketIds };
}

async function getVendorRepairDc(dcNumber) {
  const headRes = await pool.query(
    `SELECT d.*,
            v.business_name AS vendor_business_name,
            v.first_name AS vendor_first_name,
            v.last_name AS vendor_last_name,
            v.address AS vendor_reg_address,
            v.city AS vendor_reg_city,
            v.state AS vendor_reg_state,
            v.pincode AS vendor_reg_pincode,
            v.shipping_same AS vendor_shipping_same,
            v.shipping_address AS vendor_ship_address,
            v.shipping_city AS vendor_ship_city,
            v.shipping_state AS vendor_ship_state,
            v.shipping_pincode AS vendor_ship_pincode,
            dt.first_name AS delivery_person_first_name,
            dt.last_name AS delivery_person_last_name,
            dt.phone AS delivery_person_phone
       FROM vendor_repair_delivery_challans d
       LEFT JOIN vendors v ON v.vendor_id = d.vendor_id AND v.deleted_at IS NULL
       LEFT JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
      WHERE d.dc_number = $1`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) return null;
  const refreshedHead = head;
  const itemsRes = await pool.query(
    `SELECT i.*, t.status AS ticket_status, t.diagnosis_failed_reason,
            t.brand AS ticket_brand, t.model AS ticket_model, t.processor AS ticket_processor,
            t.ram AS ticket_ram, t.storage AS ticket_storage,
            vsn.extra AS serial_extra
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = i.serial_id
      WHERE i.dc_number = $1
      ORDER BY i.id ASC`,
    [dcNumber]
  );
  const vendorMaster = refreshedHead.vendor_id ? {
    business_name: refreshedHead.vendor_business_name,
    first_name: refreshedHead.vendor_first_name,
    last_name: refreshedHead.vendor_last_name,
    address: refreshedHead.vendor_reg_address,
    city: refreshedHead.vendor_reg_city,
    state: refreshedHead.vendor_reg_state,
    pincode: refreshedHead.vendor_reg_pincode,
    shipping_same: refreshedHead.vendor_shipping_same,
    shipping_address: refreshedHead.vendor_ship_address,
    shipping_city: refreshedHead.vendor_ship_city,
    shipping_state: refreshedHead.vendor_ship_state,
    shipping_pincode: refreshedHead.vendor_ship_pincode,
  } : null;
  const vendor_billing_display = formatVendorBillingFromRow(vendorMaster) || refreshedHead.vendor_address || refreshedHead.vendor_name;
  const vendor_shipping_display = formatVendorShippingFromRow(vendorMaster) || refreshedHead.shipping_address || refreshedHead.vendor_address;
  const delivery_person_name = [refreshedHead.delivery_person_first_name, refreshedHead.delivery_person_last_name]
    .filter(Boolean).join(' ').trim() || null;
  let receiveChallans = [];
  try {
    const recvRes = await pool.query(
      `SELECT * FROM vendor_repair_receive_challans WHERE dc_number = $1 ORDER BY created_at ASC`,
      [dcNumber]
    );
    receiveChallans = recvRes.rows;
  } catch (_) { /* table may not exist until migration 222 */ }
  let captureByItem = new Map();
  try {
    const { listLatestTokensForDc } = require('./vendorReturnCaptureService');
    const tokens = await listLatestTokensForDc(pool, dcNumber);
    captureByItem = new Map(tokens.map((t) => [t.item_id, t]));
  } catch (_) { /* capture table may not exist yet */ }
  return {
    ...refreshedHead,
    company_from_display: formatCompanyBlock(),
    vendor_billing_display,
    vendor_shipping_display,
    delivery_person_name,
    vendor_delivery_status: refreshedHead.vendor_delivered_at ? 'delivered' : (refreshedHead.dispatched_at ? 'in_transit' : 'pending'),
    receive_challans: receiveChallans,
    items: itemsRes.rows.map((row) => {
      const enriched = enrichVrdcItemRow(row);
      const tok = captureByItem.get(row.id);
      return {
        ...enriched,
        return_capture: tok
          ? {
            token_id: tok.token_id,
            access_number: tok.access_number,
            status: tok.status,
            matched_at: tok.matched_at,
            match_result: tok.match_result,
            serial_number: tok.serial_number,
          }
          : null,
      };
    }),
  };
}

async function updateVendorRepairDispatchDetails(client, { dcNumber, body, actorUserId }) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (head.status !== 'draft') throw new Error('Dispatch details can only be edited while DC is in draft');

  const dispatch = dispatchPayloadFromBody(body);
  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        ship_by = $2,
        dispatch_mode = $3,
        courier_name = $4,
        awb_number = $5,
        courier_tracking_url = $6,
        porter_tracking_id = $7,
        porter_order_id = $8,
        porter_booking_url = $9,
        delivery_person_id = $10,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [
      dcNumber,
      dispatch.ship_by,
      dispatch.dispatch_mode,
      dispatch.courier_name,
      dispatch.awb_number,
      dispatch.courier_tracking_url,
      dispatch.porter_tracking_id,
      dispatch.porter_order_id,
      dispatch.porter_booking_url,
      dispatch.delivery_person_id,
    ]
  );
  return { dc_number: dcNumber, ...dispatch };
}

/** Update Price / HSN / E-way Bill (preview + PDF). Allowed until DC is fully returned.
 *  HSN overrides require Admin / Super Admin; others keep existing/default repair HSN. */
async function updateVendorRepairCommercialDetails(client, { dcNumber, body, actorRole }) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (head.status === 'returned') {
    throw new Error('Cannot edit commercial details after DC is fully returned');
  }

  const itemsRes = await client.query(
    `SELECT id, ticket_id, price, hsn_code FROM vendor_repair_dc_items WHERE dc_number = $1 ORDER BY id`,
    [dcNumber]
  );
  const itemPrices = body.item_prices || body.itemPrices || {};
  const itemHsnCodes = body.item_hsn_codes || body.itemHsnCodes || {};
  const defaultHsn = defaultHsnForTxn('repair');
  const allowHsnOverride = canOverrideHsn(actorRole);
  let totalDeclared = 0;

  for (const row of itemsRes.rows) {
    const tid = row.ticket_id;
    const hasPrice = Object.prototype.hasOwnProperty.call(itemPrices, tid)
      || Object.prototype.hasOwnProperty.call(itemPrices, String(tid));
    const hasHsnRaw = Object.prototype.hasOwnProperty.call(itemHsnCodes, tid)
      || Object.prototype.hasOwnProperty.call(itemHsnCodes, String(tid));
    const hasHsn = hasHsnRaw && allowHsnOverride;
    const price = hasPrice
      ? parseItemPrice(itemPrices[tid] ?? itemPrices[String(tid)])
      : (row.price != null ? Number(row.price) : null);
    const hsn = hasHsn
      ? resolveHsnForPersist({
        transactionType: 'repair',
        override: itemHsnCodes[tid] ?? itemHsnCodes[String(tid)],
        role: actorRole,
      })
      : null;
    if (price != null) totalDeclared += price;
    if (hasPrice || hasHsn) {
      await client.query(
        `UPDATE vendor_repair_dc_items SET
            price = CASE WHEN $3::boolean THEN $4::numeric ELSE price END,
            hsn_code = CASE WHEN $5::boolean THEN $6::text ELSE hsn_code END
          WHERE id = $1 AND dc_number = $2`,
        [row.id, dcNumber, hasPrice, price, hasHsn, hsn]
      );
    }
  }

  // Recompute total after updates
  const sumRes = await client.query(
    `SELECT COALESCE(SUM(price), 0)::float AS total FROM vendor_repair_dc_items WHERE dc_number = $1`,
    [dcNumber]
  );
  totalDeclared = Number(sumRes.rows[0]?.total || 0);

  // Ensure no blank HSN remains
  await client.query(
    `UPDATE vendor_repair_dc_items
        SET hsn_code = $2
      WHERE dc_number = $1
        AND (hsn_code IS NULL OR TRIM(hsn_code) = '')`,
    [dcNumber, defaultHsn]
  );

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        pdf_path = NULL,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber]
  );

  return {
    dc_number: dcNumber,
    total_declared: totalDeclared,
    hsn_override_applied: allowHsnOverride,
  };
}

async function markDeliveredToVendor(client, { dcNumber, actorUserId, actorName }) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (head.status === 'draft') throw new Error('DC must be dispatched before marking delivered to vendor');
  if (head.status === 'returned') throw new Error('DC already fully returned from vendor');
  if (head.vendor_delivered_at) return { already_delivered: true, dc_number: dcNumber };

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        vendor_delivered_at = NOW(),
        vendor_delivered_by = $2,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, actorUserId]
  );

  const itemsRes = await client.query(
    `SELECT i.ticket_id, i.ttspl_id, t.vendor_serial_id, t.ttspl_id AS ticket_ttspl
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
      WHERE i.dc_number = $1`,
    [dcNumber]
  );

  for (const item of itemsRes.rows) {
    await safeLogTtsplEvent({
      ttsplId: item.ttspl_id || item.ticket_ttspl,
      vendorSerialId: item.vendor_serial_id,
      eventType: 'delivered_to_vendor',
      description: `Delivered to vendor via ${dcNumber}`,
      metadata: { dc_number: dcNumber, vendor_name: head.vendor_name },
      actorUserId,
      actorName,
      db: client,
    });
    await logTicketActivity(client, {
      ticketId: item.ticket_id,
      userId: actorUserId,
      action: 'delivered_to_vendor',
      notes: `Confirmed delivered to ${head.vendor_name} (${dcNumber})`,
    });
  }

  return { dc_number: dcNumber, vendor_delivered_at: new Date().toISOString(), pdf_pending: true };
}

async function signDispatchDc(client, {
  dcNumber,
  warehouseEsign,
  vendorEsign,
  dispatchBody,
  dispatchPod,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (['dispatch_ready', 'dispatched'].includes(head.status)) {
    return { already_dispatched: true, status: head.status };
  }
  if (head.status === 'returned') throw new Error('DC already returned');
  if (head.status !== 'draft') throw new Error('DC must be in draft to dispatch');

  let dispatch = null;
  if (dispatchBody && (dispatchBody.ship_by || dispatchBody.shipBy || dispatchBody.dispatch_mode)) {
    dispatch = dispatchPayloadFromBody(dispatchBody);
  } else if (head.ship_by || head.dispatch_mode) {
    dispatch = {
      ship_by: head.ship_by,
      dispatch_mode: head.dispatch_mode,
      courier_name: head.courier_name,
      awb_number: head.awb_number,
      courier_tracking_url: head.courier_tracking_url,
      porter_tracking_id: head.porter_tracking_id,
      porter_order_id: head.porter_order_id,
      porter_booking_url: head.porter_booking_url,
      delivery_person_id: head.delivery_person_id,
    };
  } else {
    throw new Error('Send mode is required before dispatch (select By Hand, Courier, or Porter)');
  }

  const whUrl = warehouseEsign ? saveEsign('wh_dispatch', dcNumber, warehouseEsign) : head.warehouse_dispatch_esign_url;
  const vUrl = vendorEsign ? saveEsign('vendor_dispatch', dcNumber, vendorEsign) : head.vendor_dispatch_esign_url || null;
  if (!whUrl) throw new Error('Warehouse dispatch e-signature is required');

  const whSignerName = (dispatchBody?.warehouse_signer_name || dispatchBody?.warehouseSignerName || '').trim() || null;
  const vendorSignerName = (dispatchBody?.vendor_signer_name || dispatchBody?.vendorSignerName || '').trim() || null;

  const podPath = dispatchPod ? saveDispatchPod(dcNumber, dispatchPod) : head.dispatch_pod_path || null;

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        warehouse_dispatch_esign_url = $2,
        vendor_dispatch_esign_url = $3,
        warehouse_dispatch_signer_name = COALESCE($14, warehouse_dispatch_signer_name),
        vendor_dispatch_signer_name = COALESCE($15, vendor_dispatch_signer_name),
        ship_by = $4,
        dispatch_mode = $5,
        courier_name = $6,
        awb_number = $7,
        courier_tracking_url = $8,
        porter_tracking_id = $9,
        porter_order_id = $10,
        porter_booking_url = $11,
        delivery_person_id = $12,
        dispatch_pod_path = COALESCE($13, dispatch_pod_path),
        status = 'dispatch_ready',
        items_dispatched_count = (SELECT COUNT(*)::int FROM vendor_repair_dc_items WHERE dc_number = $1),
        updated_at = NOW()
      WHERE dc_number = $1`,
    [
      dcNumber,
      whUrl,
      vUrl,
      dispatch.ship_by,
      dispatch.dispatch_mode,
      dispatch.courier_name,
      dispatch.awb_number,
      dispatch.courier_tracking_url,
      dispatch.porter_tracking_id,
      dispatch.porter_order_id,
      dispatch.porter_booking_url,
      dispatch.delivery_person_id,
      podPath,
      whSignerName,
      vendorSignerName,
    ]
  );

  await client.query(
    `UPDATE vendor_repair_dc_items SET item_status = 'dispatch_ready' WHERE dc_number = $1`,
    [dcNumber]
  );

  const itemsRes = await client.query(
    `SELECT i.ticket_id, i.serial_id, i.ttspl_id, t.ttspl_id AS ticket_ttspl, t.vendor_serial_id
       FROM vendor_repair_dc_items i
       JOIN tickets t ON t.ticket_id = i.ticket_id
      WHERE i.dc_number = $1`,
    [dcNumber]
  );

  for (const item of itemsRes.rows) {
    const serialId = item.vendor_serial_id || item.serial_id;
    await safeLogTtsplEvent({
      ttsplId: item.ttspl_id || item.ticket_ttspl,
      vendorSerialId: serialId,
      eventType: 'esign_completed',
      description: `Dispatch e-sign completed for ${dcNumber} — waiting for guard outward`,
      metadata: { dc_number: dcNumber },
      actorUserId,
      actorName,
      db: client,
    });
  }

  return { dc_number: dcNumber, status: 'dispatch_ready', pdf_pending: true };
}

function isSuperAdminGateBypass({ actorRole, bypassGateFlow, receiveSpec }) {
  if (String(actorRole || '').toLowerCase() !== 'super_admin') return false;
  return Boolean(bypassGateFlow || receiveSpec?.bypass_gate_flow);
}

async function receiveItemsFromVendor(client, {
  dcNumber,
  ticketIds = null,
  receiveItems = null,
  warehouseEsign,
  vendorEsign,
  actorUserId,
  actorName,
  actorRole = null,
  bypassGateFlow = false,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
    [dcNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Vendor repair DC not found');
  if (!['dispatched', 'partially_returned'].includes(head.status)) {
    throw new Error('DC must be dispatched before receiving items back');
  }

  const fmStageRes = await client.query(`SELECT stage_id, team_id FROM stages WHERE stage_name = 'Floor Manager' LIMIT 1`);
  const fmStageId = fmStageRes.rows[0]?.stage_id || null;
  const fmTeamId = fmStageRes.rows[0]?.team_id || null;

  const receiveMap = normalizeReceiveItems(receiveItems, ticketIds);
  const selectedTicketIds = [...receiveMap.keys()];
  if (!selectedTicketIds.length) throw new Error('Select at least one laptop to receive');

  let itemsQuery = `
    SELECT i.*, t.serial_number AS ticket_serial_number, t.*
      FROM vendor_repair_dc_items i
      JOIN tickets t ON t.ticket_id = i.ticket_id
     WHERE i.dc_number = $1
       AND COALESCE(i.item_status, 'dispatched') IN ('dispatched', 'gate_received')`;
  const params = [dcNumber, selectedTicketIds];
  itemsQuery += ` AND i.ticket_id = ANY($2::int[])`;
  const itemsRes = await client.query(itemsQuery, params);
  if (!itemsRes.rows.length) throw new Error('No dispatched items selected for receive');

  const existingRecv = [...new Set(itemsRes.rows.map((i) => i.receive_dc_number).filter(Boolean))];
  let receiveDcNumber = existingRecv.length === 1 && itemsRes.rows.every((i) => i.receive_dc_number === existingRecv[0])
    ? existingRecv[0]
    : await nextReceiveDcNumber(client, dcNumber);

  if (existingRecv.length !== 1 || !itemsRes.rows.every((i) => i.receive_dc_number === existingRecv[0])) {
    await client.query(
      `INSERT INTO vendor_repair_receive_challans
         (dc_number, receive_dc_number, receive_mode, items_count, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (receive_dc_number) DO NOTHING`,
      [
        dcNumber,
        receiveDcNumber,
        itemsRes.rows.some((i) => (receiveMap.get(i.ticket_id) || {}).receive_mode === 'replacement')
          ? 'mixed'
          : 'repaired',
        itemsRes.rows.length,
        actorUserId || null,
      ]
    );
  }
  const receivedItemIds = [];

  for (const item of itemsRes.rows) {
    const receiveSpec = receiveMap.get(item.ticket_id) || { receive_mode: 'repaired' };
    const isReplacement = receiveSpec.receive_mode === 'replacement';
    const laptopCondition = normalizeCondition(receiveSpec.laptop_condition);
    const superAdminBypass = isSuperAdminGateBypass({ actorRole, bypassGateFlow, receiveSpec });

    if (!head.gate_legacy && !superAdminBypass) {
      if (!item.gate_inward_at) {
        throw new Error(`Guard has not passed ${item.ttspl_id} inward yet.`);
      }
      if (!isReplacement && requiresConfigVerification(laptopCondition)) {
        if (!item.return_config_verified_at) {
          throw new Error(
            `Configuration check has not passed for ${item.ttspl_id}. Run the vendor-return script to verify specs.`
          );
        }
        if (!String(item.return_captured_serial || '').trim()) {
          throw new Error(
            `Serial has not been fetched for ${item.ttspl_id}. Run the vendor-return script so it can read the BIOS serial.`
          );
        }
      }
    }

    const itemWhEsign = receiveSpec.wh_esign || warehouseEsign;
    const itemWhSigner = (receiveSpec.wh_signer_name || '').trim() || actorName || null;
    if (!itemWhEsign) throw new Error(`Warehouse signature required for ticket #${item.ticket_id}`);
    if (!itemWhSigner) throw new Error(`Signer name required for ticket #${item.ticket_id}`);

    const whItemUrl = saveEsign(`wh_recv_${item.ticket_id}`, dcNumber, itemWhEsign);
    const vendorItemUrl = receiveSpec.vendor_esign
      ? saveEsign(`vendor_recv_${item.ticket_id}`, dcNumber, receiveSpec.vendor_esign)
      : (vendorEsign ? saveEsign(`vendor_recv_${item.ticket_id}`, dcNumber, vendorEsign) : null);
    const vendorItemSigner = (receiveSpec.vendor_signer_name || '').trim() || null;
    const signedAt = new Date();

    let replacementDcNumber = null;
    let replacementRow = null;

    if (isReplacement) {
      if (!receiveSpec.replacement_serial_number?.trim()) {
        throw new Error(`Replacement serial number required for ticket #${item.ticket_id}`);
      }
      if (!receiveSpec.replacement_brand?.trim() || !receiveSpec.replacement_model?.trim()) {
        throw new Error(`Replacement brand and model required for ticket #${item.ticket_id}`);
      }
      replacementDcNumber = await nextReplacementDcNumber(client, dcNumber);
      replacementRow = await upsertReplacementSerial(client, {
        serialNumber: receiveSpec.replacement_serial_number,
        brand: receiveSpec.replacement_brand.trim(),
        model: receiveSpec.replacement_model.trim(),
        generation: (receiveSpec.replacement_generation || '').trim() || null,
        vendorId: head.vendor_id,
        originalTtsplId: item.ttspl_id,
        originalSerial: item.serial_number,
        originalSerialId: item.vendor_serial_id || item.serial_id || null,
        replacementDcNumber,
      });
    } else {
      const scriptSerial = String(item.return_captured_serial || '').trim();
      const verifiedSerial = laptopCondition === 'on'
        ? (scriptSerial || String(receiveSpec.verified_serial || item.serial_number || '').trim())
        : String(receiveSpec.verified_serial || '').trim();
      receiveSpec.verified_serial = verifiedSerial;
      if (!serialMatchesExpected(verifiedSerial, item)) {
        throw new Error(
          `Serial verification failed for ticket #${item.ticket_id}. `
          + `Expected ${item.serial_number || item.ttspl_id || '—'}`
        );
      }
    }

    const origCfg = parseItemConfiguration(item);
    const itemStatus = isReplacement ? 'replacement_received' : 'received';
    const replacementConfig = isReplacement
      ? [
        receiveSpec.replacement_brand,
        receiveSpec.replacement_model,
        origCfg.processor,
        receiveSpec.replacement_generation || origCfg.generation,
        origCfg.ram,
        origCfg.storage,
      ].filter(Boolean).join(' · ')
      : null;

    await client.query(
      `UPDATE vendor_repair_dc_items SET
          item_status = $3,
          returned_at = $12::timestamptz,
          receive_dc_number = $2::text,
          receive_mode = $4,
          receive_verified_serial = $5::text,
          receive_wh_esign_url = $6::text,
          receive_wh_signer_name = $7::text,
          receive_wh_signed_at = $12::timestamptz,
          receive_vendor_esign_url = $8::text,
          receive_vendor_signer_name = $9::text,
          receive_vendor_signed_at = CASE WHEN $8::text IS NOT NULL THEN $12::timestamptz ELSE NULL END,
          replacement_serial_number = $10::text,
          replacement_ttspl_id = $11::text,
          replacement_brand = $13::text,
          replacement_model = $14::text,
          replacement_generation = $15::text,
          replacement_configuration = $16::text,
          replacement_dc_number = $17::text,
          replacement_serial_id = $18::int,
          replaced_original_ttspl_id = $19::text,
          replaced_original_serial = $20::text,
          receive_laptop_condition = $21::text
        WHERE id = $1`,
      [
        item.id,
        isReplacement ? replacementDcNumber : receiveDcNumber,
        itemStatus,
        isReplacement ? 'replacement' : 'repaired',
        isReplacement ? null : String(receiveSpec.verified_serial || '').trim(),
        whItemUrl,
        itemWhSigner,
        vendorItemUrl,
        vendorItemSigner,
        isReplacement ? receiveSpec.replacement_serial_number.trim() : null,
        isReplacement ? replacementRow.inventory_asset_code : null,
        signedAt,
        isReplacement ? receiveSpec.replacement_brand.trim() : null,
        isReplacement ? receiveSpec.replacement_model.trim() : null,
        isReplacement ? ((receiveSpec.replacement_generation || '').trim() || origCfg.generation || null) : null,
        isReplacement ? replacementConfig : null,
        replacementDcNumber,
        isReplacement ? replacementRow.serial_id : null,
        isReplacement ? item.ttspl_id : null,
        isReplacement ? item.serial_number : null,
        laptopCondition,
      ]
    );
    receivedItemIds.push(item.id);

    const condHi = conditionHighlight(laptopCondition);
    const highlightReason = isReplacement
      ? (
        `Vendor replacement ${replacementRow.serial_number} (${replacementRow.inventory_asset_code}) for ${item.ttspl_id} — Floor Manager`
        + (condHi.reason ? ` · ${condHi.reason}` : '')
      )
      : (condHi.reason
        ? `${condHi.reason} — Floor Manager triage`
        : 'Returned from vendor repair — Floor Manager triage');

    await client.query(
      `UPDATE tickets SET
          status = 'in_progress',
          current_stage_id = COALESCE($2::int, current_stage_id),
          assigned_user_id = NULL,
          assigned_team_id = $3::int,
          current_location = 'Warehouse — Floor Manager',
          highlighted = TRUE,
          highlighted_reason = $4::text,
          priority = 'high',
          serial_number = COALESCE($5::text, serial_number),
          ttspl_id = COALESCE($6::text, ttspl_id),
          vendor_serial_id = COALESCE($7::int, vendor_serial_id),
          received_condition = $8::text,
          updated_at = NOW()
        WHERE ticket_id = $1`,
      [
        item.ticket_id,
        fmStageId,
        fmTeamId,
        highlightReason,
        isReplacement ? replacementRow.serial_number : null,
        isReplacement ? replacementRow.inventory_asset_code : null,
        isReplacement ? replacementRow.serial_id : null,
        laptopCondition,
      ]
    );

    if (isReplacement && (item.vendor_serial_id || item.serial_id)) {
      await transitionRepairSerial(client, {
        serialId: item.vendor_serial_id || item.serial_id,
        toStatus: STATUS.SCRAPPED,
        reason: `Vendor replacement on ${replacementDcNumber} — original unit scrapped`,
        dcNumber,
        actorUserId,
        actorName: itemWhSigner,
        qcStatus: 'unrepairable',
        extraPatch: {
          location: 'scrapped',
          vendor_repair_dc: dcNumber,
          replaced_by_serial: replacementRow.serial_number,
          replaced_by_ttspl: replacementRow.inventory_asset_code,
          replacement_dc_number: replacementDcNumber,
        },
      });
      await safeLogTtsplEvent({
        ttsplId: item.ttspl_id,
        vendorSerialId: item.vendor_serial_id || item.serial_id,
        eventType: 'vendor_replaced',
        description: `Vendor could not repair — replaced by ${replacementRow.inventory_asset_code} (serial ${replacementRow.serial_number}) via ${replacementDcNumber}`,
        metadata: {
          replacement_ttspl: replacementRow.inventory_asset_code,
          replacement_serial: replacementRow.serial_number,
          replacement_serial_id: replacementRow.serial_id,
          replacement_dc_number: replacementDcNumber,
          vendor_repair_dc: dcNumber,
          original_serial: item.serial_number,
        },
        actorUserId,
        actorName: itemWhSigner,
        db: client,
      });
      // New replacement serial is inserted as in_stock; refresh qc/extra only.
      await client.query(
        `UPDATE vendor_serial_numbers SET
            qc_status = 'pending',
            extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
          WHERE serial_id = $1`,
        [
          replacementRow.serial_id,
          JSON.stringify({
            location: 'warehouse_floor',
            asset_tag: 'replacement',
            vendor_repair_dc: dcNumber,
            receive_dc: replacementDcNumber,
            replacement_dc_number: replacementDcNumber,
            replaced_ticket_id: item.ticket_id,
            replaced_ttspl_id: item.ttspl_id,
            replaced_serial: item.serial_number,
          }),
        ]
      );
      // If the replacement row already existed with a non-stock status, move via SM.
      await transitionRepairSerial(client, {
        serialId: replacementRow.serial_id,
        toStatus: STATUS.IN_STOCK,
        reason: `Vendor replacement received on ${replacementDcNumber}`,
        dcNumber: replacementDcNumber,
        actorUserId,
        actorName: itemWhSigner,
      });
    } else if (item.vendor_serial_id || item.serial_id) {
      await transitionRepairSerial(client, {
        serialId: item.vendor_serial_id || item.serial_id,
        toStatus: STATUS.IN_STOCK,
        reason: `Repaired return via ${receiveDcNumber}`,
        dcNumber: receiveDcNumber,
        actorUserId,
        actorName: itemWhSigner,
        qcStatus: 'pending',
        extraPatch: {
          location: 'warehouse_floor',
          vendor_repair_dc: dcNumber,
          receive_dc: receiveDcNumber,
          received_by: itemWhSigner,
          received_at: signedAt.toISOString(),
        },
      });
    }

    const challanRef = isReplacement ? replacementDcNumber : receiveDcNumber;
    const activityNotes = isReplacement
      ? `Replacement received via ${challanRef} (dispatch ${dcNumber}) — ${replacementRow.serial_number} by ${itemWhSigner}`
      : `Repaired return via ${challanRef} — verified ${receiveSpec.verified_serial} — received by ${itemWhSigner}`;

    await logTicketActivity(client, {
      ticketId: item.ticket_id,
      userId: actorUserId,
      action: isReplacement ? 'replacement_received' : 'returned_from_vendor',
      notes: activityNotes,
      stageId: fmStageId,
    });

    await safeLogTtsplEvent({
      ttsplId: isReplacement ? replacementRow.inventory_asset_code : item.ttspl_id,
      vendorSerialId: isReplacement ? replacementRow.serial_id : (item.vendor_serial_id || item.serial_id),
      eventType: isReplacement ? 'vendor_replacement_received' : 'returned_from_vendor',
      description: activityNotes,
      metadata: {
        dc_number: dcNumber,
        receive_dc_number: isReplacement ? null : receiveDcNumber,
        replacement_dc_number: replacementDcNumber,
        original_ttspl: item.ttspl_id,
        received_by: itemWhSigner,
        received_at: signedAt.toISOString(),
      },
      actorUserId,
      actorName: itemWhSigner,
      db: client,
    });
  }

  const countsRes = await client.query(
    `SELECT
        COUNT(*) FILTER (WHERE COALESCE(item_status, 'draft') IN ('dispatched', 'dispatch_ready', 'gate_received'))::int AS pending,
        COUNT(*) FILTER (WHERE item_status IN ('received', 'replacement_received'))::int AS received,
        COUNT(*)::int AS total
       FROM vendor_repair_dc_items WHERE dc_number = $1`,
    [dcNumber]
  );
  const { pending, received, total } = countsRes.rows[0] || { pending: 0, received: 0, total: 0 };
  const nextStatus = pending === 0 ? 'returned' : 'partially_returned';

  await client.query(
    `UPDATE vendor_repair_delivery_challans SET
        status = $2::text,
        items_received_count = $3::int,
        returned_at = CASE WHEN $2::text = 'returned' THEN NOW() ELSE returned_at END,
        updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, nextStatus, received]
  );

  await client.query(
    `UPDATE vendor_repair_receive_challans SET
        closed_at = COALESCE(closed_at, NOW()),
        items_count = $2
      WHERE receive_dc_number = $1`,
    [receiveDcNumber, itemsRes.rows.length]
  );

  return {
    dc_number: dcNumber,
    receive_dc_number: receiveDcNumber,
    status: nextStatus,
    tickets_updated: itemsRes.rows.length,
    items_received: received,
    items_total: total,
    items_pending: pending,
    received_item_ids: receivedItemIds,
    receive_pdf_pending: true,
  };
}

async function receiveFromVendor(client, {
  dcNumber,
  ticketIds,
  receiveItems,
  warehouseEsign,
  vendorEsign,
  actorUserId,
  actorName,
  actorRole = null,
  bypassGateFlow = false,
}) {
  return receiveItemsFromVendor(client, {
    dcNumber,
    ticketIds,
    receiveItems,
    warehouseEsign,
    vendorEsign,
    actorUserId,
    actorName,
    actorRole,
    bypassGateFlow,
  });
}

function effectiveQcStatusSql(alias = 'vsn') {
  return `COALESCE(
    NULLIF(TRIM(${alias}.qc_status), ''),
    NULLIF(TRIM(${alias}.extra->>'status'), ''),
    'pending'
  )`;
}

/** ERP / migrated laptops marked out for repair (canonical `in_repair` + legacy typo). */
function erpOutForRepareSql(alias = 'vsn') {
  const eff = effectiveQcStatusSql(alias);
  return `${alias}.deleted_at IS NULL
    AND ${alias}.po_id IS NOT NULL
    AND (
      ${alias}.inventory_status = 'in_repair'
      OR ${alias}.inventory_status = 'out_for_repare'
      OR ${eff} IN ('out_for_repare', 'out_for_repair')
      OR COALESCE(NULLIF(TRIM(${alias}.extra->>'action_status'), ''), '') IN ('out_for_repare', 'in_repair')
    )
    AND NOT EXISTS (
      SELECT 1
        FROM vendor_repair_dc_items vri
        JOIN vendor_repair_delivery_challans vrd ON vrd.dc_number = vri.dc_number
        JOIN tickets vt ON vt.ticket_id = vri.ticket_id
       WHERE vrd.status IN ('dispatched', 'partially_returned')
         AND COALESCE(vri.item_status, 'dispatched') IN ('dispatched', 'gate_received')
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
  const specs = resolveVrdcItemSpecs({
    brand,
    model,
    processor: extra.processor || row.pd_processor,
    generation: extra.generation || row.pd_generation,
    ram: extra.ram || row.pd_ram,
    storage: extra.storage || row.pd_storage,
    extra,
  });
  return {
    id: `erp:${row.serial_id}`,
    source: 'erp',
    serial_id: row.serial_id,
    ticket_id: row.open_ticket_id || null,
    ttspl_id: row.ttspl_id || row.inventory_asset_code || null,
    serial_number: row.serial_number,
    brand: specs.brand,
    model: specs.model,
    configuration: buildVrdcConfigurationString({ ...specs, extra }),
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
  const outTs = r.dispatched_at || r.out_date || null;
  const daysOut = outTs
    ? Math.max(0, Math.floor((Date.now() - new Date(outTs).getTime()) / 86400000))
    : null;
  return {
    id: `vdc:${r.id}`,
    source: 'vendor_dc',
    item_id: r.id,
    item_status: r.item_status || 'dispatched',
    serial_id: r.serial_id || null,
    ticket_id: r.ticket_id,
    ttspl_id: r.ttspl_id,
    serial_number: r.serial_number,
    brand: resolveVrdcItemSpecs({ brand: extra.brand || r.ticket_brand, model: extra.model || r.ticket_model, extra }).brand,
    model: resolveVrdcItemSpecs({ brand: extra.brand || r.ticket_brand, model: extra.model || r.ticket_model, extra }).model,
    configuration: r.configuration || buildVrdcConfigurationString({
      brand: extra.brand || r.ticket_brand,
      model: extra.model || r.ticket_model,
      processor: extra.processor,
      generation: extra.generation,
      ram: extra.ram,
      storage: extra.storage,
      extra,
    }),
    vendor_name: r.vendor_name,
    vendor_address: r.vendor_address,
    billing_address: r.billing_address,
    shipping_address: r.shipping_address,
    dc_number: r.dc_number,
    dc_label: r.dc_number,
    out_date: r.out_date,
    expected_return_date: r.expected_return_date,
    current_status: 'Out for Repair',
    remarks: r.item_remarks || r.remarks,
    item_remarks: r.item_remarks,
    items_received_count: r.items_received_count,
    items_dispatched_count: r.items_dispatched_count,
    price: r.price != null ? Number(r.price) : null,
    hsn_code: resolveHsnForDisplay(r.hsn_code, { transactionType: 'repair' }),
    eway_bill_number: r.eway_bill_number || null,
    eway_bill_date: r.eway_bill_date || null,
    ship_by: r.ship_by || null,
    dispatch_mode: r.dispatch_mode || null,
    days_out: daysOut,
    sort_ts: r.dispatched_at,
  };
}

async function listOutForRepairInventory({
  search,
  vendor,
  dcNumber,
  page = 1,
  limit = 25,
  dateFrom,
  dateTo,
  brand,
  model,
  processor,
  generation,
  ram,
  storage,
  screen_size,
  gpu,
} = {}) {
  await ensureVendorRepairSchema();
  const specFilters = pickSpecFilters({
    brand, model, processor, generation, ram, storage, screen_size, gpu,
  });

  const vendorParams = [];
  let vendorWhere = `WHERE d.status IN ('dispatched', 'partially_returned')
    AND t.status = 'out_for_repair'
    AND COALESCE(i.item_status, 'dispatched') = 'dispatched'`;
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
  const vendorDateClauses = appendDateRangeClauses({
    expr: 'COALESCE(d.dispatched_at, d.out_date, d.created_at)',
    dateFrom,
    dateTo,
    params: vendorParams,
  });
  if (vendorDateClauses.length) {
    vendorWhere += ` AND ${vendorDateClauses.join(' AND ')}`;
  }
  const vendorSpecClauses = appendRepairSpecClauses(specFilters, vendorParams, vendorRepairSpecExpr);
  if (vendorSpecClauses.length) {
    vendorWhere += ` AND ${vendorSpecClauses.join(' AND ')}`;
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
  const erpDateClauses = appendDateRangeClauses({
    column: 'updated_at',
    dateFrom,
    dateTo,
    params: erpParams,
    tableAlias: 'vsn',
  });
  if (erpDateClauses.length) {
    erpSearchSql += ` AND ${erpDateClauses.join(' AND ')}`;
  }
  const erpSpecClauses = appendRepairSpecClauses(specFilters, erpParams, erpRepairSpecExpr);
  if (erpSpecClauses.length) {
    erpSearchSql += ` AND ${erpSpecClauses.join(' AND ')}`;
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
              i.item_remarks, i.item_status, i.price, i.hsn_code,
              t.status AS ticket_status,
              t.brand AS ticket_brand, t.model AS ticket_model,
              d.dc_number, d.vendor_name, d.vendor_address, d.billing_address, d.shipping_address,
              d.out_date, d.expected_return_date, d.remarks, d.dispatched_at,
              d.items_received_count, d.items_dispatched_count,
              d.eway_bill_number, d.eway_bill_date, d.ship_by, d.dispatch_mode,
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

async function listVendorRepairDcs({
  search,
  status,
  page = 1,
  limit = 25,
  dateFrom,
  dateTo,
  brand,
  model,
  processor,
  generation,
  ram,
  storage,
  screen_size,
  gpu,
} = {}) {
  await ensureVendorRepairSchema();
  const specFilters = pickSpecFilters({
    brand, model, processor, generation, ram, storage, screen_size, gpu,
  });
  const params = [];
  const conditions = [`COALESCE(d.item_domain, 'laptop') = 'laptop'`];
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    const i = params.length;
    conditions.push(`(
      d.dc_number ILIKE $${i}
      OR d.vendor_name ILIKE $${i}
      OR COALESCE(d.contact_person, '') ILIKE $${i}
    )`);
  }
  if (status?.trim()) {
    params.push(status.trim());
    conditions.push(`d.status = $${params.length}`);
  }
  const dateClauses = appendDateRangeClauses({
    expr: 'COALESCE(d.dispatched_at, d.created_at)',
    dateFrom,
    dateTo,
    params,
  });
  if (dateClauses.length) {
    conditions.push(...dateClauses);
  }
  if (hasSpecFilters(specFilters)) {
    const specClauses = appendRepairSpecClauses(specFilters, params, vendorRepairSpecExpr);
    conditions.push(`EXISTS (
      SELECT 1
        FROM vendor_repair_dc_items i
        JOIN tickets t ON t.ticket_id = i.ticket_id
        LEFT JOIN vendor_serial_numbers vsn
          ON vsn.serial_id = COALESCE(i.serial_id, t.vendor_serial_id) AND vsn.deleted_at IS NULL
       WHERE i.dc_number = d.dc_number
         AND ${specClauses.join(' AND ')}
    )`);
  }
  const where = conditions.join(' AND ');
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const offset = (safePage - 1) * safeLimit;

  const countR = await pool.query(
    `SELECT COUNT(*)::int AS total FROM vendor_repair_delivery_challans d WHERE ${where}`,
    params
  );
  const total = countR.rows[0]?.total || 0;

  const listR = await pool.query(
    `SELECT d.*,
            (SELECT COUNT(*)::int FROM vendor_repair_dc_items i WHERE i.dc_number = d.dc_number) AS item_count,
            (SELECT COUNT(*)::int FROM vendor_repair_dc_items i
              WHERE i.dc_number = d.dc_number AND i.item_status IN ('received', 'replacement_received')) AS received_count,
            (SELECT COUNT(*)::int FROM vendor_repair_dc_items i
              WHERE i.dc_number = d.dc_number
                AND COALESCE(i.item_status, 'draft') IN ('dispatched', 'gate_received')) AS pending_count
       FROM vendor_repair_delivery_challans d
      WHERE ${where}
      ORDER BY d.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safeLimit, offset]
  );

  return {
    data: listR.rows,
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
        WHERE d.status IN ('dispatched', 'partially_returned') AND t.status = 'out_for_repair'
          AND COALESCE(i.item_status, 'dispatched') = 'dispatched'`
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

  await transitionRepairSerial(client, {
    serialId: sid,
    toStatus: STATUS.IN_STOCK,
    reason: 'Received back from external repair — QC Process',
    actorUserId,
    actorName,
    qcStatus: 'pending',
    extraPatch: extra,
  });

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
  EWAY_VALUE_THRESHOLD,
  DEFAULT_HSN,
  resolveDefaultHsn,
  markDiagnosisFailed,
  listDiagnosisFailedTickets,
  createOutForRepairDc,
  getVendorRepairDc,
  updateVendorRepairDispatchDetails,
  updateVendorRepairCommercialDetails,
  markDeliveredToVendor,
  listVendorRepairDcs,
  signDispatchDc,
  receiveFromVendor,
  receiveItemsFromVendor,
  listOutForRepairInventory,
  countOutForRepairInventory,
  receiveErpRepairBack,
  dedupeDraftVrdcItems,
  transitionRepairSerial,
  snapshotFromSpecs,
  nextReceiveDcNumber,
};
