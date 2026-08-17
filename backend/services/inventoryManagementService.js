/**
 * Inventory Management — Laravel InventoryManagementController parity on vendor_serial_numbers.
 */
const {
  EFFECTIVE_STATUS_SQL,
  parseExtra,
  parseLineItems,
  enrichSerialRow,
  enrichSerialRowsBatch
} = require('./qcManagementService');

const LIST_SEGMENT_MAP = {
  passed: { mode: 'status', status: 'passed' },
  // Staging bucket — not yet in QC Process (no floor ticket until moved).
  qc_pending: { mode: 'status', status: 'qc_pending' },
  // ERP "QC Processing List" (/admin/qc/orders/qc-orders/pending) — status = 'pending' only.
  // Other non-passed statuses (failed, out_for_repare, dead, …) have their own inventory tabs.
  qc_process: { mode: 'status', status: 'pending' },
  dead_laptops: { mode: 'status', status: 'dead' },
  missing_laptops: { mode: 'status', status: 'missing' },
  rent_to_own: { mode: 'po_passed', poType: 'rent_to_own' },
  rental_purchase: { mode: 'po_passed', poType: 'rental_purchase' },
  direct_purchase: { mode: 'po_passed', poType: 'direct_purchase' },
  out_for_repare: { mode: 'status', status: 'out_for_repare' },
  out_for_return: { mode: 'status', status: 'out_for_return' },
  failed: { mode: 'status', status: 'failed' },
  replace: { mode: 'status2', status2: 'replace' },
  spare_parts: { mode: 'spare_parts' }
};

const ROUTE_TO_SEGMENT = {
  'ready-to-rent-or-sell': 'passed',
  'qc-pending': 'qc_pending',
  'qc-process': 'qc_process',
  'dead-laptops': 'dead_laptops',
  'missing-laptops': 'missing_laptops',
  'rent-to-own': 'rent_to_own',
  'rental-purchase': 'rental_purchase',
  'direct-purchase': 'direct_purchase',
  'out-for-repare': 'out_for_repare',
  'spare-parts': 'spare_parts'
};

function normalizeListSegment(input) {
  const raw = String(input || '').trim();
  if (ROUTE_TO_SEGMENT[raw]) return ROUTE_TO_SEGMENT[raw];
  if (LIST_SEGMENT_MAP[raw]) return raw;
  return null;
}

function listTitleForSegment(segment) {
  const titles = {
    passed: 'Ready to Rent or Sell',
    qc_pending: 'QC Pending',
    qc_process: 'QC Process Laptops',
    dead_laptops: 'Dead Laptops',
    missing_laptops: 'Missing Laptops',
    rent_to_own: 'Rent To Own',
    rental_purchase: 'Rental Purchase',
    direct_purchase: 'Direct Purchase',
    out_for_repare: 'Out For Repare',
    spare_parts: 'Spare Parts'
  };
  return titles[segment] || segment.replace(/_/g, ' ');
}

function effectiveStatusSql(alias) {
  return `COALESCE(
    NULLIF(TRIM(${alias}.qc_status), ''),
    NULLIF(TRIM(${alias}.extra->>'status'), ''),
    'pending'
  )`;
}

// Lifecycle statuses that mean a unit has left the "Ready to Rent/Sell" shelf
// (DC created/dispatched, with a customer, or scrapped/returned).
// These units belong in Customer Assets / Dead Assets, not the rentable pool.
const OFF_SHELF_STATUSES = [
  'in_transit', 'rented', 'on_demo', 'sold', 'returned', 'scrapped'
];

/** Units awaiting serial-verified warehouse receive must not appear on rentable shelf lists. */
function pendingInventoryReceiveFilterSql(alias = 's') {
  return ` AND COALESCE(${alias}.extra->>'awaiting_inventory_receive', 'false') <> 'true'
           AND NOT EXISTS (
             SELECT 1 FROM production_assets pa
              WHERE pa.vendor_serial_id = ${alias}.serial_id
                AND pa.status = 'pending_inventory'
           )`;
}

