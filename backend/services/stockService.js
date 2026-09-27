/**
 * Stock in the new UI (claude/carret-stock.md): the laptop list, ready stock
 * (tag + carret slot), laptop scrap requests and the "not earning" list.
 *
 * Laptops only: a laptop row has po_id and no spo_id (spare parts share
 * vendor_serial_numbers). Every status change goes through the state machine.
 */
const pool = require('../config/db');
const { transitionAsset } = require('./inventoryStateMachine');
const { logTtsplEvent } = require('./ttsplAuditService');
const {
  assertSlotAvailable, vacateWarehouseLocation, formatLocation, CARRET_MIN, CARRET_MAX, SLOTS_PER_CARRET,
} = require('./warehouseLocationService');
const { invalidateInventoryListCachesFireAndForget } = require('./inventoryListCache');

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, statusCode: status, ...extra });

const TAGS = { rental: 'Rent', sale: 'Sell', both: 'Rent or sell' };
const IS_LAPTOP = 'v.deleted_at IS NULL AND v.po_id IS NOT NULL AND v.spo_id IS NULL';
const TAG_SQL = `CASE LOWER(COALESCE(v.extra->>'inventory_tag', '')) WHEN 'sales' THEN 'sale' WHEN '' THEN NULL ELSE LOWER(v.extra->>'inventory_tag') END`;
const QC_SQL = `LOWER(COALESCE(v.qc_status, v.extra->>'status', ''))`;
/** Ready = QC-passed and attachable (ST-D3). */
const READY_SQL = `(${QC_SQL} = 'passed' AND EXISTS (SELECT 1 FROM asset_available aa WHERE aa.serial_id = v.serial_id))`;
/** Statuses a scrap request may start from (the state machine allows each → scrapped). */
const SCRAPPABLE = ['in_stock', 'in_repair', 'returned', 'qc_failed'];

const ASSET_COLUMNS = `
  v.serial_id, v.serial_number, COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id') AS ttspl_id,
  v.inventory_status, ${QC_SQL} AS qc_status, ${TAG_SQL} AS tag,
  v.warehouse_carret, v.warehouse_carret_slot,
  NULLIF(TRIM(CASE
    WHEN LOWER(COALESCE(v.extra->>'model', v.extra->>'model_name', '')) LIKE LOWER(COALESCE(v.extra->>'brand', '')) || ' %'
      THEN COALESCE(v.extra->>'model', v.extra->>'model_name', '')
    ELSE CONCAT(COALESCE(v.extra->>'brand', ''), ' ', COALESCE(v.extra->>'model', v.extra->>'model_name', '')) END), '') AS model_name,
  v.extra->>'processor' AS processor, v.extra->>'generation' AS generation, v.extra->>'ram' AS ram,
  COALESCE(v.extra->>'storage', v.extra->>'ssd') AS storage,
  v.current_customer_id, COALESCE(c.company_name, c.name) AS customer_name, v.current_entity,
  v.current_dc_number, v.rent_monthly_rate, v.rent_start_date, v.rent_billed_until,
  v.lock_in_end_date, v.warranty_end_date, v.status_changed_at, v.updated_at,
  p.purchase_order_number, p.purchase_order_type, vd.business_name AS vendor_name,
  ${READY_SQL} AS is_ready`;
const ASSET_FROM = `
  FROM vendor_serial_numbers v
  LEFT JOIN customers c ON c.customer_id = v.current_customer_id
  LEFT JOIN vendor_purchase_orders p ON p.po_id = v.po_id
  LEFT JOIN vendors vd ON vd.vendor_id = p.vendor_id`;

/** Statuses in which the laptop's rate is what it earns now. */
const EARNING_STATUSES = new Set(['rented', 'on_demo', 'in_transit', 'dispatch_ready', 'reserved']);

