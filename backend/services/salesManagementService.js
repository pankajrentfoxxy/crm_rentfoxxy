const crypto = require('crypto');
const pool = require('../config/db');
const { resolveLineItem } = require('./qcManagementService');
const columnExistsCache = new Map();

const DOC_TYPES = {
  quotation: { prefix: 'EST-', pad: 6 },
  sales_order: { prefix: 'SO-', pad: 6 },
  delivery_challan: { prefix: 'DC-', pad: 6 },
  return_dc: { prefix: 'RDC', pad: 6 },
  // Per-entity sequences (migration 074). Rental/Demo -> rentfoxxy, Sales -> gorefurbo.
  quote_rentfoxxy: { prefix: 'EST-', pad: 6 },
  quote_gorefurbo: { prefix: 'GEST-', pad: 6 },
  so_rentfoxxy: { prefix: 'SO-', pad: 6 },
  so_gorefurbo: { prefix: 'GSO-', pad: 6 },
  dc_rentfoxxy: { prefix: 'DC-', pad: 6 },
  dc_gorefurbo: { prefix: 'GDC-', pad: 6 },
  invoice_rentfoxxy: { prefix: 'INV-', pad: 4 },
  invoice_gorefurbo: { prefix: 'GINV-', pad: 4 },
};

// Rental + Demo bill/dispatch under Rentfoxxy; Sales under Gorefurbo.
// Accept both 'sale' and 'sales' (the UI uses 'sale').
function entityForQuotationType(quotationType) {
  const t = String(quotationType || 'rental').toLowerCase();
  return (t === 'sales' || t === 'sale') ? 'gorefurbo' : 'rentfoxxy';
}

// Resolve an entity-scoped doc type, e.g. ('delivery_challan','gorefurbo') -> 'dc_gorefurbo'.
function entityDocType(base, entityCode) {
  const map = { quotation: 'quote', sales_order: 'so', delivery_challan: 'dc', customer_invoice: 'invoice' };
  const key = map[base] || base;
  const entity = entityCode === 'gorefurbo' ? 'gorefurbo' : 'rentfoxxy';
  const docType = `${key}_${entity}`;
  return DOC_TYPES[docType] ? docType : base; // fall back to shared sequence if unknown
}

async function nextDocumentNumber(docType) {
  const meta = DOC_TYPES[docType];
  if (!meta) throw new Error(`Unknown document type: ${docType}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seq = await client.query(
      `SELECT last_value, prefix FROM sm_document_sequences WHERE doc_type = $1 FOR UPDATE`,
      [docType]
    );
    let lastValue = 1;
    let prefix = meta.prefix;
    if (seq.rows.length) {
      lastValue = Number(seq.rows[0].last_value) + 1;
      prefix = seq.rows[0].prefix || meta.prefix;
      await client.query(
        `UPDATE sm_document_sequences SET last_value = $1, updated_at = NOW() WHERE doc_type = $2`,
        [lastValue, docType]
      );
    } else {
      await client.query(
        `INSERT INTO sm_document_sequences (doc_type, last_value, prefix) VALUES ($1, 1, $2)`,
        [docType, meta.prefix]
      );
    }
    await client.query('COMMIT');
    const padded = String(lastValue).padStart(meta.pad, '0');
    return docType === 'return_dc' ? `${prefix}${padded}` : `${prefix}${padded}`;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

async function getQuotationRemainingQty(quotationNumber) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS qty FROM sales_quotations WHERE quotation_number = $1`,
    [quotationNumber]
  );
  return result.rows[0]?.qty || 0;
}

async function getSalesOrderRemainingQty(salesOrderNumber) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS qty FROM sales_order_lines WHERE sales_order_number = $1`,
    [salesOrderNumber]
  );
  return result.rows[0]?.qty || 0;
}

async function tableColumnExists(tableName, columnName) {
  const cacheKey = `${tableName}.${columnName}`;
  if (columnExistsCache.has(cacheKey)) return columnExistsCache.get(cacheKey);
  const result = await pool.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1`,
    [tableName, columnName]
  );
  const exists = result.rows.length > 0;
  columnExistsCache.set(cacheKey, exists);
  return exists;
}