/** QC-passed units on DC or with a customer must not appear in Ready to Rent or Sell. */
function offShelfInventoryFilterSql(alias = 's') {
  const list = OFF_SHELF_STATUSES.map((s) => `'${s}'`).join(', ');
  return ` AND COALESCE(${alias}.inventory_status, 'in_stock') NOT IN (${list})`;
}

/**
 * Boolean SQL matching Inventory Management → Ready to Rent or Sell
 * (`/inventory-management/ready-to-rent-or-sell`, segment `passed`).
 * Keep in sync with buildListWhere('passed', …).
 */
function readyToRentOrSellMatchSql(alias = 's') {
  const list = OFF_SHELF_STATUSES.map((s) => `'${s}'`).join(', ');
  return `(
    ${alias}.po_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM vendor_purchase_orders p
       WHERE p.po_id = ${alias}.po_id AND p.deleted_at IS NULL
    )
    AND ${effectiveStatusSql(alias)} = 'passed'
    AND COALESCE(${alias}.inventory_status, 'in_stock') NOT IN (${list})
    AND COALESCE(${alias}.extra->>'awaiting_inventory_receive', 'false') <> 'true'
    AND NOT EXISTS (
      SELECT 1 FROM production_assets pa
       WHERE pa.vendor_serial_id = ${alias}.serial_id
         AND pa.status = 'pending_inventory'
    )
  )`;
}

/** QC Process includes customer returns (inventory_status returned) re-entering floor QC. */
function qcProcessInventoryFilterSql(alias = 's') {
  const blocked = OFF_SHELF_STATUSES.filter((s) => s !== 'returned');
  const list = blocked.map((s) => `'${s}'`).join(', ');
  return ` AND COALESCE(${alias}.inventory_status, 'in_stock') NOT IN (${list})`;
}

function buildListWhere(segment, params, alias = 's') {
  const cfg = LIST_SEGMENT_MAP[segment];
  if (!cfg) return { sql: ' AND FALSE', params };

  if (cfg.mode === 'spare_parts') {
    return {
      sql: ` AND ${alias}.spo_id IS NOT NULL`,
      params
    };
  }

  if (cfg.mode === 'po_passed') {
    params.push('passed', cfg.poType);
    return {
      sql: ` AND ${alias}.po_id IS NOT NULL AND ${effectiveStatusSql(alias)} = $${params.length - 1}
             AND p.purchase_order_type = $${params.length}${offShelfInventoryFilterSql(alias)}${pendingInventoryReceiveFilterSql(alias)}`,
      params
    };
  }

  if (cfg.mode === 'status2') {
    params.push(cfg.status2);
    const i = params.length;
    return {
      sql: ` AND ${alias}.po_id IS NOT NULL AND (
        ${alias}.inventory_status = $${i}
        OR COALESCE(NULLIF(TRIM(${alias}.extra->>'status2'), ''), '') = $${i}
      )`,
      params
    };
  }

  if (cfg.mode === 'status_not') {
    params.push(cfg.status);
    const i = params.length;
    return {
      sql: ` AND ${alias}.po_id IS NOT NULL AND ${effectiveStatusSql(alias)} <> $${i}`,
      params
    };
  }

  params.push(cfg.status);
  const i = params.length;

  // QC Process: pending units + failed units still on an active floor ticket (e.g. after
  // Dispatch QC fail then manual stage routing back to Dispatch QC).
  if (segment === 'qc_process' && cfg.status === 'pending') {
    params.push('failed');
    const failedIdx = params.length;
    const qcPendingReceiveSql = ` AND COALESCE(${alias}.extra->>'awaiting_inventory_receive', 'false') <> 'true'`;
    return {
      sql: ` AND ${alias}.po_id IS NOT NULL AND (
        ${effectiveStatusSql(alias)} = $${i}
        OR (
          ${effectiveStatusSql(alias)} = $${failedIdx}
          AND EXISTS (
            SELECT 1 FROM tickets tk
            WHERE tk.vendor_serial_id = ${alias}.serial_id
              AND tk.status IN ('in_progress', 'on_hold')
          )
        )
      )${qcPendingReceiveSql}${qcProcessInventoryFilterSql(alias)}`,
      params,
    };
  }

  // Migrated ERP rows often store out_for_repare as inventory_status = in_repair
  // while qc_status / extra.action_status carry the ERP label.
  if (cfg.status === 'out_for_repare') {
    params.push('in_repair');
    const j = params.length;
    return {
      sql: ` AND ${alias}.po_id IS NOT NULL AND (
        ${effectiveStatusSql(alias)} = $${i}
        OR ${alias}.inventory_status IN ($${i}, $${j})
        OR COALESCE(NULLIF(TRIM(${alias}.extra->>'action_status'), ''), '') = $${i}
      )`,
      params,
    };
  }

  const shelfSql = ['passed', 'qc_pending'].includes(cfg.status)
    ? offShelfInventoryFilterSql(alias)
    : '';
  const pendingReceiveSql = cfg.status === 'passed' ? pendingInventoryReceiveFilterSql(alias) : '';
  const qcPendingReceiveSql = ['pending', 'qc_pending'].includes(cfg.status)
    ? ` AND COALESCE(${alias}.extra->>'awaiting_inventory_receive', 'false') <> 'true'`
    : '';
  return {
    sql: ` AND ${alias}.po_id IS NOT NULL AND ${effectiveStatusSql(alias)} = $${i}${shelfSql}${pendingReceiveSql}${qcPendingReceiveSql}`,
    params
  };
}