function shapeAsset(r) {
  const rate = r.rent_monthly_rate != null ? Number(r.rent_monthly_rate) : null;
  return {
    ...r,
    tag_label: r.tag ? (TAGS[r.tag] || r.tag) : null,
    location: r.warehouse_carret ? formatLocation(r.warehouse_carret, r.warehouse_carret_slot) : null,
    // The state machine keeps the last customer's rate on a laptop that comes
    // back (so a repaired unit returns at the same rate). It is NOT what an
    // in-stock / returned / scrapped laptop earns, so only show it while the
    // laptop is with (or on its way to) a customer.
    rent_monthly_rate: EARNING_STATUSES.has(r.inventory_status) ? rate : null,
    last_rent_monthly_rate: rate,
  };
}

/* ------------------------------------------------------------------ list */

const STATUS_FILTERS = new Set([
  'in_stock', 'reserved', 'dispatch_ready', 'in_transit', 'rented', 'on_demo', 'sold', 'returned',
  'in_repair', 'qc_failed', 'scrapped', 'returned_to_vendor', 'at_gate',
]);

async function listAssets({ search = '', status = '', view = '', tag = '', page = 1, limit = 50 } = {}) {
  const params = [];
  const where = [IS_LAPTOP];
  const q = String(search || '').trim();
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where.push(`(v.serial_number ILIKE $${i} OR COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id', '') ILIKE $${i}
      OR COALESCE(p.purchase_order_number, '') ILIKE $${i} OR COALESCE(c.company_name, c.name, '') ILIKE $${i}
      OR (COALESCE(v.extra->>'brand', '') || ' ' || COALESCE(v.extra->>'model', v.extra->>'model_name', '')) ILIKE $${i})`);
  }
  if (status && STATUS_FILTERS.has(status)) { params.push(status); where.push(`v.inventory_status = $${params.length}`); }
  if (view === 'ready') where.push(READY_SQL);
  if (view === 'with_customer') where.push(`v.inventory_status IN ('rented','on_demo','sold')`);
  if (view === 'on_floor') where.push(`v.inventory_status IN ('in_repair','returned','qc_failed','at_gate') OR (v.inventory_status = 'in_stock' AND NOT ${READY_SQL})`);
  if (tag === 'none') where.push(`${TAG_SQL} IS NULL`);
  else if (TAGS[tag]) { params.push(tag); where.push(`${TAG_SQL} = $${params.length}`); }

  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const whereSql = where.map((w) => `(${w})`).join(' AND ');
  const total = (await pool.query(`SELECT COUNT(*)::int AS n ${ASSET_FROM} WHERE ${whereSql}`, params)).rows[0].n;
  const { rows } = await pool.query(
    `SELECT ${ASSET_COLUMNS} ${ASSET_FROM} WHERE ${whereSql}
      ORDER BY v.status_changed_at DESC NULLS LAST, v.serial_id DESC
      LIMIT ${lim} OFFSET ${(pg - 1) * lim}`,
    params
  );
  return { data: rows.map(shapeAsset), total, page: pg, limit: lim };
}

async function assetCounts() {
  const { rows } = await pool.query(
    `SELECT v.inventory_status AS status, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE ${READY_SQL})::int AS ready
       ${ASSET_FROM} WHERE ${IS_LAPTOP} GROUP BY 1`
  );
  const by = Object.fromEntries(rows.map((r) => [r.status || 'none', r.n]));
  const ready = rows.reduce((s, r) => s + r.ready, 0);
  return {
    by_status: by,
    ready,
    with_customer: (by.rented || 0) + (by.on_demo || 0) + (by.sold || 0),
    total: rows.reduce((s, r) => s + r.n, 0),
  };
}

async function getAsset(idOrCode) {
  const key = String(idOrCode || '').trim();
  const { rows } = await pool.query(
    `SELECT ${ASSET_COLUMNS},
            (SELECT json_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'created_at', r.created_at)
               FROM laptop_scrap_requests r WHERE r.serial_id = v.serial_id ORDER BY r.id DESC LIMIT 1) AS scrap_request,
            v.scrap_challan_number
       ${ASSET_FROM}
      WHERE ${IS_LAPTOP}
        AND (v.serial_id::text = $1 OR UPPER(COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id', '')) = UPPER($1) OR UPPER(v.serial_number) = UPPER($1))
      LIMIT 1`,
    [key]
  );
  return rows[0] ? shapeAsset(rows[0]) : null;
}

