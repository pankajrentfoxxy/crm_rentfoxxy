/**
 * Inventory Management — Laravel InventoryManagementController parity on vendor_serial_numbers.
 */
const {
  EFFECTIVE_STATUS_SQL,
  parseExtra,
  parseLineItems,
  enrichSerialRow
} = require('./qcManagementService');

const LIST_SEGMENT_MAP = {
  passed: { mode: 'status', status: 'passed' },
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

  params.push(cfg.status);
  const i = params.length;
  return {
    sql: ` AND ${alias}.po_id IS NOT NULL AND ${effectiveStatusSql(alias)} = $${i}`,
    params
  };
}

function enrichSparePartRow(row) {
  const ex = parseExtra(row.extra);
  return {
    serial_id: row.serial_id,
    serial_number: row.serial_number,
    unique_product_serial: row.inventory_asset_code || ex.unique_product_serial || '',
    qc_status: row.qc_status || ex.status || 'pending',
    spo_id: row.spo_id,
    grn_id: row.grn_id,
    grn_number: row.grn_id != null ? `GRN-${String(row.grn_id).padStart(4, '0')}` : '',
    purchase_order_number: row.purchase_order_number,
    vendor_name: row.business_name || row.vendor_name || '',
    part_name: ex.part_name || ex.spare_part_name || row.catalog_name || '—',
    updated_at: row.updated_at
  };
}

module.exports = {
  LIST_SEGMENT_MAP,
  ROUTE_TO_SEGMENT,
  normalizeListSegment,
  listTitleForSegment,
  buildListWhere,
  enrichSerialRow,
  enrichSparePartRow,
  parseExtra
};
