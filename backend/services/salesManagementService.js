const crypto = require('crypto');
const pool = require('../config/db');
const { resolveLineItem } = require('./qcManagementService');

const DOC_TYPES = {
  quotation: { prefix: 'EST-', pad: 6 },
  sales_order: { prefix: 'SO-', pad: 6 },
  delivery_challan: { prefix: 'DC-', pad: 6 },
  return_dc: { prefix: 'RDC', pad: 6 },
};

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
       (SELECT COALESCE(SUM(quantity), 0) FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS remaining_qty
     FROM (
       SELECT DISTINCT ON (sales_order_number)
         id, sales_order_number, quotation_number, customer_id, customer_name, gst_number,
         pdf_path, created_at
       FROM sales_order_lines
       ${where}
       ORDER BY sales_order_number, id DESC
     ) g
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
    `SELECT * FROM delivery_challan_lines WHERE dc_number = $1 ORDER BY id ASC`,
    [dcNumber]
  );
  return result.rows;
}

/** Return DC list from support tickets */
async function listReturnDeliveryChallans() {
  const result = await pool.query(
    `SELECT
       st.id AS ticket_id,
       st.return_dc_number,
       COALESCE(st.serial_number, sti.serial_number) AS serial_number,
       COALESCE(st.unique_number, sti.unique_serial_number) AS unique_number,
       st.status AS ticket_status,
       st.complaint_type,
       st.closed_at,
       st.customer_name,
       sti.pod_uploaded_at AS pod_closed_at
     FROM support_tickets st
     LEFT JOIN LATERAL (
       SELECT serial_number, unique_serial_number, pod_uploaded_at
       FROM support_ticket_items
       WHERE ticket_id = st.id
       ORDER BY id ASC
       LIMIT 1
     ) sti ON true
     WHERE st.return_dc_number IS NOT NULL
     ORDER BY st.closed_at DESC NULLS LAST, st.updated_at DESC
     LIMIT 500`
  );
  return result.rows;
}

async function getOperationCounts() {
  const [q, so, dc, rdc] = await Promise.all([
    pool.query(`SELECT COUNT(DISTINCT quotation_number)::int AS c FROM sales_quotations`),
    pool.query(`SELECT COUNT(DISTINCT sales_order_number)::int AS c FROM sales_order_lines`),
    pool.query(`SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines`),
    pool.query(`SELECT COUNT(*)::int AS c FROM support_tickets WHERE return_dc_number IS NOT NULL`),
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
    status: row.inventory_status || row.status || 'in_stock',
    picker_value: formatted,
    formatted_serial: formatted,
    label: `${serialNumber} | ${uniqueNumber}`,
  };
}

function filterSpecRows(rows, { model_name, processor, generation, isSale }) {
  const model = model_name?.trim();
  if (!model) return [];

  return rows.filter((row) => {
    const pdModel = row.pd_model || row.product_model_name || '';

    if (isSale) {
      if (!partialSpecMatch(pdModel, model) && !partialSpecMatch(row.product_model_name, model)) return false;
      if (!partialSpecMatch(row.processor, processor)) return false;
      if (!partialSpecMatch(row.generation, generation)) return false;
      if (!row.po_id) return false;
      return true;
    }

    if (!exactSpecMatch(pdModel, model) && !exactSpecMatch(row.product_model_name, model)) return false;
    if (!exactSpecMatch(row.processor, processor)) return false;
    if (!exactSpecMatch(row.generation, generation)) return false;
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
  quotation_type,
  search,
  limit = 200,
}) {
  const model = model_name?.trim();
  if (!model) return [];

  const qt = String(quotation_type || '').toLowerCase();
  const isSale = qt === 'sale';

  const params = [model.toLowerCase()];
  let searchSql = '';
  if (search) {
    params.push(`%${search}%`);
    searchSql = ` AND (
      vpi.serial_number ILIKE $${params.length}
      OR COALESCE(vpi.unique_product_serial, '') ILIKE $${params.length}
      OR COALESCE(vsn.inventory_asset_code, '') ILIKE $${params.length}
    )`;
  }

  const result = await pool.query(
    `SELECT
       vpi.id AS inventory_row_id,
       vpi.serial_id,
       vpi.serial_number,
       vpi.unique_product_serial,
       vpi.product_model_name,
       vpi.product_id,
       vpi.status AS inventory_status,
       vpd.model AS pd_model,
       vpd.processor,
       vpd.generation,
       vpd.brand,
       vsn.po_id,
       vsn.inventory_asset_code,
       vpo.purchase_order_type
     FROM vendor_product_inventory vpi
     INNER JOIN vendor_serial_numbers vsn
       ON vsn.serial_id = vpi.serial_id AND vsn.deleted_at IS NULL
     LEFT JOIN vendor_product_details vpd
       ON vpd.product_detail_id = vpi.product_id
     LEFT JOIN vendor_purchase_orders vpo
       ON vpo.po_id = vsn.po_id AND vpo.deleted_at IS NULL
     WHERE vpi.status = 'in_stock'
       AND LOWER(vpi.product_model_name) = $1
       ${searchSql}
     ORDER BY vpi.id DESC
     LIMIT ${Math.min(Number(limit) || 200, 500)}`,
    params
  );

  let rows = filterSpecRows(result.rows, { model_name: model, processor, generation, isSale });

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
          brand: line?.brand ?? row.brand ?? '',
          po_id: row.po_id,
          inventory_asset_code: row.inventory_asset_code,
          status: 'in_stock',
        };
      })
      .filter((row) => {
        const hay = String(row.product_model_name || row.pd_model || '').toLowerCase();
        return hay === model.toLowerCase() || (isSale && hay.includes(model.toLowerCase()));
      });

    rows = filterSpecRows(rows, { model_name: model, processor, generation, isSale });
  }

  if (brand) {
    const b = brand.toLowerCase();
    rows = rows.filter((r) => !r.brand || String(r.brand).toLowerCase().includes(b));
  }

  return rows.map(mapInventorySerialRow);
}

module.exports = {
  nextDocumentNumber,
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
