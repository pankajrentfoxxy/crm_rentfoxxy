/**
 * Master Vendor Data — laptops purchased via Vendor PO in a purchase-date window,
 * then their current inventory / customer / warehouse stage.
 * Reuses Master Data joins, filters, sale/rental SQL, and row mapping.
 */
const pool = require('../config/db');
const XLSX = require('xlsx');
const { parseCsvQuery } = require('../utils/dateRangeFilter');
const {
  FROM_SQL,
  buildMasterFilters,
  mapLaptopRow,
  SQL_IS_SALE,
  SQL_IS_RENTAL,
  CUSTOMER_STATUSES,
} = require('./masterDataDashboardService');
const {
  appendColumnFilters,
  getColumnDistinctValues,
  columnKeys,
  getColumnDef,
  COLUMNS,
} = require('./vendorMasterColumnFilters');

const CUSTOMER_SQL = CUSTOMER_STATUSES.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');

const WAREHOUSE_BUCKET_SQL = `
  CASE
    WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN
      CASE WHEN ${SQL_IS_SALE} THEN 'sold' ELSE 'rental' END
    WHEN s.inventory_status = 'scrapped' THEN 'dead_scrapped'
    WHEN vr.on_vendor_repair IS NOT NULL
      OR s.inventory_status IN ('in_repair', 'out_for_repare')
      THEN 'out_for_repair'
    WHEN s.inventory_status = 'in_stock'
      AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
      AND ${SQL_IS_SALE} THEN 'ready_to_sell'
    WHEN s.inventory_status = 'in_stock'
      AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
      THEN 'ready_to_rent'
    WHEN active_ticket.stage_name = 'QC1' THEN 'qc1'
    WHEN active_ticket.stage_name = 'QC2' THEN 'qc2'
    WHEN active_ticket.stage_name IN ('Diagnosis', 'Chip Level Repair') THEN 'diagnosis_hardware'
    WHEN active_ticket.stage_name IN ('Assembly & Software') THEN 'diagnosis_software'
    WHEN active_ticket.stage_name = 'Final Testing' THEN 'final_testing'
    WHEN active_ticket.stage_name = 'Dispatch QC' THEN 'dispatch'
    ELSE 'other'
  END
`;

const WAREHOUSE_STAGE_KEYS = [
  'qc1', 'qc2', 'diagnosis_hardware', 'diagnosis_software', 'final_testing',
  'ready_to_rent', 'ready_to_sell', 'dead_scrapped', 'other',
];

function scopedQuery(query = {}) {
  return {
    ...query,
    date_basis: 'purchase',
    apply_vendor_po_exclusion: query.apply_vendor_po_exclusion == null ? '1' : query.apply_vendor_po_exclusion,
    from_vendor: '1',
  };
}

function buildVendorMasterFilters(query = {}, { excludeColumn } = {}) {
  const base = buildMasterFilters(scopedQuery(query));
  const buckets = parseCsvQuery(query.warehouse_bucket);
  if (buckets.length) {
    base.params.push(buckets);
    const i = base.params.length;
    base.whereSql = `${base.whereSql} AND (${WAREHOUSE_BUCKET_SQL}) = ANY($${i}::text[])`;
  }
  return appendColumnFilters(base, query, {
    excludeColumn,
    locationLabelSql: locationLabelSql(),
  });
}

function usageSql() {
  return `
    CASE
      WHEN s.inventory_status IN (${CUSTOMER_SQL}) AND ${SQL_IS_SALE} THEN 'sold'
      WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN 'rental'
      WHEN vr.on_vendor_repair IS NOT NULL
        OR s.inventory_status IN ('in_repair', 'out_for_repare') THEN 'repair'
      ELSE 'warehouse'
    END
  `;
}

function locationLabelSql() {
  return `
    CASE
      WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN
        CONCAT('Customer - ', COALESCE(NULLIF(TRIM(COALESCE(c.company_name, c.name)), ''), 'Customer'))
      WHEN vr.on_vendor_repair IS NOT NULL
        OR s.inventory_status IN ('in_repair', 'out_for_repare') THEN 'Vendor Repair'
      WHEN s.inventory_status = 'scrapped' THEN 'Dead / Scrapped'
      WHEN s.inventory_status = 'in_stock'
        AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
        AND ${SQL_IS_SALE} THEN 'Ready to Sell'
      WHEN s.inventory_status = 'in_stock'
        AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
        THEN 'Ready to Rent'
      WHEN COALESCE(active_ticket.stage_name, '') <> '' THEN active_ticket.stage_name
      ELSE 'Warehouse'
    END
  `;
}

