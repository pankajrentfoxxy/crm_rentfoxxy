/**
 * Dispatch charger — warehouse asset sent with a laptop to a customer.
 * Not floor part-attach. Physical identity stays on part_instances (PRT).
 */
const { recordMovement, MOVEMENT } = require('./partMovementService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { formatTtspl, parseTtsplNum } = require('./vendorInventoryAssetCodeService');

const READY_STATUSES = new Set(['attached', 'already_with_customer', 'dispatched', 'returned']);
const SENT_STATUSES = new Set(['attached', 'dispatched']);
const ACTIVE_INSTANCE_STATUSES = new Set(['handed_over', 'attached', 'dispatched']);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeCode(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) {
    const tail = text.split(/[?#]/)[0].split('/').filter(Boolean).pop();
    if (tail) text = tail;
  }
  const slash = text.indexOf('/');
  if (slash > 0 && /^PRT/i.test(text)) text = text.slice(0, slash);
  return text.replace(/\s+/g, '').toUpperCase();
}

function normalizeTtspl(raw) {
  const code = normalizeCode(raw);
  if (!code) return '';
  const stripped = code.replace(/[\s\-_]/g, '');
  const parsed = parseTtsplNum(stripped);
  if (parsed != null) return formatTtspl(parsed);
  if (/^\d+$/.test(stripped)) {
    const num = Number(stripped);
    if (Number.isFinite(num) && num > 0) return formatTtspl(num);
  }
  const flex = stripped.match(/^T+SPL(\d+)$/i);
  if (flex) {
    const num = Number(flex[1]);
    if (Number.isFinite(num) && num > 0) return formatTtspl(num);
  }
  return stripped;
}

function chargerCodesFor(row) {
  return [
    normalizeCode(row.prt_id),
    normalizeCode(row.charger_asset_code),
    normalizeCode(row.charger_serial),
  ].filter(Boolean);
}

function chargerMatchesScan(row, scanned) {
  const code = normalizeCode(scanned);
  if (!code) return false;
  const expected = chargerCodesFor(row);
  if (expected.includes(code)) return true;
  const compact = code.replace(/[-_]/g, '');
  return expected.some((e) => e.replace(/[-_]/g, '') === compact);
}

function ttsplMatchesScan(expected, scanned) {
  const a = normalizeTtspl(expected);
  const b = normalizeTtspl(scanned);
  if (!a || !b) return false;
  return a === b || normalizeCode(expected) === normalizeCode(scanned);
}

function actorName(user) {
  return user?.name || user?.full_name || user?.email || null;
}

function canStartDispatchQc(row) {
  if (!row) return false;
  return READY_STATUSES.has(row.status);
}

function chargerWasSent(row) {
  return row && row.disposition === 'attach' && SENT_STATUSES.has(row.status);
}

function kitRoleFromUnit(unit) {
  const name = String(unit?.part_name || '').toLowerCase();
  if (/(cable|cord)/.test(name)) return 'cable';
  return 'adapter';
}

function kitRoleLabel(role) {
  return role === 'cable' ? 'Power cable' : 'Laptop charger / adapter';
}

function unitCodes(unit) {
  return [
    normalizeCode(unit?.prt_id),
    normalizeCode(unit?.asset_code),
    normalizeCode(unit?.charger_asset_code),
    normalizeCode(unit?.serial_number),
    normalizeCode(unit?.charger_serial),
  ].filter(Boolean);
}

function unitMatchesScan(unit, scanned) {
  const code = normalizeCode(scanned);
  if (!code || !unit) return false;
  const expected = unitCodes(unit);
  if (expected.includes(code)) return true;
  const compact = code.replace(/[-_]/g, '');
  return expected.some((e) => e.replace(/[-_]/g, '') === compact);
}

async function loadKitUnits(db, requestId) {
  if (!requestId) return [];
  const r = await db.query(
    `SELECT unit_id, request_id, kit_role, part_id, part_instance_id,
            prt_id, asset_code, serial_number, part_name
       FROM dispatch_charger_units
      WHERE request_id = $1
      ORDER BY CASE kit_role WHEN 'adapter' THEN 0 ELSE 1 END`,
    [requestId]
  );
  return r.rows;
}

async function hydrateRequest(db, row) {
  if (!row) return null;
  const units = await loadKitUnits(db, row.request_id);
  if (!units.length && row.part_instance_id) {
    units.push({
      kit_role: kitRoleFromUnit({ part_name: row.charger_part_name }),
      part_id: row.part_id,
      part_instance_id: row.part_instance_id,
      prt_id: row.prt_id,
      asset_code: row.charger_asset_code,
      serial_number: row.charger_serial,
      part_name: row.charger_part_name,
    });
  }
  row.units = units;
  return row;
}

function unitByRole(row, role) {
  return (row?.units || []).find((u) => u.kit_role === role) || null;
}

function kitLabel(row) {
  const adapter = unitByRole(row, 'adapter');
  const cable = unitByRole(row, 'cable');
  const parts = [];
  if (adapter) parts.push(adapter.prt_id || adapter.asset_code || adapter.part_name);
  if (cable) parts.push(cable.prt_id || cable.asset_code || cable.part_name);
  if (parts.length) return parts.join(' + ');
  return row.prt_id || row.charger_asset_code || row.charger_serial || null;
}

function publicRequest(row) {
  if (!row) return null;
  const adapter = unitByRole(row, 'adapter');
  const cable = unitByRole(row, 'cable');
  return {
    ...row,
    brand: row.brand || null,
    model: row.model || null,
    can_start_dispatch_qc: canStartDispatchQc(row),
    charger_sent: chargerWasSent(row),
    charger_label: kitLabel(row),
    adapter_label: adapter ? (adapter.prt_id || adapter.asset_code || adapter.part_name) : null,
    cable_label: cable ? (cable.prt_id || cable.asset_code || cable.part_name) : null,
    needs_both_kit_scans: Boolean(adapter && cable),
    needs_qc_scan: row.disposition === 'attach' && row.status === 'attached' && !row.qc_scan_matched,
    needs_return_scan: chargerWasSent(row),
  };
}

async function nextRequestNumber(db) {
  const seq = await db.query(
    `SELECT last_value, prefix FROM sm_document_sequences
      WHERE doc_type = 'dcr' FOR UPDATE`
  );
  let lastValue = 1;
  let prefix = 'DCR-';
  if (seq.rows.length) {
    lastValue = Number(seq.rows[0].last_value) + 1;
    prefix = seq.rows[0].prefix || prefix;
    await db.query(
      `UPDATE sm_document_sequences SET last_value = $1, updated_at = NOW()
        WHERE doc_type = 'dcr'`,
      [lastValue]
    );
  } else {
    await db.query(
      `INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
       VALUES ('dcr', 1, 'DCR-')`
    );
  }
  return `${prefix}${String(lastValue).padStart(4, '0')}`;
}

async function loadTicketContext(db, ticketId) {
  const r = await db.query(
    `SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.sales_order_number,
            t.vendor_serial_id, t.ticket_type,
            s.stage_name,
            sos.allocation_id, sos.serial_id AS sos_serial_id,
            sos.ttspl_id AS sos_ttspl, sos.serial_number AS sos_serial
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
       LEFT JOIN sales_order_serials sos
         ON sos.qc_ticket_id = t.ticket_id
        AND sos.status IN ('attached', 'dispatched')
      WHERE t.ticket_id = $1
      ORDER BY sos.allocation_id DESC NULLS LAST
      LIMIT 1`,
    [ticketId]
  );
  if (!r.rows[0]) throw httpError('Ticket not found', 404);
  const row = r.rows[0];
  return {
    ...row,
    serial_id: row.sos_serial_id || row.vendor_serial_id || null,
    ttspl_id: row.sos_ttspl || row.ttspl_id || null,
    serial_number: row.sos_serial || row.serial_number || null,
  };
}

async function getActiveByTicket(db, ticketId) {
  const r = await db.query(
    `SELECT * FROM dispatch_charger_requests
      WHERE ticket_id = $1 AND status <> 'cancelled'
      ORDER BY request_id DESC
      LIMIT 1`,
    [ticketId]
  );
  return hydrateRequest(db, r.rows[0] || null);
}

async function getById(db, requestId) {
  const r = await db.query(
    `SELECT * FROM dispatch_charger_requests WHERE request_id = $1`,
    [requestId]
  );
  return hydrateRequest(db, r.rows[0] || null);
}

async function findActiveByTtspl(db, ttspl) {
  const code = normalizeTtspl(ttspl);
  if (!code) return null;
  const r = await db.query(
    `SELECT dcr.*
       FROM dispatch_charger_requests dcr
       LEFT JOIN tickets t ON t.ticket_id = dcr.ticket_id
      WHERE UPPER(COALESCE(dcr.ttspl_id, '')) = UPPER($1)
        AND dcr.status <> 'cancelled'
        AND COALESCE(t.status, '') <> 'cancelled'
      ORDER BY dcr.request_id DESC
      LIMIT 1`,
    [code]
  );
  return hydrateRequest(db, r.rows[0] || null);
}

async function auditCharger(db, ctx, user, eventType, description, metadata = {}) {
  const ttspl = ctx.ttspl_id || ctx.sos_ttspl || null;
  if (!ttspl) return;
  await logTtsplEvent({
    ttsplId: ttspl,
    vendorSerialId: ctx.serial_id || ctx.vendor_serial_id || null,
    eventType,
    description,
    metadata,
    actorUserId: user?.user_id || null,
    actorName: actorName(user),
    db,
  });
}

async function markAlreadyWithCustomer(db, ticketId, user, remarks) {
  const ctx = await loadTicketContext(db, ticketId);
  const existing = await getActiveByTicket(db, ticketId);
  if (existing) {
    if (existing.status === 'already_with_customer') return existing;
    throw httpError('A charger request is already open for this laptop. Cancel it first to change.');
  }
  const number = await nextRequestNumber(db);
  const r = await db.query(
    `INSERT INTO dispatch_charger_requests (
       request_number, ticket_id, allocation_id, serial_id, ttspl_id,
       sales_order_number, disposition, status, requested_by, remarks
     ) VALUES ($1,$2,$3,$4,$5,$6,'already_with_customer','already_with_customer',$7,$8)
     RETURNING *`,
    [
      number,
      ctx.ticket_id,
      ctx.allocation_id || null,
      ctx.serial_id || null,
      ctx.ttspl_id || null,
      ctx.sales_order_number || null,
      user?.user_id || null,
      remarks || null,
    ]
  );
  await auditCharger(db, ctx, user, 'dispatch_charger_already_with_customer',
    'Charger already with customer — no charger sent with this dispatch',
    { request_number: number });
  return r.rows[0];
}

async function raiseAttachRequest(db, ticketId, user, remarks) {
  const ctx = await loadTicketContext(db, ticketId);
  await releaseStaleRequestsForTtspl(db, ctx.ttspl_id, user);
  const existing = await getActiveByTicket(db, ticketId);
  if (existing) {
    if (existing.disposition === 'attach' && existing.status !== 'cancelled') return existing;
    throw httpError('A charger decision is already recorded for this laptop. Cancel it first to change.');
  }
  const number = await nextRequestNumber(db);
  const r = await db.query(
    `INSERT INTO dispatch_charger_requests (
       request_number, ticket_id, allocation_id, serial_id, ttspl_id,
       sales_order_number, disposition, status, requested_by, remarks
     ) VALUES ($1,$2,$3,$4,$5,$6,'attach','pending',$7,$8)
     RETURNING *`,
    [
      number,
      ctx.ticket_id,
      ctx.allocation_id || null,
      ctx.serial_id || null,
      ctx.ttspl_id || null,
      ctx.sales_order_number || null,
      user?.user_id || null,
      remarks || null,
    ]
  );
  await auditCharger(db, ctx, user, 'dispatch_charger_requested',
    `Dispatch charger requested (${number})`,
    { request_number: number });
  return r.rows[0];
}

async function cancelRequest(db, requestId, user, remarks, opts = {}) {
  const row = await getById(db, requestId);
  if (!row) throw httpError('Charger request not found', 404);
  if (row.status === 'cancelled') return row;
  const force = Boolean(opts.force);
  if (['dispatched', 'returned'].includes(row.status)) {
    throw httpError('Cannot cancel a charger that has already been dispatched or returned');
  }
  if (row.qc_scan_matched && !force) {
    throw httpError('Cannot cancel after Dispatch QC charger scan is complete');
  }
  const kitUnits = row.units?.length
    ? row.units
    : (row.part_instance_id ? [{
      part_id: row.part_id,
      part_instance_id: row.part_instance_id,
      prt_id: row.prt_id,
      serial_number: row.charger_serial,
      part_name: row.charger_part_name,
    }] : []);
  if (ACTIVE_INSTANCE_STATUSES.has(row.status)) {
    for (const unit of kitUnits) {
      if (!unit.part_instance_id) continue;
      await db.query(
        `UPDATE part_instances SET status = 'in_stock', updated_at = NOW()
          WHERE instance_id = $1 AND status = 'reserved'`,
        [unit.part_instance_id]
      );
      await recordMovement(db, {
        type: MOVEMENT.UNRESERVED,
        partId: unit.part_id || row.part_id,
        instanceId: unit.part_instance_id,
        prtId: unit.prt_id,
        serialNumber: unit.serial_number,
        category: 'power',
        partName: unit.part_name,
        ticketId: row.ticket_id,
        ttsplId: row.ttspl_id,
        notes: `Dispatch charger cancelled ${row.request_number}`,
        actorUserId: user?.user_id,
        actorName: actorName(user),
      });
    }
  }
  await db.query(`DELETE FROM dispatch_charger_units WHERE request_id = $1`, [requestId]);
  const r = await db.query(
    `UPDATE dispatch_charger_requests
        SET status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_by = $2,
            remarks = COALESCE($3, remarks),
            updated_at = NOW()
      WHERE request_id = $1
      RETURNING *`,
    [requestId, user?.user_id || null, remarks || null]
  );
  await auditCharger(db, row, user, 'dispatch_charger_cancelled',
    `Dispatch charger request cancelled (${row.request_number})`,
    { request_number: row.request_number });
  return r.rows[0];
}

/** Release charger kits when a floor ticket is cancelled / remade. */
async function cancelRequestsForTicket(db, ticketId, user, remarks) {
  const id = Number(ticketId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const r = await db.query(
    `SELECT request_id FROM dispatch_charger_requests
      WHERE ticket_id = $1
        AND status <> 'cancelled'
        AND status NOT IN ('dispatched', 'returned')`,
    [id]
  );
  const out = [];
  for (const row of r.rows) {
    out.push(await cancelRequest(
      db,
      row.request_id,
      user,
      remarks || 'Released because the floor ticket was cancelled',
      { force: true }
    ));
  }
  return out;
}

/** Same laptop, previous ticket cancelled — free reserved adapter/cable. */
async function releaseStaleRequestsForTtspl(db, ttspl, user) {
  const code = normalizeTtspl(ttspl);
  if (!code) return [];
  const r = await db.query(
    `SELECT dcr.request_id
       FROM dispatch_charger_requests dcr
       JOIN tickets t ON t.ticket_id = dcr.ticket_id
      WHERE UPPER(COALESCE(dcr.ttspl_id, '')) = UPPER($1)
        AND dcr.status <> 'cancelled'
        AND dcr.status NOT IN ('dispatched', 'returned')
        AND t.status = 'cancelled'`,
    [code]
  );
  const out = [];
  for (const row of r.rows) {
    out.push(await cancelRequest(
      db,
      row.request_id,
      user,
      'Released because the previous floor ticket was cancelled',
      { force: true }
    ));
  }
  return out;
}

async function releaseReservedKit(db, row, user, note) {
  const kitUnits = row.units?.length
    ? row.units
    : (row.part_instance_id ? [{
      part_id: row.part_id,
      part_instance_id: row.part_instance_id,
      prt_id: row.prt_id,
      serial_number: row.charger_serial,
      part_name: row.charger_part_name,
    }] : []);
  for (const unit of kitUnits) {
    if (!unit.part_instance_id) continue;
    await db.query(
      `UPDATE part_instances SET status = 'in_stock', updated_at = NOW()
        WHERE instance_id = $1 AND status = 'reserved'`,
      [unit.part_instance_id]
    );
    await recordMovement(db, {
      type: MOVEMENT.UNRESERVED,
      partId: unit.part_id || row.part_id,
      instanceId: unit.part_instance_id,
      prtId: unit.prt_id,
      serialNumber: unit.serial_number,
      category: 'power',
      partName: unit.part_name,
      ticketId: row.ticket_id,
      ttsplId: row.ttspl_id,
      notes: note,
      actorUserId: user?.user_id,
      actorName: actorName(user),
    });
  }
}

async function undoHandover(db, requestId, user, remarks) {
  const row = await getById(db, requestId);
  if (!row) throw httpError('Charger request not found', 404);
  if (row.status !== 'handed_over') {
    throw httpError(`Can only undo handover while status is handed_over (now ${row.status})`);
  }
  if (row.qc_scan_matched) {
    throw httpError('Cannot undo handover after Dispatch QC charger scan is complete');
  }
  await releaseReservedKit(db, row, user, `Dispatch charger handover undone ${row.request_number}`);
  await db.query(`DELETE FROM dispatch_charger_units WHERE request_id = $1`, [requestId]);
  const extra = { ...(row.extra || {}) };
  delete extra.cable_prt_id;
  delete extra.cable_part_name;
  const r = await db.query(
    `UPDATE dispatch_charger_requests
        SET status = 'pending',
            part_id = NULL,
            part_instance_id = NULL,
            prt_id = NULL,
            charger_asset_code = NULL,
            charger_serial = NULL,
            charger_part_name = NULL,
            handed_over_by = NULL,
            handed_over_at = NULL,
            extra = $3::jsonb,
            remarks = COALESCE($2, remarks),
            updated_at = NOW()
      WHERE request_id = $1
      RETURNING *`,
    [requestId, remarks || null, JSON.stringify(extra)]
  );
  await auditCharger(db, row, user, 'dispatch_charger_handover_undone',
    `Warehouse handover undone (${row.request_number}) — assign a new adapter and power cable`,
    { request_number: row.request_number, previous_adapter: row.prt_id });
  return hydrateRequest(db, r.rows[0]);
}

async function lookupChargerUnit(db, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) throw httpError('Scan a charger PRT ID, asset code, or serial');
  const r = await db.query(
    `SELECT pi.instance_id, pi.prt_id, pi.asset_code, pi.serial_number, pi.status,
            pi.part_id, p.part_name, p.category
       FROM part_instances pi
       JOIN parts p ON p.part_id = pi.part_id
      WHERE UPPER(pi.prt_id) = $1
         OR UPPER(COALESCE(pi.asset_code, '')) = $1
         OR UPPER(REPLACE(COALESCE(pi.asset_code, ''), '-', '_')) = $1
         OR UPPER(COALESCE(pi.serial_number, '')) = $1
      ORDER BY (UPPER(pi.prt_id) = $1) DESC, pi.instance_id DESC
      LIMIT 1`,
    [code]
  );
  if (!r.rows[0]) throw httpError(`No charger unit found for "${rawCode}"`, 404);
  return r.rows[0];
}

function assertPowerCategory(unit) {
  const cat = String(unit.category || '').toLowerCase();
  const name = String(unit.part_name || '').toLowerCase();
  if (cat === 'power') return;
  if (name.includes('charger') || name.includes('adapter') || name.includes('power')) return;
  throw httpError('Scanned unit is not a charger / power adapter');
}

async function listAvailableChargers(db, search, opts = {}) {
  const params = [];
  let where = `p.category = 'power' AND pi.status = 'in_stock'`;
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    where += ` AND (
      pi.prt_id ILIKE $${params.length}
      OR pi.asset_code ILIKE $${params.length}
      OR pi.serial_number ILIKE $${params.length}
      OR p.part_name ILIKE $${params.length}
    )`;
  }
  const role = String(opts.role || '').toLowerCase();
  if (role === 'cable') {
    where += ` AND LOWER(p.part_name) ~ '(cable|cord)'`;
  } else if (role === 'adapter') {
    where += ` AND LOWER(p.part_name) !~ '(cable|cord)'`;
  }
  const perRole = Math.min(Math.max(Number(opts.limit) || 80, 10), 200);
  params.push(perRole);
  const r = await db.query(
    `SELECT instance_id, prt_id, asset_code, serial_number, status,
            part_id, part_name, category, kit_role
       FROM (
         SELECT pi.instance_id, pi.prt_id, pi.asset_code, pi.serial_number, pi.status,
                pi.part_id, p.part_name, p.category,
                CASE
                  WHEN LOWER(p.part_name) ~ '(cable|cord)' THEN 'cable'
                  ELSE 'adapter'
                END AS kit_role,
                ROW_NUMBER() OVER (
                  PARTITION BY CASE
                    WHEN LOWER(p.part_name) ~ '(cable|cord)' THEN 'cable'
                    ELSE 'adapter'
                  END
                  ORDER BY pi.received_at ASC NULLS LAST, pi.instance_id ASC
                ) AS rn
           FROM part_instances pi
           JOIN parts p ON p.part_id = pi.part_id
          WHERE ${where}
       ) ranked
      WHERE rn <= $${params.length}
      ORDER BY CASE kit_role WHEN 'adapter' THEN 0 ELSE 1 END, instance_id ASC`,
    params
  );
  return r.rows;
}

async function listWarehouseQueue(db, status) {
  const params = [];
  let where = `dcr.disposition = 'attach' AND dcr.status <> 'cancelled'`;
  if (status && status !== 'all') {
    params.push(status);
    where += ` AND dcr.status = $${params.length}`;
  }
  const r = await db.query(
    `SELECT dcr.*,
            u.name AS requested_by_name,
            h.name AS handed_over_by_name,
            t.brand, t.model, t.serial_number, t.sales_order_number AS ticket_so
       FROM dispatch_charger_requests dcr
       LEFT JOIN users u ON u.user_id = dcr.requested_by
       LEFT JOIN users h ON h.user_id = dcr.handed_over_by
       LEFT JOIN tickets t ON t.ticket_id = dcr.ticket_id
      WHERE ${where}
      ORDER BY
        CASE dcr.status
          WHEN 'pending' THEN 0
          WHEN 'handed_over' THEN 1
          WHEN 'attached' THEN 2
          ELSE 3
        END,
        dcr.requested_at ASC`,
    params
  );
  const hydrated = [];
  for (const row of r.rows) {
    hydrated.push(publicRequest(await hydrateRequest(db, row)));
  }
  return hydrated;
}

async function loadStockUnit(db, input = {}) {
  if (input.instance_id) {
    const r = await db.query(
      `SELECT pi.instance_id, pi.prt_id, pi.asset_code, pi.serial_number, pi.status,
              pi.part_id, p.part_name, p.category
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
        WHERE pi.instance_id = $1`,
      [Number(input.instance_id)]
    );
    if (!r.rows[0]) throw httpError('Charger unit not found', 404);
    return r.rows[0];
  }
  if (input.scan_code) return lookupChargerUnit(db, input.scan_code);
  return null;
}

async function reserveKitUnit(db, row, unit, role, user) {
  assertPowerCategory(unit);
  if (kitRoleFromUnit(unit) !== role) {
    throw httpError(`Scan a ${kitRoleLabel(role).toLowerCase()}, not ${unit.part_name}`);
  }
  if (unit.status !== 'in_stock') {
    throw httpError(`${unit.prt_id || unit.asset_code} is ${unit.status}, not in stock`);
  }
  const taken = await db.query(
    `SELECT dcr.request_number, dcr.ticket_id, dcr.ttspl_id
       FROM dispatch_charger_units dcu
       JOIN dispatch_charger_requests dcr ON dcr.request_id = dcu.request_id
      WHERE dcu.part_instance_id = $1
        AND dcr.status IN ('handed_over', 'attached', 'dispatched')
      LIMIT 1`,
    [unit.instance_id]
  );
  if (taken.rows[0]) {
    const other = taken.rows[0];
    throw httpError(
      `This unit is already attached on ${other.request_number}`
      + (other.ttspl_id ? ` (${other.ttspl_id}` : '')
      + (other.ticket_id ? `, ticket ${other.ticket_id}` : '')
      + (other.ttspl_id ? ')' : '')
    );
  }
  const reserved = await db.query(
    `UPDATE part_instances SET status = 'reserved', updated_at = NOW()
      WHERE instance_id = $1 AND status = 'in_stock'
      RETURNING instance_id`,
    [unit.instance_id]
  );
  if (!reserved.rows[0]) throw httpError(`Could not reserve ${unit.prt_id || unit.asset_code}`);

  await db.query(
    `INSERT INTO dispatch_charger_units (
       request_id, kit_role, part_id, part_instance_id, prt_id, asset_code, serial_number, part_name
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (request_id, kit_role) DO UPDATE
       SET part_id = EXCLUDED.part_id,
           part_instance_id = EXCLUDED.part_instance_id,
           prt_id = EXCLUDED.prt_id,
           asset_code = EXCLUDED.asset_code,
           serial_number = EXCLUDED.serial_number,
           part_name = EXCLUDED.part_name`,
    [
      row.request_id,
      role,
      unit.part_id,
      unit.instance_id,
      unit.prt_id,
      unit.asset_code,
      unit.serial_number,
      unit.part_name,
    ]
  );
  await recordMovement(db, {
    type: MOVEMENT.RESERVED,
    partId: unit.part_id,
    instanceId: unit.instance_id,
    prtId: unit.prt_id,
    serialNumber: unit.serial_number,
    category: unit.category,
    partName: unit.part_name,
    ticketId: row.ticket_id,
    ttsplId: row.ttspl_id,
    notes: `Dispatch ${role} handed over ${row.request_number}`,
    actorUserId: user?.user_id,
    actorName: actorName(user),
  });
  return unit;
}

function kitScanPayload(body = {}) {
  return {
    adapter: body.adapter || {
      scan_code: body.adapter_scan || (body.scan_code && !body.cable_scan ? body.scan_code : null),
      instance_id: body.adapter_instance_id,
    },
    cable: body.cable || {
      scan_code: body.cable_scan,
      instance_id: body.cable_instance_id,
    },
  };
}

function assertKitScansMatch(row, body = {}) {
  const adapter = unitByRole(row, 'adapter');
  const cable = unitByRole(row, 'cable');
  const scans = kitScanPayload(body);
  if (adapter && !unitMatchesScan(adapter, scans.adapter.scan_code || body.adapter_scan || body.scan_code)) {
    throw httpError(
      `This is a different ${kitRoleLabel('adapter').toLowerCase()}. Scan ${adapter.prt_id || adapter.asset_code}.`
    );
  }
  if (cable && !unitMatchesScan(cable, scans.cable.scan_code || body.cable_scan)) {
    throw httpError(
      `This is a different ${kitRoleLabel('cable').toLowerCase()}. Scan ${cable.prt_id || cable.asset_code}.`
    );
  }
  if (!adapter && !cable && !chargerMatchesScan(row, body.scan_code || body.adapter_scan || body.charger_scan)) {
    throw httpError('This is a different charger. Scan the attached charger.');
  }
}

async function approveAndHandover(db, requestId, user, body = {}) {
  const row = await getById(db, requestId);
  if (!row) throw httpError('Charger request not found', 404);
  if (row.disposition !== 'attach') throw httpError('This request is not a charger attach');
  if (row.status !== 'pending') throw httpError(`Request is already ${row.status}`);

  const scans = kitScanPayload(body);
  const adapter = await loadStockUnit(db, scans.adapter);
  const cable = await loadStockUnit(db, scans.cable);
  if (!adapter || !cable) {
    throw httpError('Scan both products: Laptop Charger Power Adapter and Power cable');
  }
  if (adapter.instance_id === cable.instance_id) {
    throw httpError('Adapter and power cable must be two different units');
  }

  await reserveKitUnit(db, row, adapter, 'adapter', user);
  await reserveKitUnit(db, row, cable, 'cable', user);

  const updated = await db.query(
    `UPDATE dispatch_charger_requests
        SET status = 'handed_over',
            part_id = $2,
            part_instance_id = $3,
            prt_id = $4,
            charger_asset_code = $5,
            charger_serial = $6,
            charger_part_name = $7,
            handed_over_by = $8,
            handed_over_at = NOW(),
            extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object(
              'cable_prt_id', $9::text,
              'cable_part_name', $10::text
            ),
            updated_at = NOW()
      WHERE request_id = $1
      RETURNING *`,
    [
      requestId,
      adapter.part_id,
      adapter.instance_id,
      adapter.prt_id,
      adapter.asset_code,
      adapter.serial_number,
      adapter.part_name,
      user?.user_id || null,
      cable.prt_id || cable.asset_code,
      cable.part_name,
    ]
  );

  await auditCharger(db, row, user, 'dispatch_charger_handed_over',
    `Warehouse handed over adapter ${adapter.prt_id} and cable ${cable.prt_id} for ${row.ttspl_id || 'laptop'}`,
    { request_number: row.request_number, adapter_prt: adapter.prt_id, cable_prt: cable.prt_id });
  return hydrateRequest(db, updated.rows[0]);
}

async function attachCharger(db, requestId, user, body = {}) {
  const scanBody = typeof body === 'string' ? { scan_code: body } : (body || {});
  const row = await getById(db, requestId);
  if (!row) throw httpError('Charger request not found', 404);
  if (row.status === 'attached') {
    assertKitScansMatch(row, scanBody);
    return row;
  }
  if (row.status !== 'handed_over') {
    throw httpError('Warehouse must approve and hand over the charger and power cable before attach');
  }
  if (unitByRole(row, 'cable') && !(scanBody.cable_scan || scanBody.cable?.scan_code)) {
    throw httpError('Scan both the laptop charger and the power cable that warehouse handed over');
  }
  assertKitScansMatch(row, scanBody);
  const updated = await db.query(
    `UPDATE dispatch_charger_requests
        SET status = 'attached',
            attached_by = $2,
            attached_at = NOW(),
            updated_at = NOW()
      WHERE request_id = $1
      RETURNING *`,
    [requestId, user?.user_id || null]
  );
  await auditCharger(db, row, user, 'dispatch_charger_attached',
    `Adapter ${row.adapter_label || row.prt_id} and cable attached for ${row.ttspl_id || 'laptop'}`,
    { request_number: row.request_number });
  return hydrateRequest(db, updated.rows[0]);
}

async function recordQcScan(db, ticketId, user, body = {}) {
  const { ttspl_scan, charger_scan } = body;
  const row = await getActiveByTicket(db, ticketId);
  if (!row) throw httpError('Choose charger attach or charger already with customer first');
  if (!canStartDispatchQc(row)) {
    throw httpError('Attach the handed-over charger before Dispatch QC submit');
  }

  const ttsplOk = ttsplMatchesScan(row.ttspl_id, ttspl_scan);
  if (!ttsplOk) {
    throw httpError(`TTSPL mismatch. Scan ${row.ttspl_id || 'the laptop TTSPL ID'} on this ticket.`);
  }

  if (row.disposition === 'already_with_customer') {
    const updated = await db.query(
      `UPDATE dispatch_charger_requests
          SET qc_ttspl_scanned = $2,
              qc_charger_scanned = NULL,
              qc_cable_scanned = NULL,
              qc_scan_matched = true,
              qc_scanned_by = $3,
              qc_scanned_at = NOW(),
              updated_at = NOW()
        WHERE request_id = $1
        RETURNING *`,
      [row.request_id, normalizeTtspl(ttspl_scan), user?.user_id || null]
    );
    return hydrateRequest(db, updated.rows[0]);
  }

  if (unitByRole(row, 'cable') && !(body.cable_scan || body.cable?.scan_code)) {
    throw httpError('Scan both the attached laptop charger and the power cable');
  }
  assertKitScansMatch(row, { ...body, scan_code: body.adapter_scan || charger_scan || body.scan_code });

  const adapterScan = normalizeCode(body.adapter_scan || charger_scan || body.scan_code);
  const cableScan = normalizeCode(body.cable_scan);
  const updated = await db.query(
    `UPDATE dispatch_charger_requests
        SET qc_ttspl_scanned = $2,
            qc_charger_scanned = $3,
            qc_cable_scanned = $4,
            qc_scan_matched = true,
            qc_scanned_by = $5,
            qc_scanned_at = NOW(),
            updated_at = NOW()
      WHERE request_id = $1
      RETURNING *`,
    [row.request_id, normalizeTtspl(ttspl_scan), adapterScan, cableScan || null, user?.user_id || null]
  );
  await auditCharger(db, row, user, 'dispatch_charger_qc_scanned',
    `Dispatch QC scanned TTSPL + adapter ${row.adapter_label || row.prt_id} + cable ${row.cable_label || ''}`.trim(),
    { request_number: row.request_number, adapter: adapterScan, cable: cableScan });
  return hydrateRequest(db, updated.rows[0]);
}

async function assertReadyForDispatchQc(db, ticketId, { requireScan = false } = {}) {
  const row = await getActiveByTicket(db, ticketId);
  if (!row || !canStartDispatchQc(row)) {
    throw httpError(
      'Complete charger attach (or mark charger already with customer) before Dispatch QC',
      409
    );
  }
  if (requireScan) {
    if (row.disposition === 'attach' && !row.qc_scan_matched) {
      throw httpError('Scan the laptop TTSPL ID, charger, and power cable before submitting Dispatch QC', 409);
    }
    if (row.disposition === 'already_with_customer' && !row.qc_scan_matched) {
      throw httpError('Scan the laptop TTSPL ID before submitting Dispatch QC', 409);
    }
  }
  return row;
}

async function loadPickupItem(db, pickupItemId) {
  const r = await db.query(
    `SELECT * FROM support_ticket_items WHERE id = $1`,
    [pickupItemId]
  );
  if (!r.rows[0]) throw httpError('Pickup item not found', 404);
  return r.rows[0];
}

function isTechnicianPickup(item) {
  const method = String(item.pickup_method || '').toLowerCase();
  return method !== 'courier' && method !== 'porter';
}

function isReturnPickup(item) {
  if (String(item.pickup_type || '').toLowerCase() === 'repair') return false;
  if (item.source_item_id && !item.pickup_type) return false;
  return String(item.pickup_type || 'return').toLowerCase() === 'return';
}

async function chargerForPickup(db, item) {
  const ttspl = item.ttspl_id || item.unique_serial_number || null;
  let row = ttspl ? await findActiveByTtspl(db, ttspl) : null;
  if (!row && item.serial_number) {
    const r = await db.query(
      `SELECT * FROM dispatch_charger_requests
        WHERE UPPER(COALESCE(charger_serial, '')) = UPPER($1)
           OR serial_id IN (
             SELECT serial_id FROM vendor_serial_numbers
              WHERE deleted_at IS NULL AND UPPER(serial_number) = UPPER($1)
           )
        AND status <> 'cancelled'
        ORDER BY request_id DESC LIMIT 1`,
      [item.serial_number]
    );
    row = await hydrateRequest(db, r.rows[0] || null);
  }
  return row;
}

async function getPickupChargerState(db, pickupItemId) {
  const item = await loadPickupItem(db, pickupItemId);
  const row = await chargerForPickup(db, item);
  const lastScan = row
    ? (await db.query(
      `SELECT * FROM dispatch_charger_return_scans
        WHERE request_id = $1 AND pickup_item_id = $2
        ORDER BY scan_id DESC LIMIT 1`,
      [row.request_id, pickupItemId]
    )).rows[0] || null
    : null;
  const required = isReturnPickup(item) && isTechnicianPickup(item) && chargerWasSent(row);
  return {
    pickup_item_id: item.id,
    pickup_type: item.pickup_type,
    pickup_method: item.pickup_method,
    ttspl_id: item.ttspl_id || item.unique_serial_number || row?.ttspl_id || null,
    return_dc_number: item.return_dc_number || null,
    required,
    skip_reason: !isReturnPickup(item)
      ? 'repair_pickup'
      : !isTechnicianPickup(item)
        ? 'courier_or_porter'
        : !chargerWasSent(row)
          ? (row?.disposition === 'already_with_customer' ? 'already_with_customer' : 'no_charger_sent')
          : null,
    scanned: Boolean(lastScan?.matched),
    last_scan: lastScan,
    charger: publicRequest(row),
  };
}

async function getReturnDcChargerState(db, rdcNumber) {
  const items = await db.query(
    `SELECT * FROM support_ticket_items
      WHERE item_type = 'pickup' AND return_dc_number = $1
        AND COALESCE(status, '') NOT IN ('cancelled')
      ORDER BY id ASC`,
    [rdcNumber]
  );
  const units = [];
  for (const item of items.rows) {
    units.push(await getPickupChargerState(db, item.id));
  }
  return { return_dc_number: rdcNumber, units };
}

async function recordReturnScan(db, pickupItemId, user, body = {}) {
  const { ttspl_scan, charger_scan } = body;
  const item = await loadPickupItem(db, pickupItemId);
  if (item.item_type !== 'pickup') throw httpError('Only for pickup items');
  if (!isReturnPickup(item)) throw httpError('Charger scan is only for customer return pickup, not repair');
  if (!isTechnicianPickup(item)) {
    throw httpError('Charger scan is not required for courier / porter pickup. Guard will verify.');
  }
  const row = await chargerForPickup(db, item);
  if (!chargerWasSent(row)) {
    throw httpError('No charger was sent with this laptop');
  }

  const expectedTtspl = item.ttspl_id || item.unique_serial_number || row.ttspl_id;
  if (!ttsplMatchesScan(expectedTtspl, ttspl_scan)) {
    throw httpError(`TTSPL mismatch. Scan ${expectedTtspl || 'the laptop we sent'}.`);
  }
  if (unitByRole(row, 'cable') && !(body.cable_scan || body.cable?.scan_code)) {
    throw httpError('Scan both the charger and the power cable that we sent with this laptop');
  }
  assertKitScansMatch(row, { ...body, scan_code: body.adapter_scan || charger_scan || body.scan_code });

  const scan = await db.query(
    `INSERT INTO dispatch_charger_return_scans (
       request_id, pickup_item_id, return_dc_number,
       ttspl_scanned, charger_scanned, cable_scanned, matched, scanned_by
     ) VALUES ($1,$2,$3,$4,$5,$6,true,$7)
     RETURNING *`,
    [
      row.request_id,
      item.id,
      item.return_dc_number || null,
      normalizeTtspl(ttspl_scan),
      normalizeCode(body.adapter_scan || charger_scan || body.scan_code),
      normalizeCode(body.cable_scan) || null,
      user?.user_id || null,
    ]
  );
  await auditCharger(db, row, user, 'dispatch_charger_return_scanned',
    `Return pickup scanned TTSPL + adapter + cable`,
    { request_number: row.request_number, pickup_item_id: item.id, return_dc_number: item.return_dc_number });
  return { scan: scan.rows[0], charger: publicRequest(row) };
}

async function recordReturnScanForRdc(db, rdcNumber, user, body) {
  const items = await db.query(
    `SELECT id, ttspl_id, unique_serial_number, serial_number
       FROM support_ticket_items
      WHERE item_type = 'pickup' AND return_dc_number = $1
        AND COALESCE(status, '') NOT IN ('cancelled')
      ORDER BY id ASC`,
    [rdcNumber]
  );
  if (!items.rows.length) throw httpError('Return DC pickup not found', 404);
  const scannedTtspl = normalizeTtspl(body.ttspl_scan);
  const match = items.rows.find((i) => ttsplMatchesScan(i.ttspl_id || i.unique_serial_number, scannedTtspl))
    || items.rows[0];
  return recordReturnScan(db, match.id, user, body);
}

async function markDispatchedForDc(db, dcNumber, user) {
  if (!dcNumber) return 0;
  const r = await db.query(
    `UPDATE dispatch_charger_requests dcr
        SET status = 'dispatched',
            dispatched_at = NOW(),
            extra = COALESCE(dcr.extra, '{}'::jsonb) || jsonb_build_object('dc_number', $1::text),
            updated_at = NOW()
      WHERE dcr.status = 'attached'
        AND dcr.disposition = 'attach'
        AND (
          dcr.serial_id IN (
            SELECT serial_id FROM vendor_serial_numbers
             WHERE current_dc_number = $1 AND deleted_at IS NULL
          )
          OR dcr.allocation_id IN (
            SELECT allocation_id FROM sales_order_serials WHERE dc_number = $1
          )
        )
      RETURNING request_id, part_instance_id, part_id, prt_id, charger_serial,
                charger_part_name, ticket_id, ttspl_id`,
    [dcNumber]
  );
  for (const row of r.rows) {
    const hydrated = await hydrateRequest(db, row);
    const kitUnits = hydrated.units?.length
      ? hydrated.units
      : (row.part_instance_id ? [{
        part_id: row.part_id,
        part_instance_id: row.part_instance_id,
        prt_id: row.prt_id,
        serial_number: row.charger_serial,
        part_name: row.charger_part_name,
      }] : []);
    for (const unit of kitUnits) {
      if (!unit.part_instance_id) continue;
      await db.query(
        `UPDATE part_instances SET status = 'with_customer', updated_at = NOW()
          WHERE instance_id = $1 AND status IN ('reserved', 'with_customer')`,
        [unit.part_instance_id]
      );
      await recordMovement(db, {
        type: MOVEMENT.RESERVED,
        partId: unit.part_id || row.part_id,
        instanceId: unit.part_instance_id,
        prtId: unit.prt_id,
        serialNumber: unit.serial_number,
        category: 'power',
        partName: unit.part_name,
        ticketId: row.ticket_id,
        ttsplId: row.ttspl_id,
        notes: `Dispatched with laptop on ${dcNumber}`,
        actorUserId: user?.user_id,
        actorName: actorName(user),
      });
    }
  }
  return r.rows.length;
}

async function restockReturnedForPickup(db, pickupItem, user) {
  const row = await chargerForPickup(db, pickupItem);
  if (!row || !chargerWasSent(row) && row.status !== 'dispatched') return null;
  if (!['attached', 'dispatched'].includes(row.status)) return null;
  const scanned = await db.query(
    `SELECT 1 FROM dispatch_charger_return_scans
      WHERE request_id = $1 AND matched = true
      LIMIT 1`,
    [row.request_id]
  );
  // Courier / porter: no tech scan; restock when warehouse receives.
  const courier = !isTechnicianPickup(pickupItem);
  if (!courier && !scanned.rows[0]) return null;

  await db.query(
    `UPDATE dispatch_charger_requests
        SET status = 'returned', returned_at = NOW(), updated_at = NOW()
      WHERE request_id = $1`,
    [row.request_id]
  );
  const kitUnits = row.units?.length
    ? row.units
    : (row.part_instance_id ? [{
      part_id: row.part_id,
      part_instance_id: row.part_instance_id,
      prt_id: row.prt_id,
      serial_number: row.charger_serial,
      part_name: row.charger_part_name,
    }] : []);
  for (const unit of kitUnits) {
    if (!unit.part_instance_id) continue;
    await db.query(
      `UPDATE part_instances SET status = 'in_stock', updated_at = NOW()
        WHERE instance_id = $1 AND status IN ('reserved', 'with_customer')`,
      [unit.part_instance_id]
    );
    await recordMovement(db, {
      type: MOVEMENT.RETURNED_GOOD,
      partId: unit.part_id || row.part_id,
      instanceId: unit.part_instance_id,
      prtId: unit.prt_id,
      serialNumber: unit.serial_number,
      category: 'power',
      partName: unit.part_name,
      ticketId: row.ticket_id,
      ttsplId: row.ttspl_id,
      notes: `Returned with laptop ${pickupItem.return_dc_number || ''}`.trim(),
      actorUserId: user?.user_id,
      actorName: actorName(user),
    });
  }
  await auditCharger(db, row, user, 'dispatch_charger_returned',
    `Charger ${row.prt_id || row.charger_asset_code} returned with laptop`,
    { request_number: row.request_number, return_dc_number: pickupItem.return_dc_number });
  return row;
}

async function attachChargersToLaptops(db, laptops) {
  if (!Array.isArray(laptops) || !laptops.length) return laptops;
  const codes = [...new Set(laptops.flatMap((l) => [l.ttspl, l.serial_number].filter(Boolean)))];
  if (!codes.length) return laptops;
  const r = await db.query(
    `SELECT ttspl_id, prt_id, charger_asset_code, charger_serial, charger_part_name,
            disposition, status, extra
       FROM dispatch_charger_requests
      WHERE status IN ('attached', 'dispatched')
        AND disposition = 'attach'
        AND UPPER(COALESCE(ttspl_id, '')) = ANY($1::text[])`,
    [codes.map((c) => String(c).toUpperCase())]
  );
  const byTtspl = new Map(r.rows.map((row) => [String(row.ttspl_id || '').toUpperCase(), row]));
  return laptops.map((laptop) => {
    const hit = byTtspl.get(String(laptop.ttspl || '').toUpperCase());
    if (!hit) return laptop;
    const extra = hit.extra && typeof hit.extra === 'object' ? hit.extra : {};
    return {
      ...laptop,
      charger: {
        prt_id: hit.prt_id,
        asset_code: hit.charger_asset_code,
        serial: hit.charger_serial,
        part_name: hit.charger_part_name,
        cable_prt_id: extra.cable_prt_id || null,
        cable_part_name: extra.cable_part_name || null,
        status: hit.status,
      },
    };
  });
}

module.exports = {
  normalizeCode,
  normalizeTtspl,
  chargerMatchesScan,
  ttsplMatchesScan,
  publicRequest,
  canStartDispatchQc,
  chargerWasSent,
  loadTicketContext,
  getActiveByTicket,
  getById,
  findActiveByTtspl,
  markAlreadyWithCustomer,
  raiseAttachRequest,
  cancelRequest,
  cancelRequestsForTicket,
  releaseStaleRequestsForTtspl,
  undoHandover,
  lookupChargerUnit,
  listAvailableChargers,
  listWarehouseQueue,
  approveAndHandover,
  attachCharger,
  recordQcScan,
  assertReadyForDispatchQc,
  getPickupChargerState,
  getReturnDcChargerState,
  recordReturnScan,
  recordReturnScanForRdc,
  markDispatchedForDc,
  restockReturnedForPickup,
  attachChargersToLaptops,
};