/* ----------------------------------------------------------- ready stock */

async function readyStock() {
  const { rows } = await pool.query(
    `SELECT ${ASSET_COLUMNS} ${ASSET_FROM} WHERE ${IS_LAPTOP} AND ${READY_SQL}
      ORDER BY v.warehouse_carret NULLS FIRST, v.warehouse_carret_slot, v.serial_id`
  );
  const data = rows.map(shapeAsset);
  return {
    data,
    summary: {
      total: data.length,
      rental: data.filter((r) => r.tag === 'rental').length,
      sale: data.filter((r) => r.tag === 'sale').length,
      both: data.filter((r) => r.tag === 'both').length,
      untagged: data.filter((r) => !r.tag).length,
      no_slot: data.filter((r) => !r.warehouse_carret).length,
    },
  };
}

async function loadLaptopsForUpdate(client, serialIds) {
  const ids = [...new Set((serialIds || []).map(Number).filter((n) => n > 0))];
  if (!ids.length) throw fail('Choose the laptops');
  if (ids.length > 200) throw fail('At most 200 laptops at a time');
  const { rows } = await client.query(
    `SELECT v.serial_id, v.serial_number, v.inventory_status, v.extra, v.warehouse_carret, v.warehouse_carret_slot,
            COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id', v.serial_number) AS ttspl_id,
            ${TAG_SQL} AS tag, ${READY_SQL} AS is_ready
       FROM vendor_serial_numbers v
      WHERE v.serial_id = ANY($1::int[]) AND ${IS_LAPTOP}
      FOR UPDATE OF v`,
    [ids]
  );
  if (rows.length !== ids.length) throw fail('One or more laptops were not found', 404);
  return rows;
}

/** Re-tag ready laptops: Rent / Sell / Both, with a reason (ST-D3). */
async function retag(client, { serialIds, tag, reason, user }) {
  if (!TAGS[tag]) throw fail('Choose Rent, Sell or Both');
  const why = String(reason || '').trim();
  if (why.length < 3) throw fail('Give a reason for the change');
  const rows = await loadLaptopsForUpdate(client, serialIds);
  const notReady = rows.filter((r) => !r.is_ready);
  if (notReady.length) throw fail(`Only ready (QC-passed, in stock) laptops are tagged: ${notReady.map((r) => r.ttspl_id).join(', ')}`, 409);
  let changed = 0;
  for (const r of rows) {
    if (r.tag === tag) continue;
    await client.query(
      `UPDATE vendor_serial_numbers
          SET extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('inventory_tag', $2::text, 'inventory_tag_at', NOW(), 'inventory_tag_by', $3::int),
              updated_at = NOW()
        WHERE serial_id = $1`,
      [r.serial_id, tag, user?.user_id || null]
    );
    await logTtsplEvent({
      ttsplId: r.ttspl_id, vendorSerialId: r.serial_id, eventType: 'inventory_tagged',
      description: `Tagged ${TAGS[tag]}${r.tag ? ` (was ${TAGS[r.tag] || r.tag})` : ''} — ${why}`,
      metadata: { from: r.tag, to: tag, reason: why }, actorUserId: user?.user_id || null, db: client,
    });
    changed += 1;
  }
  invalidateInventoryListCachesFireAndForget();
  return { changed, unchanged: rows.length - changed };
}

