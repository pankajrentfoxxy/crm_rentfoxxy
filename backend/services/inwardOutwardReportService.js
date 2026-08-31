/**
 * Inward & Outward Summary report.
 *
 * Aggregates laptop-unit movement with return / replacement breakdowns:
 *
 *  INWARD
 *   - Vendor purchase     : vendor_serial_numbers via laptop PO/GRN
 *   - Vendor return       : VRDC items received back repaired
 *   - Vendor replacement  : VRDC items received as replacement units
 *   - Customer return     : support pickups (pickup_type=return) warehouse-received
 *   - Customer replacement: warehouse-received pickups tied to replacement Return DC
 *   - Direct              : inward_outward ledger (courier/manual/ERP)
 *
 *  OUTWARD
 *   - Customer standard   : delivery_challan_lines outbound (dc_purpose standard)
 *   - Customer replacement: outbound DC with dc_purpose=replacement
 *   - Customer service    : outbound DC with dc_purpose=service_return
 *   - Vendor return       : vendor_repair_dc_items dispatched to vendor
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

const DETAIL_LIMIT = 5000;

const unitSql = `CASE
  WHEN COALESCE(jsonb_array_length(d.serial_number), 0) > 0 THEN jsonb_array_length(d.serial_number)
  ELSE COALESCE(d.quantity, 1)
END`;

/** Replacement return-DC join: pickup.return_dc_number → return challan with dc_purpose. */
const replacementReturnJoin = `
  LEFT JOIN LATERAL (
    SELECT dcl.dc_purpose
      FROM delivery_challan_lines dcl
     WHERE dcl.dc_number = i.return_dc_number
       AND COALESCE(dcl.movement_type, 'return') = 'return'
     ORDER BY dcl.id ASC
     LIMIT 1
  ) rdc ON true
`;

function isCustomerReplacementInwardSql() {
  return `(
    COALESCE(rdc.dc_purpose, '') = 'replacement'
    OR LOWER(COALESCE(t.ticket_category, '')) = 'replacement'
    OR LOWER(COALESCE(t.complaint_type, '')) = 'replacement'
  )`;
}

