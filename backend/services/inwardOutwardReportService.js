/**
 * Inward & Outward Summary report.
 *
 * Aggregates laptop-unit movement across the modules that physically move
 * machines in/out of the warehouse:
 *
 *  INWARD
 *   - Vendor  : vendor_serial_numbers rows created via a laptop PO/GRN
 *   - Customer: support_ticket_items pickups confirmed received at warehouse
 *   - Direct  : inward_outward ledger rows flagged as inward (courier/manual/ERP)
 *
 *  OUTWARD
 *   - Customer: delivery_challan_lines dispatched to a customer
 *   - Vendor  : vendor_repair_dc_items dispatched to a vendor (repair return)
 *
 * Filter semantics (a filter is applied only where the column exists):
 *   - date range          -> each source's own movement timestamp
 *   - vendor              -> vendor sources; zeroes out customer-only sources
 *   - customer            -> customer sources; zeroes out vendor-only sources
 *   - courier             -> sources that store a courier; zeroes vendor GRN inward
 *   - user                -> sources with an actor column; zeroes vendor GRN inward
 *   - entity / branch     -> delivery challans + vendor GRN inward (others lack the column)
 */
const pool = require('../config/db');

const dateClause = (col, from, to, params) => {
  if (!from || !to) return '';
  params.push(from);
  const a = params.length;
  params.push(to);
  const b = params.length;
  return ` AND ${col} >= $${a}::date AND ${col} < ($${b}::date + INTERVAL '1 day')`;
};

const eqNum = (col, val, params) => {
  const n = parseInt(val, 10);
  if (!val || Number.isNaN(n)) return '';
  params.push(n);
  return ` AND ${col} = $${params.length}`;
};

const eqText = (col, val, params) => {
  if (!val) return '';
  params.push(String(val));
  return ` AND ${col} = $${params.length}`;
};

const ilike = (col, val, params) => {
  if (!val) return '';
  params.push(`%${val}%`);
  return ` AND ${col} ILIKE $${params.length}`;
};

const scalar = async (sql, params) => {
  const { rows } = await pool.query(sql, params);
  return Number(rows[0]?.n || 0);
};