const SPARE_PART_TABS = {
  warehouse: 'pending',
  used: 'in_used',
  dead: 'dead'
};

const SPARE_STATUS_VALUES = new Set(['pending', 'in_used', 'dead']);

function effectiveSpareStatusSql(alias = 's') {
  return `COALESCE(
    NULLIF(TRIM(${alias}.qc_status), ''),
    NULLIF(TRIM(${alias}.extra->>'status'), ''),
    'pending'
  )`;
}

function normalizeSpareTab(input) {
  const raw = String(input || 'warehouse').trim().toLowerCase();
  if (SPARE_PART_TABS[raw]) return raw;
  return 'warehouse';
}

function spareStatusForTab(tab) {
  return SPARE_PART_TABS[normalizeSpareTab(tab)];
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0);
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function resolveSpareLineItem(lineItems, extra) {
  const lines = parseLineItems(lineItems);
  if (!lines.length) return null;
  const li = extra?.line_index;
  if (li !== undefined && li !== null && lines[Number(li)]) return lines[Number(li)];
  const pid = extra?.part_id ?? extra?.product_detail_id;
  if (pid != null) {
    const hit = lines.find(
      (l) =>
        String(l.part_id ?? l.product_id ?? l.id ?? '') === String(pid) ||
        String(l.product_detail_id ?? '') === String(pid)
    );
    if (hit) return hit;
  }
  return lines[0];
}

function computeSpareWarranty(serialCreatedAt, line) {
  const months = Number(line?.warranty_months ?? line?.warranty ?? line?.warranty_in_month ?? 0);
  if (!Number.isFinite(months) || months <= 0) return { daysLeft: null, label: '—' };
  const start = serialCreatedAt ? new Date(serialCreatedAt) : new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + months * 30);
  const daysLeft = daysBetween(new Date(), end);
  if (daysLeft == null) return { daysLeft: null, label: '—' };
  if (daysLeft > 0) return { daysLeft, label: `${daysLeft} Days Left` };
  return { daysLeft, label: 'Expired' };
}