/** Put a ready laptop in a carret slot, or take it out of one (carret = null). */
async function setLocation(client, { serialId, carret, slot, reason, user }) {
  const why = String(reason || '').trim();
  if (why.length < 3) throw fail('Give a reason for the move');
  const [r] = await loadLaptopsForUpdate(client, [serialId]);
  if (!r.is_ready) throw fail(`${r.ttspl_id} is not ready stock (QC-passed, in stock) — only ready laptops sit in carret slots`, 409);
  const from = r.warehouse_carret ? formatLocation(r.warehouse_carret, r.warehouse_carret_slot) : null;
  let to = null;
  if (carret === null || carret === '' || carret === undefined) {
    await vacateWarehouseLocation(client, r.serial_id);
  } else {
    const c = Number(carret);
    const s = Number(slot);
    await assertSlotAvailable(client, c, s, r.serial_id);
    try {
      await client.query('SAVEPOINT set_slot');
      await client.query(
        `UPDATE vendor_serial_numbers SET warehouse_carret = $2, warehouse_carret_slot = $3, updated_at = NOW() WHERE serial_id = $1`,
        [r.serial_id, c, s]
      );
      await client.query('RELEASE SAVEPOINT set_slot');
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT set_slot').catch(() => {});
      if (e.code === '23505') throw fail(`Carret ${c} slot ${s} was just taken — choose another`, 409);
      throw e;
    }
    to = formatLocation(c, s);
  }
  await logTtsplEvent({
    ttsplId: r.ttspl_id, vendorSerialId: r.serial_id, eventType: 'warehouse_location_changed',
    description: `${from || 'No slot'} → ${to || 'no slot'} — ${why}`,
    metadata: { from, to, reason: why }, actorUserId: user?.user_id || null, db: client,
  });
  invalidateInventoryListCachesFireAndForget();
  return { serial_id: r.serial_id, ttspl_id: r.ttspl_id, from, to };
}

/* ----------------------------------------------------------------- scrap */

async function requestScrap(client, { serialId, reason, user }) {
  const why = String(reason || '').trim();
  if (why.length < 5) throw fail('Say why this laptop cannot be repaired or used');
  const [r] = await loadLaptopsForUpdate(client, [serialId]);
  if (!SCRAPPABLE.includes(r.inventory_status)) {
    throw fail(`${r.ttspl_id} is ${String(r.inventory_status).replace(/_/g, ' ')} — only a laptop in stock, in repair, returned or QC-failed can be scrapped`, 409);
  }
  const open = (await client.query(`SELECT id FROM laptop_scrap_requests WHERE serial_id = $1 AND status = 'pending'`, [r.serial_id])).rows[0];
  if (open) throw fail(`${r.ttspl_id} already has a scrap request waiting (#${open.id})`, 409);
  const { rows } = await client.query(
    `INSERT INTO laptop_scrap_requests (serial_id, asset_code, from_status, reason, requested_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [r.serial_id, r.ttspl_id, r.inventory_status, why, user?.user_id || null]
  );
  await logTtsplEvent({
    ttsplId: r.ttspl_id, vendorSerialId: r.serial_id, eventType: 'scrap_requested',
    description: `Scrap requested — ${why}`, metadata: { request_id: rows[0].id }, actorUserId: user?.user_id || null, db: client,
  });
  return rows[0];
}

async function decideScrap(client, id, { approve, note, user }) {
  const req = (await client.query('SELECT * FROM laptop_scrap_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!req) throw fail('Scrap request not found', 404);
  if (req.status !== 'pending') throw fail(`This request is ${req.status}`, 409);
  if (req.requested_by && user?.user_id && Number(req.requested_by) === Number(user.user_id) && user.role !== 'super_admin') {
    throw fail('Someone other than the person who asked must approve a scrap', 403);
  }
  const why = String(note || '').trim();
  if (!approve && why.length < 3) throw fail('Say why it is rejected');
  if (approve) {
    const [r] = await loadLaptopsForUpdate(client, [req.serial_id]);
    if (!SCRAPPABLE.includes(r.inventory_status)) {
      throw fail(`${r.ttspl_id} is now ${String(r.inventory_status).replace(/_/g, ' ')} — it can no longer be scrapped`, 409);
    }
    await transitionAsset(client, {
      serialId: r.serial_id,
      toStatus: 'scrapped',
      reason: `Scrap approved (request #${id}) — ${req.reason}${why ? ` · ${why}` : ''}`,
      actorUserId: user?.user_id || null,
      actorName: user?.name || null,
      caller: 'stockService.decideScrap',
    });
    await client.query(
      `UPDATE vendor_serial_numbers SET qc_status = 'dead',
              extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('dead_marked_at', NOW(), 'scrap_request_id', $2::int),
              updated_at = NOW()
        WHERE serial_id = $1`,
      [r.serial_id, id]
    );
    // A scrapped laptop is off the floor.
    await client.query(
      `UPDATE tickets SET status = 'cancelled', updated_at = NOW()
        WHERE vendor_serial_id = $1 AND status IN ('in_progress', 'on_hold', 'diagnosis_failed', 'out_for_repair')`,
      [r.serial_id]
    );
  }
  const { rows } = await client.query(
    `UPDATE laptop_scrap_requests
        SET status = $2, decided_by = $3, decided_at = NOW(), decision_note = $4, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, approve ? 'approved' : 'rejected', user?.user_id || null, why || null]
  );
  invalidateInventoryListCachesFireAndForget();
  return rows[0];
}

async function cancelScrapRequest(client, id, { user }) {
  const req = (await client.query('SELECT * FROM laptop_scrap_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!req) throw fail('Scrap request not found', 404);
  if (req.status !== 'pending') throw fail(`This request is ${req.status}`, 409);
  const { rows } = await client.query(
    `UPDATE laptop_scrap_requests SET status = 'cancelled', decided_by = $2, decided_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, user?.user_id || null]
  );
  return rows[0];
}