async function getInwardOutwardSummary({
  from = null, to = null, entity = '', branch = '', vendor = '', customer = '', courier = '', user = '',
} = {}) {
  const hasVendor = Boolean(vendor);
  const hasCustomer = Boolean(customer);
  const hasCourier = Boolean(courier);
  const hasUser = Boolean(user);
  const hasEntity = Boolean(entity);

  // --- INWARD: Vendor purchase (GRN) ---
  const vendorPurchaseInward = async () => {
    if (hasCustomer || hasCourier || hasUser) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM vendor_serial_numbers vsn
               JOIN vendor_purchase_orders po ON po.po_id = vsn.po_id
               WHERE vsn.deleted_at IS NULL AND vsn.spo_id IS NULL
                 AND COALESCE(vsn.extra->>'intake_source', '') <> 'vendor_repair_replacement'`;
    sql += dateClause('vsn.created_at', from, to, params);
    sql += eqNum('po.vendor_id', vendor, params);
    sql += eqText('vsn.current_entity', entity, params);
    return scalar(sql, params);
  };

  // --- INWARD: Vendor return (repaired unit back from VRDC) ---
  const vendorReturnInward = async () => {
    if (hasCustomer || hasEntity) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM vendor_repair_dc_items it
               JOIN vendor_repair_delivery_challans h ON h.dc_number = it.dc_number
               WHERE it.item_status = 'received'
                 AND COALESCE(it.receive_mode, 'repaired') = 'repaired'`;
    sql += dateClause('COALESCE(it.returned_at, h.updated_at, h.dispatched_at)', from, to, params);
    sql += eqNum('h.vendor_id', vendor, params);
    sql += ilike('h.courier_name', courier, params);
    sql += eqNum('h.created_by', user, params);
    return scalar(sql, params);
  };

  // --- INWARD: Vendor replacement ---
  const vendorReplacementInward = async () => {
    if (hasCustomer || hasEntity) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM vendor_repair_dc_items it
               JOIN vendor_repair_delivery_challans h ON h.dc_number = it.dc_number
               WHERE (
                 it.item_status = 'replacement_received'
                 OR COALESCE(it.receive_mode, '') = 'replacement'
               )`;
    sql += dateClause('COALESCE(it.returned_at, h.updated_at, h.dispatched_at)', from, to, params);
    sql += eqNum('h.vendor_id', vendor, params);
    sql += ilike('h.courier_name', courier, params);
    sql += eqNum('h.created_by', user, params);
    return scalar(sql, params);
  };

  // --- INWARD: Customer return (non-replacement pickups) ---
  const customerReturnInward = async () => {
    if (hasVendor) return 0;
    if (hasEntity) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM support_ticket_items i
               JOIN support_tickets t ON t.id = i.ticket_id
               ${replacementReturnJoin}
               WHERE i.item_type = 'pickup'
                 AND i.warehouse_received_at IS NOT NULL
                 AND COALESCE(i.pickup_type, 'return') IN ('return', 'repair')
                 AND NOT ${isCustomerReplacementInwardSql()}`;
    sql += dateClause('i.warehouse_received_at', from, to, params);
    sql += eqNum('t.customer_id', customer, params);
    sql += ilike('i.pickup_courier_name', courier, params);
    sql += eqNum('i.warehouse_received_by', user, params);
    return scalar(sql, params);
  };

  // --- INWARD: Customer replacement (old unit back) ---
  const customerReplacementInward = async () => {
    if (hasVendor || hasEntity) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM support_ticket_items i
               JOIN support_tickets t ON t.id = i.ticket_id
               ${replacementReturnJoin}
               WHERE i.item_type = 'pickup'
                 AND i.warehouse_received_at IS NOT NULL
                 AND ${isCustomerReplacementInwardSql()}`;
    sql += dateClause('i.warehouse_received_at', from, to, params);
    sql += eqNum('t.customer_id', customer, params);
    sql += ilike('i.pickup_courier_name', courier, params);
    sql += eqNum('i.warehouse_received_by', user, params);
    return scalar(sql, params);
  };

  // --- INWARD: Direct ---
  const directInward = async () => {
    if (hasEntity) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM inward_outward io
               WHERE io.io_type ILIKE 'inward%'`;
    sql += dateClause('io.created_at', from, to, params);
    sql += eqNum('io.vendor_id', vendor, params);
    sql += eqNum('io.customer_id', customer, params);
    sql += ilike('io.courier_name', courier, params);
    sql += eqNum('io.technician_id', user, params);
    return scalar(sql, params);
  };

  // --- OUTWARD: Customer by dc_purpose ---
  const customerOutwardByPurpose = async (purpose) => {
    if (hasVendor) return 0;
    const params = [];
    let sql = `SELECT COALESCE(SUM(${unitSql}), 0)::int AS n
               FROM delivery_challan_lines d
               WHERE COALESCE(d.movement_type, 'outbound') = 'outbound'
                 AND d.dispatched_at IS NOT NULL`;
    if (purpose === 'standard') {
      sql += ` AND COALESCE(NULLIF(TRIM(d.dc_purpose), ''), 'standard') = 'standard'`;
    } else {
      sql += eqText('d.dc_purpose', purpose, params);
    }
    sql += dateClause('d.dispatched_at', from, to, params);
    sql += eqText('d.entity_code', entity, params);
    sql += eqText('d.branch', branch, params);
    sql += eqNum('d.customer_id', customer, params);
    sql += ilike('d.courier_name', courier, params);
    sql += eqNum('d.created_by', user, params);
    return scalar(sql, params);
  };

  // --- OUTWARD: Vendor return (VRDC dispatch) ---
  const vendorReturnOutward = async () => {
    if (hasCustomer) return 0;
    if (hasEntity) return 0;
    const params = [];
    let sql = `SELECT COUNT(*)::int AS n
               FROM vendor_repair_dc_items it
               JOIN vendor_repair_delivery_challans h ON h.dc_number = it.dc_number
               WHERE h.dispatched_at IS NOT NULL`;
    sql += dateClause('h.dispatched_at', from, to, params);
    sql += eqNum('h.vendor_id', vendor, params);
    sql += ilike('h.courier_name', courier, params);
    sql += eqNum('h.created_by', user, params);
    return scalar(sql, params);
  };

  const [
    inVendorPurchase,
    inVendorReturn,
    inVendorReplacement,
    inCustomerReturn,
    inCustomerReplacement,
    inDirect,
    outCustomerStandard,
    outCustomerReplacement,
    outCustomerService,
    outVendorReturn,
  ] = await Promise.all([
    vendorPurchaseInward(),
    vendorReturnInward(),
    vendorReplacementInward(),
    customerReturnInward(),
    customerReplacementInward(),
    directInward(),
    customerOutwardByPurpose('standard'),
    customerOutwardByPurpose('replacement'),
    customerOutwardByPurpose('service_return'),
    vendorReturnOutward(),
  ]);

  const inVendor = inVendorPurchase + inVendorReturn + inVendorReplacement;
  const inCustomer = inCustomerReturn + inCustomerReplacement;
  const outCustomer = outCustomerStandard + outCustomerReplacement + outCustomerService;
  const outVendor = outVendorReturn;

  return {
    inward: {
      total: inVendor + inCustomer + inDirect,
      vendor: inVendor,
      vendor_purchase: inVendorPurchase,
      vendor_return: inVendorReturn,
      vendor_replacement: inVendorReplacement,
      customer: inCustomer,
      customer_return: inCustomerReturn,
      customer_replacement: inCustomerReplacement,
      direct: inDirect,
    },
    outward: {
      total: outCustomer + outVendor,
      customer: outCustomer,
      customer_standard: outCustomerStandard,
      customer_replacement: outCustomerReplacement,
      customer_service_return: outCustomerService,
      vendor: outVendor,
      vendor_return: outVendorReturn,
      vendor_replacement: 0,
    },
  };
}