function emptyWarehouseStages() {
  return WAREHOUSE_STAGE_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function mapVendorMasterRow(row) {
  const base = mapLaptopRow(row);
  const purchaseRate = row.purchase_rate != null && row.purchase_rate !== ''
    ? Number(row.purchase_rate)
    : (base.vendor_price_type === 'purchase' ? base.vendor_purchase_price : null);
  const usage = row.usage_bucket || null;
  const withCustomer = usage === 'sold' || usage === 'rental';
  return {
    ...base,
    purchase_date: row.purchase_order_date || null,
    purchase_rate: purchaseRate,
    last_movement_date: row.delivered_at || row.updated_at || null,
    location_label: row.location_label || base.current_location,
    warehouse_bucket: row.warehouse_bucket || null,
    usage_bucket: usage,
    sale_price: usage === 'sold' ? (base.sale_price ?? (row.so_rate != null ? Number(row.so_rate) : null)) : base.sale_price,
    customer_monthly_rate: usage === 'rental'
      ? (base.customer_monthly_rate != null
        ? base.customer_monthly_rate
        : (Number(row.rent_monthly_rate || row.so_rate || 0) || null))
      : base.customer_monthly_rate,
    customer_id: withCustomer ? (row.current_customer_id || base.customer_id) : base.customer_id,
    customer_name: withCustomer ? (row.customer_name || base.customer_name) : base.customer_name,
    sales_order_number: withCustomer ? (row.sales_order_number || base.sales_order_number) : base.sales_order_number,
    delivery_challan_number: withCustomer
      ? (row.current_dc_number || row.sos_dc_number || base.delivery_challan_number)
      : base.delivery_challan_number,
  };
}

const LIST_SELECT = `
  s.serial_id, s.serial_number, s.inventory_asset_code, s.extra, s.inventory_status,
  s.current_customer_id, s.current_dc_number, s.current_entity, s.updated_at,
  s.rent_monthly_rate, s.rent_start_date, s.delivered_at, s.grn_id, s.qc_status,
  p.po_id, p.purchase_order_number, p.purchase_order_type, p.vendor_id, p.purchase_order_date,
  COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name,
  COALESCE(c.company_name, c.name) AS customer_name,
  active_ticket.ticket_id AS active_floor_ticket_id,
  active_ticket.stage_name AS ticket_stage_name,
  sos.sales_order_number, sos.dc_number AS sos_dc_number, sos.so_rate, sos.quotation_type,
  vr.on_vendor_repair,
  vpd.purchase_rate,
  vpd.monthly_rental_amount,
  (${WAREHOUSE_BUCKET_SQL}) AS warehouse_bucket,
  (${usageSql()}) AS usage_bucket,
  (${locationLabelSql()}) AS location_label
`;

async function getOverview(query = {}) {
  const base = buildVendorMasterFilters(query);
  const optionFilters = buildMasterFilters({
    ...scopedQuery(query),
    vendor_id: '',
    warehouse_bucket: '',
  });
  const usage = usageSql();
  const [kpiRes, vendorRes, optionRes] = await Promise.all([
    pool.query(
      `SELECT
          COUNT(*)::int AS total_purchased,
          COALESCE(SUM(COALESCE(vpd.purchase_rate, 0)), 0)::numeric AS total_purchase_value,
          COUNT(*) FILTER (WHERE ${usage} = 'sold')::int AS sold_count,
          COALESCE(SUM(COALESCE(sos.so_rate, 0)) FILTER (WHERE ${usage} = 'sold'), 0)::numeric AS total_sale_value,
          COUNT(*) FILTER (WHERE ${usage} = 'rental')::int AS rental_count,
          COALESCE(SUM(COALESCE(s.rent_monthly_rate, sos.so_rate, 0)) FILTER (
            WHERE ${usage} = 'rental'
              AND s.inventory_status IN ('rented', 'on_demo', 'reserved', 'in_transit')
          ), 0)::numeric AS total_monthly_rental_value,
          COUNT(*) FILTER (WHERE ${usage} = 'warehouse')::int AS warehouse_count,
          COUNT(*) FILTER (WHERE ${usage} = 'repair')::int AS out_for_repair_count,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'qc1')::int AS qc1,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'qc2')::int AS qc2,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'diagnosis_hardware')::int AS diagnosis_hardware,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'diagnosis_software')::int AS diagnosis_software,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'final_testing')::int AS final_testing,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'ready_to_rent')::int AS ready_to_rent,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'ready_to_sell')::int AS ready_to_sell,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'dead_scrapped')::int AS dead_scrapped,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'other' AND ${usage} = 'warehouse')::int AS other
       ${FROM_SQL}
       ${base.joinSql || ''}
       ${base.whereSql}`,
      base.params
    ),
    pool.query(
      `SELECT
          p.vendor_id,
          COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name,
          COUNT(*)::int AS purchased_qty,
          COALESCE(SUM(COALESCE(vpd.purchase_rate, 0)), 0)::numeric AS purchase_value,
          COUNT(*) FILTER (WHERE ${usage} = 'sold')::int AS sold_qty,
          COALESCE(SUM(COALESCE(sos.so_rate, 0)) FILTER (WHERE ${usage} = 'sold'), 0)::numeric AS sale_value,
          COUNT(*) FILTER (WHERE ${usage} = 'rental')::int AS rental_qty,
          COALESCE(SUM(COALESCE(s.rent_monthly_rate, sos.so_rate, 0)) FILTER (
            WHERE ${usage} = 'rental'
              AND s.inventory_status IN ('rented', 'on_demo', 'reserved', 'in_transit')
          ), 0)::numeric AS monthly_rental_value,
          COUNT(*) FILTER (WHERE ${usage} = 'warehouse')::int AS warehouse_qty,
          COUNT(*) FILTER (WHERE ${usage} = 'repair')::int AS repair_qty
       ${FROM_SQL}
       ${base.joinSql || ''}
       ${base.whereSql}
         AND p.vendor_id IS NOT NULL
       GROUP BY p.vendor_id,
                COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,''))))
       ORDER BY purchased_qty DESC, vendor_name ASC
       LIMIT 300`,
      base.params
    ),
    pool.query(
      `SELECT DISTINCT
          p.vendor_id,
          COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name
       ${FROM_SQL}
       ${optionFilters.joinSql || ''}
       ${optionFilters.whereSql}
         AND p.vendor_id IS NOT NULL
       ORDER BY vendor_name ASC
       LIMIT 400`,
      optionFilters.params
    ).catch(() => ({ rows: [] })),
  ]);

  const k = kpiRes.rows[0] || {};
  const warehouse_stages = emptyWarehouseStages();
  WAREHOUSE_STAGE_KEYS.forEach((key) => {
    warehouse_stages[key] = Number(k[key] || 0);
  });

  const vendors = vendorRes.rows.map((row) => ({
    vendor_id: row.vendor_id,
    vendor_name: row.vendor_name,
    purchased_qty: Number(row.purchased_qty || 0),
    purchase_value: Number(row.purchase_value || 0),
    sold_qty: Number(row.sold_qty || 0),
    sale_value: Number(row.sale_value || 0),
    rental_qty: Number(row.rental_qty || 0),
    monthly_rental_value: Number(row.monthly_rental_value || 0),
    warehouse_qty: Number(row.warehouse_qty || 0),
    repair_qty: Number(row.repair_qty || 0),
    current_total: Number(row.purchased_qty || 0),
  }));

  return {
    kpis: {
      total_purchased: Number(k.total_purchased || 0),
      total_purchase_value: Number(k.total_purchase_value || 0),
      sold_count: Number(k.sold_count || 0),
      total_sale_value: Number(k.total_sale_value || 0),
      rental_count: Number(k.rental_count || 0),
      total_monthly_rental_value: Number(k.total_monthly_rental_value || 0),
      warehouse_count: Number(k.warehouse_count || 0),
      out_for_repair_count: Number(k.out_for_repair_count || 0),
      warehouse_stages,
    },
    vendors,
    vendor_options: (optionRes.rows || []).map((r) => ({
      value: String(r.vendor_id),
      label: r.vendor_name || `#${r.vendor_id}`,
    })),
  };
}

async function getLaptopColumnValues(query = {}) {
  const column = String(query.column || '').trim();
  if (!column || !getColumnDef(column, locationLabelSql())) {
    return { column, values: [] };
  }
  const base = buildVendorMasterFilters(query, { excludeColumn: column });
  const values = await getColumnDistinctValues(pool, {
    fromSql: FROM_SQL,
    joinSql: base.joinSql,
    whereSql: base.whereSql,
    params: base.params,
  }, column, locationLabelSql());
  return { column, values };
}

async function listLaptops(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
  const offset = (page - 1) * limit;
  const base = buildVendorMasterFilters(query);
  const listParams = [...base.params, limit, offset];
  const [countRes, listRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total ${FROM_SQL} ${base.joinSql || ''} ${base.whereSql}`,
      base.params
    ),
    pool.query(
      `SELECT ${LIST_SELECT}
       ${FROM_SQL}
       ${base.joinSql || ''}
       ${base.whereSql}
       ORDER BY p.purchase_order_date DESC NULLS LAST, s.serial_id DESC
       LIMIT $${base.params.length + 1} OFFSET $${base.params.length + 2}`,
      listParams
    ),
  ]);
  const total = countRes.rows[0]?.total || 0;
  return {
    data: listRes.rows.map(mapVendorMasterRow),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function listAllForExport(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20000, 1), 20000);
  const base = buildVendorMasterFilters(query);
  const listRes = await pool.query(
    `SELECT ${LIST_SELECT}
     ${FROM_SQL}
     ${base.joinSql || ''}
     ${base.whereSql}
     ORDER BY p.purchase_order_date DESC NULLS LAST, s.serial_id DESC
     LIMIT $${base.params.length + 1}`,
    [...base.params, limit]
  );
  return listRes.rows.map(mapVendorMasterRow);
}

function fmtExportMoney(n) {
  if (n == null || n === '') return '';
  return Number(n);
}

async function buildExportWorkbook(query = {}) {
  const rows = await listAllForExport(query);
  const sheetRows = rows.map((r, idx) => ({
    'S.No': idx + 1,
    TTSPL: r.ttspl_id || '',
    'Serial Number': r.serial_number || '',
    Vendor: r.vendor_name || '',
    'Purchase Date': r.purchase_date || '',
    'Purchase Order': r.purchase_order_number || '',
    'Purchase Rate': fmtExportMoney(r.purchase_rate),
    Brand: r.brand || '',
    Model: r.model || '',
    Generation: r.generation || '',
    Processor: r.processor || '',
    RAM: r.ram || '',
    Storage: r.storage || '',
    Graphics: r.graphics || '',
    'Screen Size': r.screen_size || '',
    'Current Status': String(r.current_status || '').replace(/_/g, ' '),
    'Current Location': r.location_label || r.current_location || '',
    'Current Stage': r.current_stage || '',
    Customer: r.customer_name || '',
    'SO Number': r.sales_order_number || '',
    'DC Number': r.delivery_challan_number || '',
    'Sale Price': fmtExportMoney(r.sale_price),
    'Monthly Rental Rate': fmtExportMoney(r.customer_monthly_rate),
    'Last Movement Date': r.last_movement_date || '',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows.length ? sheetRows : [{ Note: 'No rows match filters' }]);
  XLSX.utils.book_append_sheet(wb, ws, 'Vendor Master');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, filename: 'master_vendor_data.xlsx' };
}

module.exports = {
  getOverview,
  listLaptops,
  getLaptopColumnValues,
  buildExportWorkbook,
  WAREHOUSE_BUCKET_SQL,
  WAREHOUSE_STAGE_KEYS,
  emptyWarehouseStages,
  usageSql,
  locationLabelSql,
  VENDOR_MASTER_COLUMN_KEYS: columnKeys(),
  VENDOR_MASTER_COLUMNS: COLUMNS,
};