async function listScrapRequests({ status = 'pending' } = {}) {
  const params = [];
  let where = '';
  if (status && status !== 'all') { params.push(status); where = 'WHERE r.status = $1'; }
  const { rows } = await pool.query(
    `SELECT r.*, ru.name AS requested_by_name, du.name AS decided_by_name,
            v.inventory_status, v.scrap_challan_number,
            NULLIF(TRIM(CONCAT(COALESCE(v.extra->>'brand', ''), ' ', COALESCE(v.extra->>'model', v.extra->>'model_name', ''))), '') AS model_name
       FROM laptop_scrap_requests r
       JOIN vendor_serial_numbers v ON v.serial_id = r.serial_id
       LEFT JOIN users ru ON ru.user_id = r.requested_by
       LEFT JOIN users du ON du.user_id = r.decided_by
       ${where}
      ORDER BY r.created_at DESC LIMIT 300`,
    params
  );
  return rows;
}

/** Scrapped laptops not yet handed to a buyer on a scrap challan. */
async function scrappedAwaitingChallan() {
  const { rows } = await pool.query(
    `SELECT v.serial_id, v.serial_number, COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id') AS ttspl_id,
            NULLIF(TRIM(CONCAT(COALESCE(v.extra->>'brand', ''), ' ', COALESCE(v.extra->>'model', v.extra->>'model_name', ''))), '') AS model_name,
            v.status_changed_at,
            (SELECT r.reason FROM laptop_scrap_requests r WHERE r.serial_id = v.serial_id AND r.status = 'approved' ORDER BY r.id DESC LIMIT 1) AS reason
       FROM vendor_serial_numbers v
      WHERE ${IS_LAPTOP} AND v.inventory_status = 'scrapped' AND v.scrap_challan_number IS NULL
        AND COALESCE(v.extra->>'scrap_disposed_at', '') = ''
      ORDER BY v.status_changed_at DESC NULLS LAST`
  );
  return rows;
}

/* ----------------------------------------------------------- not earning */

/**
 * ST-D1: laptops not earning rent or sold for more than `days` days. Idle since
 * the last status change; "rented" ones count when nothing can be billed.
 */
