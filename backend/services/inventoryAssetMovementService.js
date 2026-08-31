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
const { transitionAsset } = require('./inventoryStateMachine');

const MOVEMENT_TARGETS = {
  qc_pending: { qcStatus: 'qc_pending', inventoryStatus: 'in_stock', createTicket: false },
  qc_process: { qcStatus: 'pending', inventoryStatus: 'in_stock', createTicket: true },
  passed: { qcStatus: 'passed', inventoryStatus: 'in_stock', createTicket: false },
  dead: { qcStatus: 'dead', inventoryStatus: 'scrapped', createTicket: false },
  missing: { qcStatus: 'missing', inventoryStatus: 'missing', createTicket: false }
};

/** Deployed / allocated — not movable via this tool. Returned units ARE movable (post-pickup floor/QC). */
const BLOCKED_INVENTORY_STATUSES = new Set([
  'rented',
  'sold',
  'in_transit',
  'dispatch_ready',
  'on_demo',
  'reserved',
]);

/** Legacy ERP qc_status values on returned customer units — treat as QC Process bucket. */
const RETURNED_LEGACY_QC_AS_PROCESS = new Set(['out_stock', 'qc_failed_return_vendor']);

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

function effectiveQcStatus(row) {
  const ex = parseExtra(row.extra);
  return String(row.qc_status || ex.status || 'pending').trim().toLowerCase();
}

/** Map qc_status (+ inventory context) to movement bucket key (for Move From filter). */
function bucketKeyFromQcStatus(qcStatus, inventoryStatus = '') {
  const s = String(qcStatus || '').trim().toLowerCase();
  const inv = String(inventoryStatus || '').trim().toLowerCase();
  if (s === 'qc_pending') return 'qc_pending';
  if (s === 'pending') return 'qc_process';
  if (s === 'passed') return 'passed';
  if (s === 'dead') return 'dead';
  if (s === 'missing') return 'missing';
  if (inv === 'returned' && RETURNED_LEGACY_QC_AS_PROCESS.has(s)) return 'qc_process';
  if (inv === 'returned' && !s) return 'qc_process';
  return null;
}

function qcMatchesBucket(actualQc, inventoryStatus, bucketKey) {
  const expected = qcStatusForBucket(bucketKey);
  if (!expected) return false;
  const qc = String(actualQc || '').trim().toLowerCase();
  if (qc === expected) return true;
  const inv = String(inventoryStatus || '').trim().toLowerCase();
  if (inv === 'returned' && bucketKey === 'qc_process' && RETURNED_LEGACY_QC_AS_PROCESS.has(qc)) {
    return true;
  }
  return false;
}