function enrichSparePartRow(row) {
  const ex = parseExtra(row.extra);
  const line = resolveSpareLineItem(row.line_items, ex);
  const brand = line?.brand_name ?? line?.brand ?? '';
  const partName =
    ex.part_name ||
    ex.spare_part_name ||
    line?.part_name ||
    line?.name ||
    row.catalog_name ||
    '—';
  const status = String(row.qc_status || ex.status || 'pending').trim() || 'pending';

  return {
    serial_id: row.serial_id,
    serial_number: row.serial_number,
    unique_product_serial: row.inventory_asset_code || ex.unique_product_serial || '',
    qc_status: status,
    spo_id: row.spo_id,
    grn_id: row.grn_id,
    grn_number: row.grn_id != null ? `GRN-${String(row.grn_id).padStart(4, '0')}` : '',
    purchase_order_number: row.purchase_order_number,
    vendor_id: row.vendor_id,
    vendor_name: row.vendor_display_name || row.business_name || row.vendor_name || '',
    vendor_email: row.vendor_email || '',
    vendor_phone: row.vendor_phone || '',
    part_name: partName,
    item_description: {
      brand,
      model: partName,
      part_name: partName
    },
    warranty: computeSpareWarranty(row.created_at, line),
    main_serial_number: ex.main_serial_number || row.main_serial_number || '',
    main_unique_number: ex.main_unique_number || row.main_unique_number || '',
    asset_purchase_order_number: row.asset_purchase_order_number || '',
    asset_grn_number:
      row.asset_grn_id != null ? `GRN-${String(row.asset_grn_id).padStart(4, '0')}` : '',
    updated_at: row.updated_at,
    serial_updated_at: row.updated_at
  };
}

async function fetchSparePartTabCounts(pool) {
  const statusSql = effectiveSpareStatusSql('s');
  const base = `FROM vendor_serial_numbers s
    WHERE s.deleted_at IS NULL AND s.spo_id IS NOT NULL`;
  const counts = { warehouse: 0, used: 0, dead: 0 };
  for (const [tab, status] of Object.entries(SPARE_PART_TABS)) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c ${base} AND ${statusSql} = $1`,
      [status]
    );
    counts[tab] = r.rows[0]?.c || 0;
  }
  counts.total = counts.warehouse + counts.used + counts.dead;
  return counts;
}

/** Active SO allocations (attached, not yet on a DC) for Ready to Rent/Sell indicators. */
async function attachSoAttachmentIndicators(pool, rows) {
  if (!rows?.length) return rows;
  const serialIds = rows.map((r) => r.serial_id).filter(Boolean);
  if (!serialIds.length) return rows;

  const r = await pool.query(
    `SELECT sos.serial_id,
            sos.sales_order_number,
            COALESCE(MAX(sol.customer_name), MAX(c.company_name), MAX(c.name), '') AS customer_name,
            COALESCE(MAX(sol.quotation_type), MAX(sq.quotation_type), 'rental') AS quotation_type
       FROM sales_order_serials sos
       LEFT JOIN sales_order_lines sol ON sol.sales_order_number = sos.sales_order_number
       LEFT JOIN sales_quotations sq ON sq.quotation_number = sol.quotation_number
       LEFT JOIN customers c ON c.customer_id = sol.customer_id
      WHERE sos.serial_id = ANY($1::int[])
        AND sos.status = 'attached'
      GROUP BY sos.serial_id, sos.sales_order_number`,
    [serialIds]
  );

  const bySerial = Object.fromEntries(r.rows.map((row) => [row.serial_id, row]));
  for (const row of rows) {
    const att = bySerial[row.serial_id];
    row.so_attachment = att
      ? {
          sales_order_number: att.sales_order_number,
          customer_name: att.customer_name || null,
          quotation_type: att.quotation_type || 'rental',
        }
      : null;
  }
  return rows;
}

module.exports = {
  LIST_SEGMENT_MAP,
  ROUTE_TO_SEGMENT,
  OFF_SHELF_STATUSES,
  offShelfInventoryFilterSql,
  readyToRentOrSellMatchSql,
  qcProcessInventoryFilterSql,
  SPARE_PART_TABS,
  SPARE_STATUS_VALUES,
  normalizeListSegment,
  normalizeSpareTab,
  spareStatusForTab,
  effectiveSpareStatusSql,
  listTitleForSegment,
  buildListWhere,
  enrichSerialRow,
  enrichSerialRowsBatch,
  enrichSparePartRow,
  fetchSparePartTabCounts,
  attachSoAttachmentIndicators,
  parseExtra,
  parseLineItems
};
