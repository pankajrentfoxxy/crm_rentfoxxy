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
  // ERP "QC Processing List" (/admin/qc/orders/qc-orders/pending) — status = 'pending' only.
  // Other non-passed statuses (failed, out_for_repare, dead, …) have their own inventory tabs.
  qc_process: { mode: 'status', status: 'pending' },
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
  'qc-process': 'qc_process',
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
    qc_process: 'QC Process Laptops',
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
// (attached to an order, dispatched, with a customer, or scrapped/returned).
// These units belong in Customer Assets / Dead Assets, not the rentable pool.
const OFF_SHELF_STATUSES = [
  'reserved', 'in_transit', 'rented', 'on_demo', 'sold', 'returned', 'scrapped'
];

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
             AND p.purchase_order_type = $${params.length}`,
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
  let extraSql = '';
  // "Ready to Rent or Sell" must only show units still on the shelf. Once a unit
  // is attached to an order / dispatched / delivered (inventory_status moves to an
  // off-shelf value) it drops out of this bucket and into Customer Assets.
  if (segment === 'passed') {
    params.push(OFF_SHELF_STATUSES);
    extraSql = ` AND COALESCE(NULLIF(TRIM(${alias}.inventory_status), ''), 'in_stock') <> ALL($${params.length}::text[])`;
  }
  return {
    sql: ` AND ${alias}.po_id IS NOT NULL AND ${effectiveStatusSql(alias)} = $${i}${extraSql}`,
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

module.exports = {
  LIST_SEGMENT_MAP,
  ROUTE_TO_SEGMENT,
  OFF_SHELF_STATUSES,
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
  parseExtra,
  parseLineItems
};