async function listQuotationsGrouped({ page = 1, limit = 20, search = '', status, source_lead_id }) {
  const params = [];
  const conditions = [];
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(quotation_number ILIKE $${params.length} OR customer_name ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (source_lead_id) {
    params.push(Number(source_lead_id));
    conditions.push(`source_lead_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT quotation_number)::int AS total FROM sales_quotations ${where}`,
    params
  );

  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];
  const listResult = await pool.query(
    `SELECT g.*,
       (SELECT COALESCE(SUM(quantity), 0) FROM sales_quotations sq WHERE sq.quotation_number = g.quotation_number) AS remaining_qty
     FROM (
       SELECT DISTINCT ON (quotation_number)
         quotation_number, customer_id, customer_name, gst_number, status, quotation_type,
         pdf_path, status_updated_by_id, status_updated_by_name, created_at, updated_at, source_lead_id
       FROM sales_quotations
       ${where}
       ORDER BY quotation_number, updated_at DESC
     ) g
     ORDER BY g.updated_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return {
    quotations: listResult.rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
      totalPages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
    },
  };
}

async function getQuotationLines(quotationNumber) {
  const result = await pool.query(
    `SELECT * FROM sales_quotations WHERE quotation_number = $1 ORDER BY id ASC`,
    [quotationNumber]
  );
  return result.rows;
}

async function listSalesOrdersGrouped({ page = 1, limit = 20, search = '' }) {
  const hasEntityCode = await tableColumnExists('sales_order_lines', 'entity_code');
  const entitySelect = hasEntityCode ? 'entity_code' : `'rentfoxxy' AS entity_code`;
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE sales_order_number ILIKE $1 OR customer_name ILIKE $1 OR gst_number ILIKE $1`;
  }
  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT sales_order_number)::int AS total FROM sales_order_lines ${where}`,
    params
  );
  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];
  const listResult = await pool.query(
    `SELECT g.*,
       COALESCE(NULLIF(g.customer_name, ''), c.company_name, c.name) AS customer_name,
       (SELECT COALESCE(SUM(quantity), 0) FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS remaining_qty,
       (SELECT COALESCE(SUM(COALESCE(rate,0) * COALESCE(quantity,0)), 0) FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS total_value,
       (SELECT COALESCE(SUM(COALESCE(rate,0) * COALESCE(quantity,0)), 0) FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS total_amount,
       (SELECT COUNT(DISTINCT dcl.dc_number) FROM delivery_challan_lines dcl WHERE dcl.sales_order_number = g.sales_order_number) AS dc_count
     FROM (
       SELECT DISTINCT ON (sales_order_number)
         id, sales_order_number, quotation_number, customer_id, customer_name, gst_number,
        quotation_type, ${entitySelect}, pdf_path, created_at
       FROM sales_order_lines
       ${where}
       ORDER BY sales_order_number, id DESC
     ) g
     LEFT JOIN customers c ON c.customer_id = g.customer_id
     ORDER BY g.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  return {
    sales_orders: listResult.rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
      totalPages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
    },
  };
}

async function getSalesOrderLines(salesOrderNumber) {
  const result = await pool.query(
    `SELECT * FROM sales_order_lines WHERE sales_order_number = $1 ORDER BY id ASC`,
    [salesOrderNumber]
  );
  return result.rows;
}

async function listDeliveryChallansGrouped({ page = 1, limit = 20, search = '' }) {
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE d.dc_number ILIKE $1 OR d.sales_order_number ILIKE $1 OR d.customer_name ILIKE $1 OR d.gst_number ILIKE $1`;
  }
  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT dc_number)::int AS total FROM delivery_challan_lines d ${where}`,
    params
  );
  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];
  const listResult = await pool.query(
    `SELECT g.*,
       COALESCE(u.name, u.email, '') AS delivery_person_name
     FROM (
       SELECT DISTINCT ON (d.dc_number)
         d.id, d.dc_number, d.sales_order_number, d.quotation_number, d.customer_id, d.customer_name,
         d.gst_number, d.status, d.pdf_path, d.file_path, d.ship_by, d.delivery_person_id,
         d.courier_name, d.awb_number, d.created_at, d.updated_at
       FROM delivery_challan_lines d
       ${where}
       ORDER BY d.dc_number, d.id DESC
     ) g
     LEFT JOIN users u ON u.user_id = g.delivery_person_id
     ORDER BY g.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  return {
    delivery_challans: listResult.rows,
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
      totalPages: Math.ceil((countResult.rows[0]?.total || 0) / limit),
    },
  };
}

async function getDeliveryChallanLines(dcNumber) {
  const result = await pool.query(
    `SELECT dcl.*,
       COALESCE(NULLIF(TRIM(dt.first_name || ' ' || COALESCE(dt.last_name, '')), ''), u.name) AS delivery_person_name,
       COALESCE(dt.phone, u.mobile_no) AS delivery_person_phone,
       dt.email AS delivery_person_email
     FROM delivery_challan_lines dcl
     LEFT JOIN delivery_technicians dt ON dt.technician_id = dcl.delivery_person_id
     LEFT JOIN users u ON u.user_id = COALESCE(dt.user_id, dcl.delivery_person_id)
     WHERE dcl.dc_number = $1
     ORDER BY dcl.id ASC`,
    [dcNumber]
  );
  return result.rows;
}

/** Return DC list — sourced from the actual Return DC rows
 *  (delivery_challan_lines with movement_type='return'), one row per RDC. */
async function listReturnDeliveryChallans() {
  const result = await pool.query(
    `SELECT
       rl.dc_number              AS return_dc_number,
       rl.dc_number              AS rdc_number,
       rl.support_ticket_id      AS ticket_id,
       rl.customer_id,
       rl.customer_name,
       rl.serial_number,
       rl.brand,
       rl.model_name,
       rl.status,
       rl.created_at,
       COALESCE(rl.dispatched_at, rl.created_at) AS dispatched_at,
       rl.delivered_at,
       COALESCE(st.dc_number, vsn.current_dc_number) AS original_dc_number,
       COALESCE(st.complaint_type, sti.pickup_type, 'return') AS reason,
       sti.pickup_type,
       COALESCE(sti.ttspl_id, vsn.inventory_asset_code, NULLIF(split_part(rl.serial_number->>0, '|', 3), '')) AS ttspl_id
     FROM delivery_challan_lines rl
     LEFT JOIN support_tickets st ON st.id = rl.support_ticket_id
     LEFT JOIN LATERAL (
       SELECT pickup_type, ttspl_id, unique_serial_number, serial_number
       FROM support_ticket_items
       WHERE return_dc_number = rl.dc_number AND item_type = 'pickup'
       ORDER BY id DESC
       LIMIT 1
     ) sti ON true
     LEFT JOIN LATERAL (
       SELECT v.inventory_asset_code, v.current_dc_number
       FROM vendor_serial_numbers v
       WHERE v.deleted_at IS NULL
         AND (
           (sti.ttspl_id IS NOT NULL AND v.inventory_asset_code = sti.ttspl_id)
           OR (sti.serial_number IS NOT NULL AND v.serial_number = sti.serial_number)
           OR v.inventory_asset_code = NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
           OR v.serial_number = NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
         )
       LIMIT 1
     ) vsn ON true
     WHERE rl.movement_type = 'return'
     ORDER BY rl.created_at DESC NULLS LAST
     LIMIT 500`
  );
  return result.rows;
}

async function getOperationCounts() {
  const [q, so, dc, rdc] = await Promise.all([
    pool.query(`SELECT COUNT(DISTINCT quotation_number)::int AS c FROM sales_quotations`),
    pool.query(`SELECT COUNT(DISTINCT sales_order_number)::int AS c FROM sales_order_lines`),
    pool.query(`SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines WHERE COALESCE(movement_type, 'outbound') = 'outbound'`),
    pool.query(`SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines WHERE movement_type = 'return'`),
  ]);
  return {
    quotations: q.rows[0]?.c || 0,
    sales_orders: so.rows[0]?.c || 0,
    delivery_challans: dc.rows[0]?.c || 0,
    return_dc: rdc.rows[0]?.c || 0,
  };
}

function partialSpecMatch(dbValue, inputValue) {
  if (!inputValue) return true;
  return String(dbValue || '').toLowerCase().includes(String(inputValue).toLowerCase());
}

function exactSpecMatch(dbValue, inputValue) {
  if (!inputValue) return true;
  return String(dbValue || '').toLowerCase() === String(inputValue).toLowerCase();
}

function mapInventorySerialRow(row) {
  const serialId = row.serial_id;
  const serialNumber = row.serial_number || '';
  const uniqueNumber =
    row.unique_product_serial ||
    row.inventory_asset_code ||
    row.unique_number ||
    'N/A';
  const formatted =
    serialId && serialNumber
      ? `${serialId}|${serialNumber}|${uniqueNumber}`
      : 'N/A';

  return {
    id: row.inventory_row_id || serialId,
    serial_id: serialId,
    serial_number: serialNumber,
    unique_number: uniqueNumber,
    unique_product_serial: uniqueNumber,
    product_model_name: row.product_model_name || row.pd_model || row.model_name,
    brand: row.brand || '',
    model: row.pd_model || row.product_model_name || '',
    processor: row.processor || '',
    generation: row.generation || '',
    ram: row.ram || '',
    storage: row.storage || '',
    status: row.inventory_status || row.status || 'in_stock',
    picker_value: formatted,
    formatted_serial: formatted,
    label: `${serialNumber} | ${uniqueNumber}`,
  };
}

function filterSpecRows(rows, { model_name, processor, generation, ram, storage, isSale }) {
  // Model is OPTIONAL (Phase 14): when provided it must match, otherwise we match
  // purely on processor + generation + RAM + storage so equivalent laptops with
  // a different model label still surface.
  const model = model_name?.trim();
  const matchFn = isSale ? partialSpecMatch : exactSpecMatch;

  return rows.filter((row) => {
    const pdModel = row.pd_model || row.product_model_name || '';

    if (model) {
      if (!matchFn(pdModel, model) && !matchFn(row.product_model_name, model)) return false;
    }
    if (!matchFn(row.processor, processor)) return false;
    if (!matchFn(row.generation, generation)) return false;
    if (!matchFn(row.ram, ram)) return false;
    if (!matchFn(row.storage, storage)) return false;
    if (isSale && !row.po_id) return false;
    return true;
  });
}

/**
 * Laravel getAllProductFromInventoryUsingModelIfSaleNew / getAllProductFromInventoryUsingModelNew
 * — vendor_product_inventory (in_stock) + product_details specs + serial_numbers unique code.
 */
async function searchAvailableInventory({
  brand,
  model_name,
  processor,
  generation,
  ram,
  storage,
  quotation_type,
  search,
  limit = 200,
}) {
  // Phase 14: model is no longer mandatory — match by specs even without a model.
  const model = model_name?.trim();

  const qt = String(quotation_type || '').toLowerCase();
  const isSale = qt === 'sale' || qt === 'sales';

  const params = [];
  let searchSql = '';
  if (search) {
    params.push(`%${search}%`);
    searchSql = ` AND (
      vsn.serial_number ILIKE $${params.length}
      OR COALESCE(vsn.inventory_asset_code, '') ILIKE $${params.length}
      OR COALESCE(vsn.extra->>'ttspl_id', '') ILIKE $${params.length}
    )`;
  }

  // Single authoritative source: vendor_serial_numbers (QC-passed + in_stock)
  // enriched with vendor_product_details specs. Anything procured and received
  // becomes selectable here automatically — no separate catalog/vpi table, so
  // status can no longer drift (the legacy vendor_product_inventory is bypassed).
  const result = await pool.query(
    `SELECT
       vsn.serial_id AS inventory_row_id,
       vsn.serial_id,
       vsn.serial_number,
       vsn.inventory_asset_code AS unique_product_serial,
       vsn.inventory_asset_code,
       vsn.po_id,
       vsn.inventory_status,
       COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
       COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS pd_model,
       COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS product_model_name,
       COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
       COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
       COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
       COALESCE(vsn.extra->>'storage', vpd.storage) AS storage,
       vpo.purchase_order_type
     FROM vendor_serial_numbers vsn
     LEFT JOIN vendor_product_details vpd
       ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
     LEFT JOIN vendor_purchase_orders vpo
       ON vpo.po_id = vsn.po_id AND vpo.deleted_at IS NULL
     WHERE vsn.deleted_at IS NULL
       AND COALESCE(vsn.qc_status, vsn.extra->>'status', 'pending') = 'passed'
       AND COALESCE(vsn.inventory_status, 'in_stock') = 'in_stock'
       ${searchSql}
     ORDER BY vsn.serial_id DESC
     LIMIT ${Math.min(Number(limit) || 200, 500)}`,
    params
  );

  let rows = filterSpecRows(result.rows, { model_name: model, processor, generation, ram, storage, isSale });

  if (!rows.length) {
    const fallback = await pool.query(
      `SELECT
         vsn.serial_id,
         vsn.serial_number,
         vsn.po_id,
         vsn.inventory_asset_code,
         vsn.qc_status,
         vsn.inventory_status,
         vsn.extra,
         p.line_items,
         p.purchase_order_type,
         vpd.model AS pd_model,
         vpd.processor,
         vpd.generation,
         vpd.ram,
         vpd.storage,
         vpd.brand
       FROM vendor_serial_numbers vsn
       INNER JOIN vendor_purchase_orders p ON p.po_id = vsn.po_id AND p.deleted_at IS NULL
       LEFT JOIN vendor_product_details vpd
         ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
       WHERE vsn.deleted_at IS NULL
         AND COALESCE(vsn.qc_status, vsn.extra->>'status', 'pending') = 'passed'
         AND COALESCE(vsn.inventory_status, 'in_stock') IN ('in_stock', 'passed')
         AND NOT EXISTS (
           SELECT 1 FROM vendor_product_inventory vpi2
           WHERE vpi2.serial_id = vsn.serial_id AND vpi2.status = 'out_stock'
         )
       ORDER BY vsn.serial_id DESC
       LIMIT 500`
    );

    rows = fallback.rows
      .map((row) => {
        const line = resolveLineItem(row.line_items, row.extra);
        return {
          inventory_row_id: row.serial_id,
          serial_id: row.serial_id,
          serial_number: row.serial_number,
          unique_product_serial: row.inventory_asset_code || row.extra?.unique_product_serial,
          product_model_name: line?.model ?? line?.product_name ?? line?.model_name ?? '',
          pd_model: line?.model ?? line?.product_name ?? row.pd_model,
          processor: line?.processor ?? row.processor ?? '',
          generation: line?.generation ?? row.generation ?? '',
          ram: line?.ram ?? row.ram ?? '',
          storage: line?.storage ?? row.storage ?? '',
          brand: line?.brand ?? row.brand ?? '',
          po_id: row.po_id,
          inventory_asset_code: row.inventory_asset_code,
          status: 'in_stock',
        };
      })
      .filter((row) => {
        if (!model) return true;
        const hay = String(row.product_model_name || row.pd_model || '').toLowerCase();
        return hay === model.toLowerCase() || (isSale && hay.includes(model.toLowerCase()));
      });

    rows = filterSpecRows(rows, { model_name: model, processor, generation, ram, storage, isSale });
  }

  if (brand) {
    const b = brand.toLowerCase();
    rows = rows.filter((r) => !r.brand || String(r.brand).toLowerCase().includes(b));
  }

  return rows.map(mapInventorySerialRow);
}

module.exports = {
  nextDocumentNumber,
  entityForQuotationType,
  entityDocType,
  generateToken,
  getQuotationRemainingQty,
  getSalesOrderRemainingQty,
  listQuotationsGrouped,
  getQuotationLines,
  listSalesOrdersGrouped,
  getSalesOrderLines,
  listDeliveryChallansGrouped,
  getDeliveryChallanLines,
  listReturnDeliveryChallans,
  getOperationCounts,
  searchAvailableInventory,
};