function qcStatusForBucket(bucketKey) {
  const cfg = MOVEMENT_TARGETS[bucketKey];
  return cfg ? cfg.qcStatus : null;
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

function mapMovementRow(row, { matchedTerm = null } = {}) {
  const ex = parseExtra(row.extra);
  const effectiveQc = effectiveQcStatus(row);
  const inv = String(row.inventory_status || 'in_stock').trim();
  const blocked = BLOCKED_INVENTORY_STATUSES.has(inv);
  const ineligible = !row.po_id || row.spo_id != null;
  // Authoritative laptop code is inventory_asset_code; extra TTSPL is legacy fallback only.
  const ttspl = row.inventory_asset_code
    || (row.po_id && !row.spo_id ? (ex.unique_product_serial || '') : '');
  const isReturnedFloor = inv === 'returned';
  return {
    serial_id: row.serial_id,
    serial_number: row.serial_number,
    unique_product_serial: ttspl,
    purchase_order_number: row.purchase_order_number || '',
    qc_status: effectiveQc,
    bucket: bucketKeyFromQcStatus(effectiveQc, inv) || (isReturnedFloor ? 'qc_process' : null),
    inventory_status: inv,
    remark: row.remark || ex.action_remark || '',
    blocked,
    ineligible,
    is_returned_floor: isReturnedFloor,
    matched_term: matchedTerm,
    block_reason: blocked
      ? `Unit is ${inv.replace(/_/g, ' ')} and cannot be moved`
      : ineligible
        ? (row.spo_id != null ? 'Spare-parts PO serial — not movable here' : 'No purchase order linked')
        : isReturnedFloor
          ? 'Returned from customer — movable to Ready / Dead / QC Pending / Missing'
          : null,
  };
}

function buildSearchMeta(terms, data) {
  const blocked = data.filter((r) => r.blocked);
  const ineligible = data.filter((r) => r.ineligible && !r.blocked);
  const movable = data.filter((r) => !r.blocked && !r.ineligible);
  const matchedKeys = new Set();
  for (const row of data) {
    matchedKeys.add(String(row.serial_number || '').toUpperCase());
    matchedKeys.add(String(row.unique_product_serial || '').toUpperCase());
    if (row.matched_term) matchedKeys.add(String(row.matched_term).toUpperCase());
    const archived = row.archived_serial_number;
    if (archived) matchedKeys.add(String(archived).toUpperCase());
  }
  const notFound = terms.filter((t) => !matchedKeys.has(t.toUpperCase()));
  return {
    terms,
    not_found: notFound,
    movable_count: movable.length,
    blocked_count: blocked.length,
    ineligible_count: ineligible.length,
    blocked: blocked.map((r) => ({
      serial_id: r.serial_id,
      serial_number: r.serial_number,
      unique_product_serial: r.unique_product_serial,
      inventory_status: r.inventory_status,
      block_reason: r.block_reason,
      matched_term: r.matched_term || null,
    })),
    ineligible: ineligible.map((r) => ({
      serial_id: r.serial_id,
      serial_number: r.serial_number,
      unique_product_serial: r.unique_product_serial,
      inventory_status: r.inventory_status,
      block_reason: r.block_reason,
      matched_term: r.matched_term || null,
    })),
  };
}

const SEARCH_SELECT = `
  SELECT s.serial_id,
         s.serial_number,
         s.inventory_asset_code,
         s.qc_status,
         s.inventory_status,
         s.remark,
         s.extra,
         s.po_id,
         s.spo_id,
         COALESCE(s.extra->>'archived_serial_number', '') AS archived_serial_number,
         p.purchase_order_number
    FROM vendor_serial_numbers s
    LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
   WHERE s.deleted_at IS NULL
     AND s.spo_id IS NULL`;

function matchClausesForSingle(likeParam) {
  return `(
    s.serial_number ILIKE ${likeParam}
    OR s.inventory_asset_code ILIKE ${likeParam}
    OR (
      s.po_id IS NOT NULL
      AND COALESCE(s.extra->>'unique_product_serial', '') ILIKE ${likeParam}
    )
    OR COALESCE(s.extra->>'archived_serial_number', '') ILIKE ${likeParam}
  )`;
}

function matchClausesForBulk(termsParam) {
  return `(
    UPPER(s.serial_number) = ANY(${termsParam}::text[])
    OR UPPER(s.inventory_asset_code) = ANY(${termsParam}::text[])
    OR (
      s.po_id IS NOT NULL
      AND UPPER(COALESCE(s.extra->>'unique_product_serial', '')) = ANY(${termsParam}::text[])
    )
    OR UPPER(COALESCE(s.extra->>'archived_serial_number', '')) = ANY(${termsParam}::text[])
  )`;
}

function attachMatchedTerms(rows, terms) {
  const upperTerms = terms.map((t) => t.toUpperCase());
  return rows.map((row) => {
    const keys = [
      String(row.serial_number || '').toUpperCase(),
      String(row.inventory_asset_code || '').toUpperCase(),
      String(parseExtra(row.extra).unique_product_serial || '').toUpperCase(),
      String(row.archived_serial_number || '').toUpperCase(),
    ].filter(Boolean);
    const matchedTerm = upperTerms.find((t) => keys.includes(t)) || null;
    const mapped = mapMovementRow(row, { matchedTerm });
    if (row.archived_serial_number) {
      mapped.archived_serial_number = row.archived_serial_number;
    }
    return mapped;
  });
}

/**
 * Search laptops eligible for asset movement by serial number or TTSPL.
 * Supports comma-separated exact matches for bulk paste.
 */
async function searchLaptopsForMovement(db, { q, limit = 50 }) {
  const terms = parseSearchTerms(q);
  if (!terms.length) {
    return { ok: true, data: [], meta: buildSearchMeta([], []) };
  }

  const maxLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

  if (terms.length === 1 && terms[0].length < 2) {
    return { ok: true, data: [], meta: buildSearchMeta(terms, []) };
  }

  let r;
  if (terms.length === 1) {
    const like = `%${terms[0]}%`;
    r = await db.query(
      `${SEARCH_SELECT}
          AND ${matchClausesForSingle('$1')}
        ORDER BY s.updated_at DESC NULLS LAST, s.serial_id DESC
        LIMIT $2`,
      [like, maxLimit]
    );
    const data = r.rows.map((row) => mapMovementRow(row, { matchedTerm: terms[0] }));
    return { ok: true, data, meta: buildSearchMeta(terms, data) };
  }

  const upperTerms = terms.map((t) => t.toUpperCase());
  r = await db.query(
    `${SEARCH_SELECT}
        AND ${matchClausesForBulk('$1')}
      ORDER BY s.updated_at DESC NULLS LAST, s.serial_id DESC
      LIMIT $2`,
    [upperTerms, Math.max(maxLimit, upperTerms.length)]
  );

  const data = attachMatchedTerms(r.rows, terms);
  return { ok: true, data, meta: buildSearchMeta(terms, data) };
}

async function applyMovementTarget(db, row, targetKey, actorUserId) {
  const cfg = MOVEMENT_TARGETS[targetKey];
  const ex = parseExtra(row.extra);
  const prevQc = String(row.qc_status || ex.status || 'pending').trim();
  const prevInv = String(row.inventory_status || 'in_stock').trim().toLowerCase();

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
  if (prevInv === 'returned') {
    ex.returned_floor_cleared_at = new Date().toISOString();
    ex.returned_floor_cleared_via = 'asset_movement';
  }

  if (prevInv === 'returned' && cfg.inventoryStatus !== prevInv) {
    try {
      await transitionAsset(db, {
        serialId: row.serial_id,
        toStatus: cfg.inventoryStatus,
        reason: `Asset movement to ${targetLabel(targetKey)} (from returned)`,
        actorUserId,
        allowOverride: true,
      });
    } catch (invErr) {
      console.warn(`applyMovementTarget transition skipped serial ${row.serial_id}:`, invErr.message);
    }
    await db.query(
      `UPDATE vendor_serial_numbers
          SET qc_status = $1,
              extra = $2::jsonb,
              updated_at = NOW()
        WHERE serial_id = $3`,
      [cfg.qcStatus, JSON.stringify(ex), row.serial_id]
    );
  } else {
    await db.query(
      `UPDATE vendor_serial_numbers
          SET qc_status = $1,
              inventory_status = $2,
              extra = $3::jsonb,
              updated_at = NOW()
        WHERE serial_id = $4`,
      [cfg.qcStatus, cfg.inventoryStatus, JSON.stringify(ex), row.serial_id]
    );
  }

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
async function bulkMoveAssets(db, { serialIds, target, fromTarget, remark }, actorUserId) {
  const targetKey = normalizeTarget(target);
  if (!targetKey) {
    return { ok: false, status: 400, message: 'Invalid target. Use qc_pending, qc_process, passed, dead, or missing.' };
  }

  const fromKey = normalizeTarget(fromTarget);
  if (!fromKey) {
    return { ok: false, status: 400, message: 'Move From category is required.' };
  }
  if (fromKey === targetKey) {
    return { ok: false, status: 400, message: 'Move From and Move To must be different categories.' };
  }

  const ids = [...new Set((serialIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  if (!ids.length) {
    return { ok: false, status: 400, message: 'Select at least one laptop' };
  }
  if (ids.length > 100) {
    return { ok: false, status: 400, message: 'Maximum 100 laptops per batch' };
  }

  const cur = await db.query(
    `SELECT serial_id, serial_number, inventory_asset_code, qc_status, inventory_status, extra, po_id, spo_id
       FROM vendor_serial_numbers
      WHERE serial_id = ANY($1::int[])
        AND deleted_at IS NULL`,
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
        unique_product_serial: row.inventory_asset_code,
        ok: false,
        message: `Blocked — unit is ${inv.replace(/_/g, ' ')}`
      });
      continue;
    }
    if (!row.po_id || row.spo_id != null) {
      results.push({
        serial_id: row.serial_id,
        serial_number: row.serial_number,
        unique_product_serial: row.inventory_asset_code,
        ok: false,
        message: row.spo_id != null ? 'Spare-parts PO serial — not movable here' : 'No purchase order linked'
      });
      continue;
    }

    const actualQc = effectiveQcStatus(row);
    if (!qcMatchesBucket(actualQc, inv, fromKey)) {
      results.push({
        serial_id: row.serial_id,
        serial_number: row.serial_number,
        ok: false,
        message: `Not in ${targetLabel(fromKey)} — currently ${actualQc.replace(/_/g, ' ')}${inv === 'returned' ? ' (returned)' : ''}`
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
  const fromLabel = targetLabel(fromKey);
  return {
    ok: true,
    message: `Moved ${moved} of ${cur.rows.length} laptop(s) from ${fromLabel} to ${label}.${missing.length ? ` ${missing.length} id(s) not found.` : ''}`,
    data: {
      from: fromKey,
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
  bucketKeyFromQcStatus,
  parseSearchTerms,
  searchLaptopsForMovement,
  bulkMoveAssets,
  updateSerialRemark
};