async function notEarning({ days = 30 } = {}) {
  const d = Math.max(1, parseInt(days, 10) || 30);
  const { rows } = await pool.query(
    `WITH base AS (
       SELECT v.serial_id, v.serial_number, COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id') AS ttspl_id,
              v.inventory_status, ${QC_SQL} AS qc_status, v.current_customer_id,
              COALESCE(c.company_name, c.name) AS customer_name, v.rent_monthly_rate, v.rent_billed_until, v.rent_start_date,
              COALESCE(v.status_changed_at, v.updated_at, v.created_at) AS since,
              v.warehouse_carret, v.warehouse_carret_slot,
              NULLIF(TRIM(CONCAT(COALESCE(v.extra->>'brand', ''), ' ', COALESCE(v.extra->>'model', v.extra->>'model_name', ''))), '') AS model_name,
              p.purchase_order_number, p.purchase_order_type, vd.business_name AS vendor_name,
              (SELECT vpd.rate FROM vendor_product_details vpd
                WHERE vpd.po_id = v.po_id
                ORDER BY (vpd.product_detail_id = NULLIF(TRIM(v.extra->>'product_detail_id'), '')::int) DESC NULLS LAST,
                         (LOWER(COALESCE(vpd.brand, '')) = LOWER(COALESCE(v.extra->>'brand', ''))) DESC
                LIMIT 1) AS vendor_rate,
              EXISTS (SELECT 1 FROM vendor_repair_dc_items vri
                        JOIN vendor_repair_delivery_challans vr ON vr.dc_number = vri.dc_number
                       WHERE vri.serial_id = v.serial_id
                         AND COALESCE(vr.status, '') NOT IN ('cancelled', 'closed', 'received', 'returned')) AS at_vendor
         FROM vendor_serial_numbers v
         LEFT JOIN customers c ON c.customer_id = v.current_customer_id
         LEFT JOIN vendor_purchase_orders p ON p.po_id = v.po_id
         LEFT JOIN vendors vd ON vd.vendor_id = p.vendor_id
        WHERE ${IS_LAPTOP}
          AND v.inventory_status NOT IN ('sold', 'scrapped', 'returned_to_vendor', 'in_transit')
     )
     SELECT * FROM base
      WHERE (inventory_status <> 'rented' AND since < NOW() - ($1 || ' days')::interval)
         OR (inventory_status = 'rented' AND (
              current_customer_id IS NULL
              OR COALESCE(rent_monthly_rate, 0) <= 0
              OR COALESCE(rent_billed_until, rent_start_date) < CURRENT_DATE - ($1 || ' days')::interval))
      ORDER BY since`,
    [String(d)]
  );
  const now = Date.now();
  const data = rows.map((r) => {
    const vendorRental = ['rental_purchase', 'rent_to_own'].includes(String(r.purchase_order_type || '').toLowerCase());
    let reason;
    if (r.inventory_status === 'rented') {
      reason = !r.current_customer_id ? 'Rented but no customer'
        : Number(r.rent_monthly_rate || 0) <= 0 ? 'Rented at no rate'
          : 'Rented but not billed';
    } else if (r.at_vendor) reason = 'At vendor for repair';
    else if (r.inventory_status === 'in_stock') reason = r.qc_status === 'passed' ? 'Ready, not rented' : 'In stock, not QC-passed';
    else if (r.inventory_status === 'on_demo') reason = 'On free demo';
    else reason = { in_repair: 'In repair', returned: 'Returned, waiting for QC', qc_failed: 'Failed QC', reserved: 'Reserved on an order', dispatch_ready: 'Waiting to dispatch', at_gate: 'At the gate' }[r.inventory_status] || r.inventory_status;
    return {
      ...r,
      reason,
      idle_days: Math.floor((now - new Date(r.since).getTime()) / 86400000),
      location: r.warehouse_carret ? formatLocation(r.warehouse_carret, r.warehouse_carret_slot) : null,
      cost_type: vendorRental ? 'vendor_rent' : 'purchase',
      cost: r.vendor_rate != null ? Number(r.vendor_rate) : null,
    };
  });
  const byReason = {};
  for (const r of data) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  return {
    days: d,
    data,
    summary: {
      total: data.length,
      by_reason: byReason,
      vendor_rent_per_month: data.filter((r) => r.cost_type === 'vendor_rent').reduce((s, r) => s + Number(r.cost || 0), 0),
      purchase_value: data.filter((r) => r.cost_type === 'purchase').reduce((s, r) => s + Number(r.cost || 0), 0),
    },
  };
}

module.exports = {
  TAGS,
  SCRAPPABLE,
  CARRET_MIN,
  CARRET_MAX,
  SLOTS_PER_CARRET,
  listAssets,
  assetCounts,
  getAsset,
  readyStock,
  retag,
  setLocation,
  requestScrap,
  decideScrap,
  cancelScrapRequest,
  listScrapRequests,
  scrappedAwaitingChallan,
  notEarning,
};
