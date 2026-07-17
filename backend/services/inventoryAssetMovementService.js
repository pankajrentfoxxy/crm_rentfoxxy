/**
 * Bulk asset movement between inventory buckets (QC Pending, QC Process, Ready, Dead).
 */
const { parseExtra } = require('./qcManagementService');
const {
  createProductionTicketForQcSerial,
  moveQcPendingToQcProcess
} = require('./qcProcessIntakeService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { invalidateInventoryListCachesFireAndForget } = require('./inventoryListCache');

const MOVEMENT_TARGETS = {
  qc_pending: { qcStatus: 'qc_pending', inventoryStatus: 'in_stock', createTicket: false },
  qc_process: { qcStatus: 'pending', inventoryStatus: 'in_stock', createTicket: true },
  passed: { qcStatus: 'passed', inventoryStatus: 'in_stock', createTicket: false },
  dead: { qcStatus: 'dead', inventoryStatus: 'scrapped', createTicket: false },
  missing: { qcStatus: 'missing', inventoryStatus: 'missing', createTicket: false }
};

const BLOCKED_INVENTORY_STATUSES = new Set([
  'rented',
  'sold',
  'in_transit',
  'on_demo',
  'reserved',
  'returned'
]);

function normalizeTarget(input) {
  const key = String(input || '').trim().toLowerCase();
  return MOVEMENT_TARGETS[key] ? key : null;
}

function targetLabel(target) {
  const labels = {
    qc_pending: 'QC Pending',
    qc_process: 'QC Process',
    passed: 'Ready to Rent/Sell',
    dead: 'Dead Laptop',
    missing: 'Missing Laptop'
  };
  return labels[target] || target;
}

/** Split pasted serial/TTSPL lists (comma, newline, semicolon, tab). */
function parseSearchTerms(q) {
  return [...new Set(
    String(q || '')
      .split(/[,;\n\r\t]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  )];
}

function mapMovementRow(row) {
  const ex = parseExtra(row.extra);
  const effectiveQc = String(row.qc_status || ex.status || 'pending').trim();
  const inv = String(row.inventory_status || 'in_stock').trim();
  const blocked = BLOCKED_INVENTORY_STATUSES.has(inv);
  return {
    serial_id: row.serial_id,
    serial_number: row.serial_number,
    unique_product_serial: row.inventory_asset_code || ex.unique_product_serial || '',
    purchase_order_number: row.purchase_order_number || '',
    qc_status: effectiveQc,
    inventory_status: inv,
    remark: row.remark || ex.action_remark || '',
    blocked,
    block_reason: blocked ? `Unit is ${inv.replace(/_/g, ' ')} and cannot be moved` : null
  };
}

/**
 * Search laptops eligible for asset movement by serial number or TTSPL.
 * Supports comma-separated exact matches for bulk paste.
 */
async function searchLaptopsForMovement(db, { q, limit = 50 }) {
  const terms = parseSearchTerms(q);
  if (!terms.length) {
    return { ok: true, data: [], meta: { terms: [], not_found: [] } };
  }

  const maxLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

  if (terms.length === 1 && terms[0].length < 2) {
    return { ok: true, data: [], meta: { terms, not_found: terms } };
  }

  let r;
  if (terms.length === 1) {
    const like = `%${terms[0]}%`;
    r = await db.query(
      `SELECT s.serial_id,
              s.serial_number,
              s.inventory_asset_code,
              s.qc_status,
              s.inventory_status,
              s.remark,
              s.extra,
              p.purchase_order_number
         FROM vendor_serial_numbers s
         LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
        WHERE s.deleted_at IS NULL
          AND s.po_id IS NOT NULL
          AND s.spo_id IS NULL
          AND (
            s.serial_number ILIKE $1
            OR s.inventory_asset_code ILIKE $1
            OR COALESCE(s.extra->>'unique_product_serial', '') ILIKE $1
          )
        ORDER BY s.updated_at DESC NULLS LAST, s.serial_id DESC
        LIMIT $2`,
      [like, maxLimit]
    );
    const data = r.rows.map(mapMovementRow);
    return { ok: true, data, meta: { terms, not_found: [] } };
  }

  const upperTerms = terms.map((t) => t.toUpperCase());
  r = await db.query(
    `SELECT s.serial_id,
            s.serial_number,
            s.inventory_asset_code,
            s.qc_status,
            s.inventory_status,
            s.remark,
            s.extra,
            p.purchase_order_number
       FROM vendor_serial_numbers s
       LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
      WHERE s.deleted_at IS NULL
        AND s.po_id IS NOT NULL
        AND s.spo_id IS NULL
        AND (
          UPPER(s.serial_number) = ANY($1::text[])
          OR UPPER(s.inventory_asset_code) = ANY($1::text[])
          OR UPPER(COALESCE(s.extra->>'unique_product_serial', '')) = ANY($1::text[])
        )
      ORDER BY s.updated_at DESC NULLS LAST, s.serial_id DESC
      LIMIT $2`,
    [upperTerms, Math.max(maxLimit, upperTerms.length)]
  );

  const data = r.rows.map(mapMovementRow);
  const matchedKeys = new Set();
  for (const row of data) {
    matchedKeys.add(String(row.serial_number || '').toUpperCase());
    matchedKeys.add(String(row.unique_product_serial || '').toUpperCase());
  }
  const notFound = terms.filter((t) => !matchedKeys.has(t.toUpperCase()));

  return { ok: true, data, meta: { terms, not_found: notFound } };
}

async function applyMovementTarget(db, row, targetKey, actorUserId) {
  const cfg = MOVEMENT_TARGETS[targetKey];
  const ex = parseExtra(row.extra);
  const prevQc = String(row.qc_status || ex.status || 'pending').trim();

  if (targetKey === 'qc_process' && prevQc === 'qc_pending') {
    const result = await moveQcPendingToQcProcess(
      db,
      { serialId: row.serial_id, serialNumber: row.serial_number },
      actorUserId
    );
    return {
      ok: result.ok,
      status: result.status,
      message: result.message,
      ticket_id: result.data?.ticket_id || result.data?.ticket?.ticket_id || null,
      qc_status: 'pending'
    };
  }

  ex.status = cfg.qcStatus;
  ex.action_status = cfg.qcStatus;
  ex.asset_movement_at = new Date().toISOString();
  ex.asset_movement_by = actorUserId;
  if (targetKey === 'qc_process') {
    ex.came_from = ex.came_from || 'Asset movement to QC Process';
  }
  if (targetKey === 'dead') {
    ex.dead_marked_at = new Date().toISOString();
  }
  if (targetKey === 'missing') {
    ex.missing_marked_at = new Date().toISOString();
  }
  if (targetKey === 'passed') {
    ex.passed_via = ex.passed_via || 'asset_movement';
  }

  await db.query(
    `UPDATE vendor_serial_numbers
        SET qc_status = $1,
            inventory_status = $2,
            extra = $3::jsonb,
            updated_at = NOW()
      WHERE serial_id = $4`,
    [cfg.qcStatus, cfg.inventoryStatus, JSON.stringify(ex), row.serial_id]
  );

  let ticketId = null;
  if (cfg.createTicket) {
    const ticketResult = await createProductionTicketForQcSerial(
      db,
      { serialId: row.serial_id, serialNumber: row.serial_number },
      actorUserId
    );
    if (ticketResult.ok) {
      ticketId = ticketResult.data?.ticket_id || null;
    } else if (ticketResult.status !== 409) {
      return {
        ok: false,
        status: ticketResult.status || 500,
        message: ticketResult.message || 'Failed to create Production ticket'
      };
    } else {
      ticketId = ticketResult.data?.ticket_id || null;
    }
  }

  const ttsplId = row.inventory_asset_code || row.serial_number;
  if (ttsplId) {
    await logTtsplEvent({
      ttsplId,
      vendorSerialId: row.serial_id,
      eventType: 'asset_movement',
      description: `Moved to ${targetLabel(targetKey)}`,
      metadata: { target: targetKey, from_qc_status: prevQc, ticket_id: ticketId },
      actorUserId
    });
  }

  return {
    ok: true,
    qc_status: cfg.qcStatus,
    ticket_id: ticketId
  };
}

/**
 * Move multiple serials to a target bucket.
 */
async function bulkMoveAssets(db, { serialIds, target, remark }, actorUserId) {
  const targetKey = normalizeTarget(target);
  if (!targetKey) {
    return { ok: false, status: 400, message: 'Invalid target. Use qc_pending, qc_process, passed, dead, or missing.' };
  }

  const ids = [...new Set((serialIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  if (!ids.length) {
    return { ok: false, status: 400, message: 'Select at least one laptop' };
  }
  if (ids.length > 100) {
    return { ok: false, status: 400, message: 'Maximum 100 laptops per batch' };
  }

  const cur = await db.query(
    `SELECT serial_id, serial_number, inventory_asset_code, qc_status, inventory_status, extra, po_id
       FROM vendor_serial_numbers
      WHERE serial_id = ANY($1::int[])
        AND deleted_at IS NULL
        AND po_id IS NOT NULL`,
    [ids]
  );

  if (!cur.rows.length) {
    return { ok: false, status: 404, message: 'No matching laptops found' };
  }

  const foundIds = new Set(cur.rows.map((r) => r.serial_id));
  const missing = ids.filter((id) => !foundIds.has(id));

  const results = [];
  let moved = 0;

  for (const row of cur.rows) {
    const inv = String(row.inventory_status || 'in_stock').trim();
    if (BLOCKED_INVENTORY_STATUSES.has(inv)) {
      results.push({
        serial_id: row.serial_id,
        serial_number: row.serial_number,
        ok: false,
        message: `Blocked — unit is ${inv.replace(/_/g, ' ')}`
      });
      continue;
    }

    if (remark != null && String(remark).trim()) {
      await db.query(
        `UPDATE vendor_serial_numbers SET remark = $1, updated_at = NOW() WHERE serial_id = $2`,
        [String(remark).trim(), row.serial_id]
      );
    }

    try {
      const applied = await applyMovementTarget(db, row, targetKey, actorUserId);
      if (!applied.ok) {
        results.push({
          serial_id: row.serial_id,
          serial_number: row.serial_number,
          ok: false,
          message: applied.message || 'Move failed'
        });
        continue;
      }
      moved += 1;
      results.push({
        serial_id: row.serial_id,
        serial_number: row.serial_number,
        unique_product_serial: row.inventory_asset_code,
        ok: true,
        qc_status: applied.qc_status,
        ticket_id: applied.ticket_id || null
      });
    } catch (e) {
      results.push({
        serial_id: row.serial_id,
        serial_number: row.serial_number,
        ok: false,
        message: e.message || 'Move failed'
      });
    }
  }

  invalidateInventoryListCachesFireAndForget();

  const label = targetLabel(targetKey);
  return {
    ok: true,
    message: `Moved ${moved} of ${cur.rows.length} laptop(s) to ${label}.${missing.length ? ` ${missing.length} id(s) not found.` : ''}`,
    data: {
      target: targetKey,
      moved,
      total_requested: ids.length,
      results
    }
  };
}

/**
 * Update remark on a single serial (QC Pending / QC Process / Dead lists).
 */
async function updateSerialRemark(db, { serialId, remark }, actorUserId) {
  const id = Number(serialId);
  if (!id) {
    return { ok: false, status: 400, message: 'Invalid serial id' };
  }

  const cur = await db.query(
    `SELECT serial_id, serial_number, inventory_asset_code, qc_status, extra, po_id
       FROM vendor_serial_numbers
      WHERE serial_id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!cur.rows.length) {
    return { ok: false, status: 404, message: 'Serial not found' };
  }
  const row = cur.rows[0];
  if (!row.po_id) {
    return { ok: false, status: 400, message: 'Only PO laptop serials support remarks here' };
  }

  const text = remark != null ? String(remark).trim() : '';
  const ex = parseExtra(row.extra);
  ex.action_remark = text;

  await db.query(
    `UPDATE vendor_serial_numbers
        SET remark = $1,
            extra = $2::jsonb,
            updated_at = NOW()
      WHERE serial_id = $3`,
    [text, JSON.stringify(ex), id]
  );

  const ttsplId = row.inventory_asset_code || row.serial_number;
  if (ttsplId) {
    await logTtsplEvent({
      ttsplId,
      vendorSerialId: id,
      eventType: 'remark_update',
      description: text ? 'Inventory remark updated' : 'Inventory remark cleared',
      metadata: { remark: text || null },
      actorUserId
    });
  }

  invalidateInventoryListCachesFireAndForget();

  return {
    ok: true,
    message: 'Remark updated',
    data: { serial_id: id, remark: text }
  };
}

module.exports = {
  MOVEMENT_TARGETS,
  normalizeTarget,
  targetLabel,
  parseSearchTerms,
  searchLaptopsForMovement,
  bulkMoveAssets,
  updateSerialRemark
};