async function getInwardOutwardSummary({
  from = null, to = null, entity = '', branch = '', vendor = '', customer = '', courier = '', user = '',
} = {}) {
  const hasVendor = Boolean(vendor);
  const hasCustomer = Boolean(customer);
  const hasCourier = Boolean(courier);
  const hasUser = Boolean(user);
  const hasEntity = Boolean(entity);

  // --- INWARD: Vendor (GRN / purchase) ---
  const vendorInward = async () => {
    // A vendor-received laptop has no customer / courier / actor column, so an
    // explicit filter on any of those excludes this source entirely.
    if (hasCustomer || hasCourier || hasUser) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM vendor_serial_numbers vsn
               JOIN vendor_purchase_orders po ON po.po_id = vsn.po_id
               WHERE vsn.deleted_at IS NULL AND vsn.spo_id IS NULL`;
    sql += dateClause('vsn.created_at', from, to, params);
    sql += eqNum('po.vendor_id', vendor, params);
    sql += eqText('vsn.current_entity', entity, params);
    return scalar(sql, params);
  };

  // --- INWARD: Customer (support pickup / repair / return, received at warehouse) ---
  const customerInward = async () => {
    if (hasVendor) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM support_ticket_items i
               JOIN support_tickets t ON t.id = i.ticket_id
               WHERE i.item_type = 'pickup' AND i.warehouse_received_at IS NOT NULL`;
    sql += dateClause('i.warehouse_received_at', from, to, params);
    sql += eqNum('t.customer_id', customer, params);
    sql += ilike('i.pickup_courier_name', courier, params);
    sql += eqNum('i.warehouse_received_by', user, params);
    // No entity column on support; drop this source when an entity filter is set.
    if (hasEntity) return 0;
    return scalar(sql, params);
  };

  // --- INWARD: Direct (inward_outward ledger — courier / bluedart / manual / ERP) ---
  const directInward = async () => {
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM inward_outward io
               WHERE io.io_type ILIKE 'inward%'`;
    sql += dateClause('io.created_at', from, to, params);
    sql += eqNum('io.vendor_id', vendor, params);
    sql += eqNum('io.customer_id', customer, params);
    sql += ilike('io.courier_name', courier, params);
    sql += eqNum('io.technician_id', user, params);
    // No entity column on the ledger; drop when entity filter is set.
    if (hasEntity) return 0;
    return scalar(sql, params);
  };

  // --- OUTWARD: Customer (delivery challan dispatch) ---
  const customerOutward = async () => {
    if (hasVendor) return 0;
    const params = [];
    const unitSql = `CASE
      WHEN COALESCE(jsonb_array_length(d.serial_number), 0) > 0 THEN jsonb_array_length(d.serial_number)
      ELSE COALESCE(d.quantity, 1)
    END`;
    let sql = `SELECT COALESCE(SUM(${unitSql}), 0)::int AS n
               FROM delivery_challan_lines d
               WHERE COALESCE(d.movement_type, 'outbound') = 'outbound'
                 AND d.dispatched_at IS NOT NULL`;
    sql += dateClause('d.dispatched_at', from, to, params);
    sql += eqText('d.entity_code', entity, params);
    sql += eqText('d.branch', branch, params);
    sql += eqNum('d.customer_id', customer, params);
    sql += ilike('d.courier_name', courier, params);
    sql += eqNum('d.created_by', user, params);
    return scalar(sql, params);
  };

  // --- OUTWARD: Vendor (vendor repair DC dispatch / purchase return) ---
  const vendorOutward = async () => {
    if (hasCustomer) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM vendor_repair_dc_items it
               JOIN vendor_repair_delivery_challans h ON h.dc_number = it.dc_number
               WHERE h.dispatched_at IS NOT NULL`;
    sql += dateClause('h.dispatched_at', from, to, params);
    sql += eqNum('h.vendor_id', vendor, params);
    sql += ilike('h.courier_name', courier, params);
    sql += eqNum('h.created_by', user, params);
    // No entity column on VRDC; drop when entity filter is set.
    if (hasEntity) return 0;
    return scalar(sql, params);
  };

  const [inVendor, inCustomer, inDirect, outCustomer, outVendor] = await Promise.all([
    vendorInward(), customerInward(), directInward(), customerOutward(), vendorOutward(),
  ]);

  return {
    inward: {
      total: inVendor + inCustomer + inDirect,
      vendor: inVendor,
      customer: inCustomer,
      direct: inDirect,
    },
    outward: {
      total: outCustomer + outVendor,
      customer: outCustomer,
      vendor: outVendor,
    },
  };
}

async function getInwardOutwardFilters() {
  const [entities, vendors, customers, couriers, users] = await Promise.all([
    pool.query(`SELECT code, legal_name FROM companies WHERE active IS DISTINCT FROM false ORDER BY code`),
    pool.query(`SELECT vendor_id, business_name FROM vendors WHERE deleted_at IS NULL AND COALESCE(business_name, '') <> '' ORDER BY business_name`),
    pool.query(
      `SELECT DISTINCT customer_id, customer_name FROM (
         SELECT customer_id, customer_name FROM delivery_challan_lines WHERE customer_id IS NOT NULL
         UNION
         SELECT customer_id, customer_name FROM support_tickets WHERE customer_id IS NOT NULL
       ) c
       WHERE COALESCE(customer_name, '') <> ''
       ORDER BY customer_name
       LIMIT 1000`
    ),
    pool.query(
      `SELECT DISTINCT courier_name FROM (
         SELECT courier_name FROM delivery_challan_lines WHERE COALESCE(courier_name, '') <> ''
         UNION SELECT pickup_courier_name AS courier_name FROM support_ticket_items WHERE COALESCE(pickup_courier_name, '') <> ''
         UNION SELECT courier_name FROM vendor_repair_delivery_challans WHERE COALESCE(courier_name, '') <> ''
       ) x
       ORDER BY courier_name`
    ),
    pool.query(`SELECT user_id, name FROM users WHERE active = true AND COALESCE(name, '') <> '' ORDER BY name`),
  ]);
  return {
    entities: entities.rows,
    vendors: vendors.rows,
    customers: customers.rows,
    couriers: couriers.rows.map((r) => r.courier_name),
    users: users.rows,
  };
}

module.exports = { getInwardOutwardSummary, getInwardOutwardFilters };