async function getInwardOutwardDetails({
  type = 'inward_total',
  from = null, to = null, entity = '', branch = '', vendor = '', customer = '', courier = '', user = '',
} = {}) {
  const hasVendor = Boolean(vendor);
  const hasCustomer = Boolean(customer);
  const hasCourier = Boolean(courier);
  const hasUser = Boolean(user);
  const hasEntity = Boolean(entity);

  const rows = async (sql, params) => (await pool.query(sql, params)).rows;

  const vendorPurchaseInwardRows = async () => {
    if (hasCustomer || hasCourier || hasUser) return [];
    const params = [];
    let sql = `SELECT
        COALESCE(NULLIF(vsn.inventory_asset_code, ''), inv.machine_number) AS ttspl,
        vsn.serial_number AS serial_number,
        COALESCE(inv.brand, vsn.extra->>'brand') AS brand,
        COALESCE(inv.model, vsn.extra->>'model') AS model,
        COALESCE(inv.processor, vsn.extra->>'processor') AS processor,
        COALESCE(inv.generation, vsn.extra->>'generation') AS generation,
        COALESCE(inv.ram, vsn.extra->>'ram') AS ram,
        COALESCE(inv.storage, vsn.extra->>'storage', vsn.extra->>'ssd') AS storage,
        'Purchase / GRN'::text AS config_text,
        'vendor' AS party_type,
        ven.business_name AS party_name,
        vsn.created_at AS movement_date
      FROM vendor_serial_numbers vsn
      JOIN vendor_purchase_orders po ON po.po_id = vsn.po_id
      LEFT JOIN vendors ven ON ven.vendor_id = po.vendor_id
      LEFT JOIN inventory inv ON LOWER(inv.serial_number) = LOWER(vsn.serial_number)
      WHERE vsn.deleted_at IS NULL AND vsn.spo_id IS NULL
        AND COALESCE(vsn.extra->>'intake_source', '') <> 'vendor_repair_replacement'`;
    sql += dateClause('vsn.created_at', from, to, params);
    sql += eqNum('po.vendor_id', vendor, params);
    sql += eqText('vsn.current_entity', entity, params);
    sql += ` ORDER BY vsn.created_at DESC LIMIT ${DETAIL_LIMIT}`;
    return rows(sql, params);
  };

  const vendorRepairInwardRows = async ({ replacement }) => {
    if (hasCustomer || hasEntity) return [];
    const params = [];
    let sql = `SELECT
        COALESCE(
          NULLIF(CASE WHEN $REPL$ THEN it.replacement_ttspl_id ELSE it.ttspl_id END, ''),
          NULLIF(it.ttspl_id, ''),
          inv.machine_number
        ) AS ttspl,
        COALESCE(
          NULLIF(CASE WHEN $REPL$ THEN it.replacement_serial_number ELSE it.serial_number END, ''),
          it.serial_number
        ) AS serial_number,
        inv.brand AS brand,
        inv.model AS model,
        inv.processor AS processor,
        inv.generation AS generation,
        inv.ram AS ram,
        inv.storage AS storage,
        CASE WHEN $REPL$ THEN 'Vendor replacement'::text ELSE 'Vendor return (repaired)'::text END AS config_text,
        'vendor' AS party_type,
        COALESCE(h.vendor_name, ven.business_name) AS party_name,
        COALESCE(it.returned_at, h.updated_at, h.dispatched_at) AS movement_date
      FROM vendor_repair_dc_items it
      JOIN vendor_repair_delivery_challans h ON h.dc_number = it.dc_number
      LEFT JOIN vendors ven ON ven.vendor_id = h.vendor_id
      LEFT JOIN inventory inv ON LOWER(inv.serial_number) = LOWER(COALESCE(
        NULLIF(CASE WHEN $REPL$ THEN it.replacement_serial_number ELSE it.serial_number END, ''),
        it.serial_number
      ))
      WHERE ${replacement
    ? `(it.item_status = 'replacement_received' OR COALESCE(it.receive_mode, '') = 'replacement')`
    : `it.item_status = 'received' AND COALESCE(it.receive_mode, 'repaired') = 'repaired'`}`;
    sql = sql.replaceAll('$REPL$', replacement ? 'TRUE' : 'FALSE');
    sql += dateClause('COALESCE(it.returned_at, h.updated_at, h.dispatched_at)', from, to, params);
    sql += eqNum('h.vendor_id', vendor, params);
    sql += ilike('h.courier_name', courier, params);
    sql += eqNum('h.created_by', user, params);
    sql += ` ORDER BY COALESCE(it.returned_at, h.updated_at, h.dispatched_at) DESC LIMIT ${DETAIL_LIMIT}`;
    return rows(sql, params);
  };

  const customerPickupInwardRows = async ({ replacementOnly }) => {
    if (hasVendor || hasEntity) return [];
    const params = [];
    let sql = `SELECT
        COALESCE(i.ttspl_id, inv.machine_number) AS ttspl,
        i.serial_number AS serial_number,
        COALESCE(i.brand, inv.brand) AS brand,
        COALESCE(i.model, inv.model) AS model,
        inv.processor AS processor,
        COALESCE(i.generation, inv.generation) AS generation,
        COALESCE(i.ram, inv.ram) AS ram,
        COALESCE(i.storage, inv.storage) AS storage,
        CASE WHEN ${isCustomerReplacementInwardSql()}
          THEN 'Customer replacement'::text
          ELSE CONCAT('Customer ', COALESCE(i.pickup_type, 'return'))::text
        END AS config_text,
        'customer' AS party_type,
        t.customer_name AS party_name,
        i.warehouse_received_at AS movement_date
      FROM support_ticket_items i
      JOIN support_tickets t ON t.id = i.ticket_id
      ${replacementReturnJoin}
      LEFT JOIN inventory inv ON LOWER(inv.serial_number) = LOWER(i.serial_number)
      WHERE i.item_type = 'pickup'
        AND i.warehouse_received_at IS NOT NULL
        AND COALESCE(i.pickup_type, 'return') IN ('return', 'repair')
        AND ${replacementOnly ? isCustomerReplacementInwardSql() : `NOT ${isCustomerReplacementInwardSql()}`}`;
    sql += dateClause('i.warehouse_received_at', from, to, params);
    sql += eqNum('t.customer_id', customer, params);
    sql += ilike('i.pickup_courier_name', courier, params);
    sql += eqNum('i.warehouse_received_by', user, params);
    sql += ` ORDER BY i.warehouse_received_at DESC LIMIT ${DETAIL_LIMIT}`;
    return rows(sql, params);
  };

  const directInwardRows = async () => {
    if (hasEntity) return [];
    const params = [];
    let sql = `SELECT
        COALESCE(inv.machine_number, io.unique_number) AS ttspl,
        io.serial_number AS serial_number,
        inv.brand AS brand,
        inv.model AS model,
        inv.processor AS processor,
        inv.generation AS generation,
        inv.ram AS ram,
        inv.storage AS storage,
        NULLIF(io.purpose, '') AS config_text,
        CASE WHEN io.customer_id IS NOT NULL THEN 'customer'
             WHEN io.vendor_id IS NOT NULL THEN 'vendor'
             ELSE 'direct' END AS party_type,
        COALESCE(cust.name, ven.business_name, NULLIF(io.found_in, '')) AS party_name,
        io.created_at AS movement_date
      FROM inward_outward io
      LEFT JOIN inventory inv ON LOWER(inv.serial_number) = LOWER(io.serial_number)
      LEFT JOIN customers cust ON cust.customer_id = io.customer_id
      LEFT JOIN vendors ven ON ven.vendor_id = io.vendor_id
      WHERE io.io_type ILIKE 'inward%'`;
    sql += dateClause('io.created_at', from, to, params);
    sql += eqNum('io.vendor_id', vendor, params);
    sql += eqNum('io.customer_id', customer, params);
    sql += ilike('io.courier_name', courier, params);
    sql += eqNum('io.technician_id', user, params);
    sql += ` ORDER BY io.created_at DESC LIMIT ${DETAIL_LIMIT}`;
    return rows(sql, params);
  };

  const customerOutwardRows = async (purpose = null) => {
    if (hasVendor) return [];
    const params = [];
    let sql = `SELECT
        COALESCE(inv.machine_number, ser.ttspl_raw, ser.serial_clean) AS ttspl,
        COALESCE(inv.serial_number, ser.serial_clean) AS serial_number,
        COALESCE(inv.brand, d.brand) AS brand,
        COALESCE(inv.model, d.model_name) AS model,
        inv.processor AS processor,
        inv.generation AS generation,
        inv.ram AS ram,
        inv.storage AS storage,
        CONCAT('DC ', COALESCE(NULLIF(TRIM(d.dc_purpose), ''), 'standard'))::text AS config_text,
        'customer' AS party_type,
        d.customer_name AS party_name,
        d.dispatched_at AS movement_date
      FROM delivery_challan_lines d
      LEFT JOIN LATERAL (
        SELECT
          CASE WHEN elem LIKE '%|%' THEN split_part(elem, '|', 2) ELSE elem END AS serial_clean,
          (regexp_match(elem, 'TTSPL[0-9]+', 'i'))[1] AS ttspl_raw
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(d.serial_number) = 'array' THEN d.serial_number ELSE '[]'::jsonb END
        ) elem
      ) ser ON true
      LEFT JOIN inventory inv
        ON LOWER(inv.serial_number) = LOWER(ser.serial_clean)
        OR (ser.ttspl_raw IS NOT NULL AND UPPER(inv.machine_number) = UPPER(ser.ttspl_raw))
      WHERE COALESCE(d.movement_type, 'outbound') = 'outbound'
        AND d.dispatched_at IS NOT NULL`;
    if (purpose === 'standard') {
      sql += ` AND COALESCE(NULLIF(TRIM(d.dc_purpose), ''), 'standard') = 'standard'`;
    } else if (purpose) {
      sql += eqText('d.dc_purpose', purpose, params);
    }
    sql += dateClause('d.dispatched_at', from, to, params);
    sql += eqText('d.entity_code', entity, params);
    sql += eqText('d.branch', branch, params);
    sql += eqNum('d.customer_id', customer, params);
    sql += ilike('d.courier_name', courier, params);
    sql += eqNum('d.created_by', user, params);
    sql += ` ORDER BY d.dispatched_at DESC LIMIT ${DETAIL_LIMIT}`;
    return rows(sql, params);
  };

  const vendorOutwardRows = async () => {
    if (hasCustomer || hasEntity) return [];
    const params = [];
    let sql = `SELECT
        COALESCE(NULLIF(it.ttspl_id, ''), inv.machine_number) AS ttspl,
        it.serial_number AS serial_number,
        inv.brand AS brand,
        inv.model AS model,
        inv.processor AS processor,
        inv.generation AS generation,
        inv.ram AS ram,
        inv.storage AS storage,
        COALESCE(NULLIF(it.configuration, ''), 'Vendor return / repair')::text AS config_text,
        'vendor' AS party_type,
        COALESCE(h.vendor_name, ven.business_name) AS party_name,
        h.dispatched_at AS movement_date
      FROM vendor_repair_dc_items it
      JOIN vendor_repair_delivery_challans h ON h.dc_number = it.dc_number
      LEFT JOIN vendors ven ON ven.vendor_id = h.vendor_id
      LEFT JOIN inventory inv ON LOWER(inv.serial_number) = LOWER(it.serial_number)
      WHERE h.dispatched_at IS NOT NULL`;
    sql += dateClause('h.dispatched_at', from, to, params);
    sql += eqNum('h.vendor_id', vendor, params);
    sql += ilike('h.courier_name', courier, params);
    sql += eqNum('h.created_by', user, params);
    sql += ` ORDER BY h.dispatched_at DESC LIMIT ${DETAIL_LIMIT}`;
    return rows(sql, params);
  };

  const byDateDesc = (list) => list.sort((a, b) => {
    const da = a.movement_date ? new Date(a.movement_date).getTime() : 0;
    const db = b.movement_date ? new Date(b.movement_date).getTime() : 0;
    return db - da;
  });

  switch (type) {
    case 'inward_vendor':
    case 'inward_vendor_purchase':
      return type === 'inward_vendor'
        ? byDateDesc([
          ...(await vendorPurchaseInwardRows()),
          ...(await vendorRepairInwardRows({ replacement: false })),
          ...(await vendorRepairInwardRows({ replacement: true })),
        ])
        : vendorPurchaseInwardRows();
    case 'inward_vendor_return':
      return vendorRepairInwardRows({ replacement: false });
    case 'inward_vendor_replacement':
      return vendorRepairInwardRows({ replacement: true });
    case 'inward_customer':
      return byDateDesc([
        ...(await customerPickupInwardRows({ replacementOnly: false })),
        ...(await customerPickupInwardRows({ replacementOnly: true })),
      ]);
    case 'inward_customer_return':
      return customerPickupInwardRows({ replacementOnly: false });
    case 'inward_customer_replacement':
      return customerPickupInwardRows({ replacementOnly: true });
    case 'inward_direct':
      return directInwardRows();
    case 'inward_total': {
      const [a, b, c, d, e, f] = await Promise.all([
        vendorPurchaseInwardRows(),
        vendorRepairInwardRows({ replacement: false }),
        vendorRepairInwardRows({ replacement: true }),
        customerPickupInwardRows({ replacementOnly: false }),
        customerPickupInwardRows({ replacementOnly: true }),
        directInwardRows(),
      ]);
      return byDateDesc([...a, ...b, ...c, ...d, ...e, ...f]);
    }
    case 'outward_customer':
      return customerOutwardRows(null);
    case 'outward_customer_standard':
      return customerOutwardRows('standard');
    case 'outward_customer_replacement':
      return customerOutwardRows('replacement');
    case 'outward_customer_service_return':
      return customerOutwardRows('service_return');
    case 'outward_vendor':
    case 'outward_vendor_return':
      return vendorOutwardRows();
    case 'outward_vendor_replacement':
      return [];
    case 'outward_total': {
      const [a, b] = await Promise.all([customerOutwardRows(null), vendorOutwardRows()]);
      return byDateDesc([...a, ...b]);
    }
    default:
      return [];
  }
}

