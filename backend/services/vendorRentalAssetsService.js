/**
 * Vendor rental assets (claude/carret-vendor-repair.md) — per vendor: what we
 * rent from them, where each laptop is now, what went back, and which laptop
 * each replacement replaced.
 *
 * Every laptop on a rental PO (not rejected at the door) falls in one bucket:
 *   with_customer     rented / on demo
 *   going_out         reserved, dispatch ready, at the gate, in transit
 *   in_stock          in stock
 *   in_production     in repair / QC failed / back from a customer, with us
 *   at_vendor_repair  on an open repair challan with the vendor (rent paused
 *                     on new-format challans)
 *   returned          returned to the vendor (return, replaced original, kept)
 *   bought_or_gone    sold / scrapped / bought out — no longer rented
 * "Replacement" is a flag on top (the laptop came as a vendor replacement).
 */
const pool = require('../config/db');
const { VENDOR_LINE_JOIN_SQL, VENDOR_LINE_RATE_SQL } = require('./billingSchedulerService');

const BUCKET_SQL = `CASE
    WHEN COALESCE(vsn.acquisition_type, vpo.purchase_order_type) NOT IN ('rental_purchase','rent_to_own')
      OR vsn.inventory_status IN ('sold','scrapped') THEN 'bought_or_gone'
    WHEN vsn.inventory_status = 'returned_to_vendor' THEN 'returned'
    WHEN rep.item_id IS NOT NULL THEN 'at_vendor_repair'
    WHEN vsn.inventory_status IN ('rented','on_demo') THEN 'with_customer'
    WHEN vsn.inventory_status IN ('reserved','dispatch_ready','at_gate','in_transit') THEN 'going_out'
    WHEN vsn.inventory_status = 'in_stock' THEN 'in_stock'
    ELSE 'in_production'
  END`;

const BASE_FROM = `
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id AND vpo.deleted_at IS NULL
       JOIN vendors v ON v.vendor_id = vpo.vendor_id
       ${VENDOR_LINE_JOIN_SQL}
       LEFT JOIN LATERAL (
         SELECT i.id AS item_id, i.dc_number, i.item_status, i.rent_paused_from
           FROM vendor_repair_dc_items i
           JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number
          WHERE i.serial_id = vsn.serial_id
            AND d.vendor_id = vpo.vendor_id
            AND i.item_status IN ('dispatched','gate_received','replacement_pending')
          ORDER BY i.id DESC LIMIT 1
       ) rep ON TRUE
       LEFT JOIN LATERAL (
         SELECT p.paused_from FROM vendor_rent_pauses p
          WHERE p.serial_id = vsn.serial_id AND p.closed_reason IS NULL LIMIT 1
       ) pz ON TRUE
       LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
      WHERE vsn.deleted_at IS NULL
        AND vpo.purchase_order_type IN ('rental_purchase','rent_to_own')
        AND NOT COALESCE(vsn.rejected_at_receipt, FALSE)`;

const IS_REPLACEMENT_SQL = `(COALESCE(vsn.extra->>'asset_tag','') = 'replacement')`;
const BILLING_NOW_SQL = `(
    COALESCE(vsn.acquisition_type, vpo.purchase_order_type) IN ('rental_purchase','rent_to_own')
    AND COALESCE(vsn.inventory_status,'') NOT IN ('sold','scrapped','returned_to_vendor')
    AND (vsn.vendor_rent_end_date IS NULL OR vsn.vendor_rent_end_date >= CURRENT_DATE)
    AND pz.paused_from IS NULL
  )`;