async function getInwardOutwardFilters({ from = null, to = null } = {}) {
  const scoped = Boolean(from && to);

  const customerParams = [];
  const customerSql = scoped
    ? `SELECT DISTINCT customer_id, customer_name FROM (
         SELECT d.customer_id, d.customer_name
           FROM delivery_challan_lines d
          WHERE d.customer_id IS NOT NULL
            AND COALESCE(d.movement_type, 'outbound') = 'outbound'
            AND d.dispatched_at IS NOT NULL
            ${dateClause('d.dispatched_at', from, to, customerParams)}
         UNION
         SELECT t.customer_id, t.customer_name
           FROM support_ticket_items i
           JOIN support_tickets t ON t.id = i.ticket_id
          WHERE t.customer_id IS NOT NULL
            AND i.item_type = 'pickup'
            AND i.warehouse_received_at IS NOT NULL
            ${dateClause('i.warehouse_received_at', from, to, customerParams)}
         UNION
         SELECT io.customer_id,
                COALESCE(c.company_name, c.name, '') AS customer_name
           FROM inward_outward io
           LEFT JOIN customers c ON c.customer_id = io.customer_id
          WHERE io.customer_id IS NOT NULL
            ${dateClause('io.created_at', from, to, customerParams)}
       ) c
       WHERE COALESCE(customer_name, '') <> ''
       ORDER BY customer_name
       LIMIT 1000`
    : `SELECT DISTINCT customer_id, customer_name FROM (
         SELECT customer_id, customer_name FROM delivery_challan_lines WHERE customer_id IS NOT NULL
         UNION
         SELECT customer_id, customer_name FROM support_tickets WHERE customer_id IS NOT NULL
       ) c
       WHERE COALESCE(customer_name, '') <> ''
       ORDER BY customer_name
       LIMIT 1000`;

  const vendorParams = [];
  const vendorSql = scoped
    ? `SELECT DISTINCT v.vendor_id, v.business_name FROM (
         SELECT po.vendor_id
           FROM vendor_serial_numbers vsn
           JOIN vendor_purchase_orders po ON po.po_id = vsn.po_id
          WHERE vsn.deleted_at IS NULL AND vsn.spo_id IS NULL
            ${dateClause('vsn.created_at', from, to, vendorParams)}
         UNION
         SELECT h.vendor_id
           FROM vendor_repair_dc_items it
           JOIN vendor_repair_delivery_challans h ON h.dc_number = it.dc_number
          WHERE h.vendor_id IS NOT NULL
            ${dateClause('COALESCE(it.returned_at, h.updated_at, h.dispatched_at)', from, to, vendorParams)}
         UNION
         SELECT io.vendor_id
           FROM inward_outward io
          WHERE io.vendor_id IS NOT NULL
            ${dateClause('io.created_at', from, to, vendorParams)}
       ) x
       JOIN vendors v ON v.vendor_id = x.vendor_id
      WHERE v.deleted_at IS NULL AND COALESCE(v.business_name, '') <> ''
      ORDER BY v.business_name
      LIMIT 1000`
    : `SELECT vendor_id, business_name FROM vendors
       WHERE deleted_at IS NULL AND COALESCE(business_name, '') <> ''
       ORDER BY business_name`;

  const [entities, vendors, customers, couriers, users] = await Promise.all([
    pool.query(`SELECT code, legal_name FROM companies WHERE active IS DISTINCT FROM false ORDER BY code`),
    pool.query(vendorSql, vendorParams),
    pool.query(customerSql, customerParams),
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

module.exports = { getInwardOutwardSummary, getInwardOutwardDetails, getInwardOutwardFilters };