async function vendorRentalSummary({ vendorId } = {}) {
  const params = [];
  let where = '';
  if (vendorId) { params.push(Number(vendorId)); where = ` AND vpo.vendor_id = $${params.length}`; }
  const { rows } = await pool.query(
    `WITH x AS (
       SELECT vpo.vendor_id, v.business_name AS vendor_name,
              ${BUCKET_SQL} AS bucket,
              ${IS_REPLACEMENT_SQL} AS is_replacement,
              (vsn.extra->>'replaced_by_ttspl') IS NOT NULL AS was_replaced,
              ${BILLING_NOW_SQL} AS billing_now,
              pz.paused_from IS NOT NULL AS rent_paused,
              rep.item_status AS repair_item_status,
              ${VENDOR_LINE_RATE_SQL} AS rate
       ${BASE_FROM}${where}
     )
     SELECT vendor_id, vendor_name,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE NOT is_replacement)::int AS originals,
            COUNT(*) FILTER (WHERE is_replacement)::int AS replacements,
            COUNT(*) FILTER (WHERE bucket = 'returned')::int AS returned,
            COUNT(*) FILTER (WHERE bucket = 'returned' AND was_replaced)::int AS returned_replaced,
            COUNT(*) FILTER (WHERE bucket = 'with_customer')::int AS with_customer,
            COUNT(*) FILTER (WHERE bucket = 'going_out')::int AS going_out,
            COUNT(*) FILTER (WHERE bucket = 'in_stock')::int AS in_stock,
            COUNT(*) FILTER (WHERE bucket = 'in_production')::int AS in_production,
            COUNT(*) FILTER (WHERE bucket = 'at_vendor_repair')::int AS at_vendor_repair,
            COUNT(*) FILTER (WHERE rent_paused)::int AS rent_paused,
            COUNT(*) FILTER (WHERE repair_item_status = 'replacement_pending')::int AS awaiting_approval,
            COUNT(*) FILTER (WHERE repair_item_status = 'gate_received')::int AS back_not_received,
            COUNT(*) FILTER (WHERE bucket = 'bought_or_gone')::int AS bought_or_gone,
            COUNT(*) FILTER (WHERE billing_now)::int AS billing_now,
            COALESCE(SUM(rate) FILTER (WHERE billing_now), 0)::float AS monthly_rent_now
       FROM x
      GROUP BY vendor_id, vendor_name
      ORDER BY COUNT(*) FILTER (WHERE billing_now) DESC, vendor_name`,
    params
  );
  return rows;
}

const BUCKETS = ['with_customer', 'going_out', 'in_stock', 'in_production', 'at_vendor_repair', 'returned', 'bought_or_gone'];

async function vendorRentalLaptops({ vendorId, bucket, replacementsOnly = false, search, limit = 500 }) {
  const params = [];
  const where = [];
  if (vendorId) { params.push(Number(vendorId)); where.push(`vpo.vendor_id = $${params.length}`); }
  if (bucket && BUCKETS.includes(bucket)) { params.push(bucket); where.push(`${BUCKET_SQL} = $${params.length}`); }
  if (replacementsOnly) where.push(`(${IS_REPLACEMENT_SQL} OR (vsn.extra->>'replaced_by_ttspl') IS NOT NULL)`);
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    where.push(`(vsn.serial_number ILIKE $${params.length} OR vsn.inventory_asset_code ILIKE $${params.length})`);
  }
  params.push(Math.min(2000, Number(limit) || 500));
  const { rows } = await pool.query(
    `SELECT vsn.serial_id,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
            vsn.serial_number, vsn.inventory_status,
            vpo.vendor_id, v.business_name AS vendor_name, vpo.purchase_order_number AS po_number,
            COALESCE(vsn.extra->>'brand','') AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name','') AS model,
            ${BUCKET_SQL} AS bucket,
            ${IS_REPLACEMENT_SQL} AS is_replacement,
            vsn.extra->>'replaced_ttspl_id' AS replaced_ttspl_id,
            vsn.extra->>'replaced_serial' AS replaced_serial,
            vsn.extra->>'replaced_by_ttspl' AS replaced_by_ttspl,
            vsn.extra->>'replaced_by_serial' AS replaced_by_serial,
            vsn.extra->>'replacement_dc_number' AS replacement_dc_number,
            COALESCE((vsn.extra->>'received_at')::date, vsn.rental_start_date, vsn.created_at::date) AS rent_from,
            vsn.vendor_rent_end_date AS rent_to,
            pz.paused_from AS rent_paused_from,
            rep.dc_number AS repair_dc_number, rep.item_status AS repair_item_status,
            ${VENDOR_LINE_RATE_SQL} AS monthly_rent,
            ${BILLING_NOW_SQL} AS billing_now,
            c.company_name AS customer_name
       ${BASE_FROM}
       ${where.length ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY vsn.inventory_asset_code NULLS LAST
      LIMIT $${params.length}`,
    params
  );
  const ymd = (d) => (d ? new Intl.DateTimeFormat('en-CA').format(new Date(d)) : null);
  return rows.map((r) => ({ ...r, rent_from: ymd(r.rent_from), rent_to: ymd(r.rent_to), rent_paused_from: ymd(r.rent_paused_from) }));
}

module.exports = { vendorRentalSummary, vendorRentalLaptops, BUCKETS };
