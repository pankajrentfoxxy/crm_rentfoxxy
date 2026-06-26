const crypto = require('crypto');
const pool = require('../config/db');
const { regenerateStaleReturnDcPdfs } = require('./returnDcPdfService');
const { resolveLineItem } = require('./qcManagementService');
const { parseJsonArray } = require('./deliveryRegisterService');
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

// Financial-year document numbers: SO/26-27/0779 and DC/26-27/0778.
// Indian FY runs Apr 1 -> Mar 31. The sequence is stored in
// sm_document_sequences.last_value encoded as (fyCode * 10000 + seq), e.g.
// 26270779 == FY 26-27, seq 0779. The seq is reconciled against the actual
// data max on each allocation so it always continues from the latest record
// (including the ERP-migrated SO/DC numbers) and resets when the FY rolls over.
const FY_DOC_TYPES = {
  sales_order: { docType: 'so_rentfoxxy', prefix: 'SO', table: 'sales_order_lines', column: 'sales_order_number' },
  delivery_challan: { docType: 'dc_rentfoxxy', prefix: 'DC', table: 'delivery_challan_lines', column: 'dc_number' },
};
const FY_SEQ_PAD = 4;

function currentFinancialYear(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  const startYear = month >= 4 ? year : year - 1;
  const a = String(startYear % 100).padStart(2, '0');
  const b = String((startYear + 1) % 100).padStart(2, '0');
  return { code: Number(`${a}${b}`), label: `${a}-${b}` };
}

async function maxFySeqFromData(db, conf, fyLabel) {
  const pattern = `^${conf.prefix}/${fyLabel}/[0-9]+$`;
  const r = await db.query(
    `SELECT COALESCE(MAX((split_part(${conf.column}, '/', 3))::int), 0) AS n
       FROM ${conf.table}
      WHERE ${conf.column} ~ $1`,
    [pattern]
  );
  return Number(r.rows[0]?.n || 0);
}

function formatFyNumber(conf, fyLabel, seq) {
  return `${conf.prefix}/${fyLabel}/${String(seq).padStart(FY_SEQ_PAD, '0')}`;
}

/**
 * Reserve and return the next FY-formatted SO/DC number. Pass an open client to
 * hold the sequence row lock inside the caller's transaction; otherwise a
 * short-lived transaction reserves (and commits) the number immediately.
 */
async function nextFinancialYearNumber(kind, client = null) {
  const conf = FY_DOC_TYPES[kind];
  if (!conf) throw new Error(`Unknown financial-year doc kind: ${kind}`);
  const ownTx = !client;
  const db = client || (await pool.connect());
  try {
    if (ownTx) await db.query('BEGIN');
    const seqRes = await db.query(
      `SELECT last_value FROM sm_document_sequences WHERE doc_type = $1 FOR UPDATE`,
      [conf.docType]
    );
    const { code: fyCode, label: fyLabel } = currentFinancialYear();
    let storedSeqForFy = 0;
    if (seqRes.rows.length) {
      const last = Number(seqRes.rows[0].last_value) || 0;
      if (Math.floor(last / 10000) === fyCode) storedSeqForFy = last % 10000;
    }
    const dataMax = await maxFySeqFromData(db, conf, fyLabel);
    const seq = Math.max(storedSeqForFy, dataMax) + 1;
    const newLast = fyCode * 10000 + seq;
    if (seqRes.rows.length) {
      await db.query(
        `UPDATE sm_document_sequences SET last_value = $1, updated_at = NOW() WHERE doc_type = $2`,
        [newLast, conf.docType]
      );
    } else {
      await db.query(
        `INSERT INTO sm_document_sequences (doc_type, last_value, prefix) VALUES ($1, $2, $3)`,
        [conf.docType, newLast, `${conf.prefix}-`]
      );
    }
    if (ownTx) await db.query('COMMIT');
    return formatFyNumber(conf, fyLabel, seq);
  } catch (e) {
    if (ownTx) await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (ownTx) db.release();
  }
}

/** Preview the next SO/DC number without reserving it (for add-form metadata). */
async function peekFinancialYearNumber(kind) {
  const conf = FY_DOC_TYPES[kind];
  if (!conf) throw new Error(`Unknown financial-year doc kind: ${kind}`);
  const { code: fyCode, label: fyLabel } = currentFinancialYear();
  const seqRes = await pool.query(
    `SELECT last_value FROM sm_document_sequences WHERE doc_type = $1`,
    [conf.docType]
  );
  let storedSeqForFy = 0;
  if (seqRes.rows.length) {
    const last = Number(seqRes.rows[0].last_value) || 0;
    if (Math.floor(last / 10000) === fyCode) storedSeqForFy = last % 10000;
  }
  const dataMax = await maxFySeqFromData(pool, conf, fyLabel);
  return formatFyNumber(conf, fyLabel, Math.max(storedSeqForFy, dataMax) + 1);
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

async function listSalesOrdersGrouped({ page = 1, limit = 20, search = '', assignedUserId = null }) {
  const hasEntityCode = await tableColumnExists('sales_order_lines', 'entity_code');
  const entitySelect = hasEntityCode ? 'entity_code' : `'rentfoxxy' AS entity_code`;
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE sales_order_number ILIKE $1 OR customer_name ILIKE $1 OR gst_number ILIKE $1`;
  }
  if (assignedUserId) {
    params.push(assignedUserId);
    where += where ? ` AND created_by = $${params.length}` : `WHERE created_by = $${params.length}`;
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
       (SELECT COUNT(DISTINCT dcl.dc_number) FROM delivery_challan_lines dcl WHERE dcl.sales_order_number = g.sales_order_number) AS dc_count,
       (SELECT CASE WHEN COUNT(*) > 0 AND COUNT(*) FILTER (WHERE sol.status = 'cancelled') = COUNT(*)
                    THEN 'cancelled' ELSE 'pending' END
          FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS status
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

/** Aggregate pre-dispatch QC status for many DCs in one query (list page). */
async function getDcQcStatusSummaries(dcNumbers) {
  const numbers = [...new Set((dcNumbers || []).filter(Boolean))];
  if (!numbers.length) return {};

  const { rows } = await pool.query(
    `SELECT dc_number,
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
            COUNT(*) FILTER (WHERE status = 'qc_failed')::int AS failed_count,
            COUNT(*) FILTER (WHERE status = 'qc_passed')::int AS passed_count
       FROM dc_qc_tickets
      WHERE dc_number = ANY($1::text[])
      GROUP BY dc_number`,
    [numbers]
  );

  const out = {};
  for (const r of rows) {
    out[r.dc_number] = {
      all_passed: r.total_count > 0 && r.passed_count === r.total_count,
      any_failed: r.failed_count > 0,
      pending_count: r.pending_count,
      failed_count: r.failed_count,
      total_count: r.total_count,
    };
  }
  return out;
}

async function listDeliveryChallansGrouped({ page = 1, limit = 20, search = '', status = '', assignedUserId = null }) {
  const params = [];
  const baseFilter = `COALESCE(d.movement_type, 'outbound') = 'outbound'`;
  let where = `WHERE ${baseFilter}`;
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (d.dc_number ILIKE $${params.length} OR d.sales_order_number ILIKE $${params.length} OR d.customer_name ILIKE $${params.length} OR d.gst_number ILIKE $${params.length})`;
  }
  if (assignedUserId) {
    params.push(assignedUserId);
    where += ` AND d.delivery_person_id = $${params.length}`;
  }
  if (status === 'pending') {
    where += ` AND (d.status IS NULL OR d.status = 'pending')`;
  } else if (status === 'in_transit') {
    // Strictly dispatched-but-not-delivered units (exclude 'pending', which has
    // its own tab).
    where += ` AND d.status IN ('in_transit', 'shipped', 'reached')`;
  } else if (status && status !== 'all') {
    params.push(status);
    where += ` AND d.status = $${params.length}`;
  }
  // A DC can have several line items; list/count one row per DC (not per line)
  // so multi-laptop challans don't appear duplicated.
  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT d.dc_number)::int AS total FROM delivery_challan_lines d ${where}`,
    params
  );
  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];
  const listResult = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (d.dc_number)
            d.id, d.dc_number, d.sales_order_number, d.quotation_number, d.customer_id, d.customer_name,
            d.gst_number, d.status, d.pdf_path, d.file_path, d.ship_by, d.delivery_person_id,
            d.courier_name, d.awb_number, d.model_name, d.created_at, d.updated_at,
            COALESCE(u.name, u.email, '') AS delivery_person_name
       FROM delivery_challan_lines d
       LEFT JOIN users u ON u.user_id = d.delivery_person_id
       ${where}
       ORDER BY d.dc_number, d.id DESC
     ) sub
     ORDER BY sub.id DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  const qcSummaries = await getDcQcStatusSummaries(listResult.rows.map((r) => r.dc_number));
  const emptyQc = {
    all_passed: false,
    any_failed: false,
    pending_count: 0,
    failed_count: 0,
    total_count: 0,
  };
  return {
    delivery_challans: listResult.rows.map((row) => ({
      ...row,
      qc_status: qcSummaries[row.dc_number] || emptyQc,
    })),
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

async function healReturnDcPickupLinks() {
  await pool.query(`
    UPDATE support_ticket_items sti
       SET return_dc_number = dcl.dc_number, updated_at = NOW()
      FROM delivery_challan_lines dcl
     WHERE sti.item_type = 'pickup'
       AND sti.return_dc_number IS NULL
       AND dcl.movement_type = 'return'
       AND dcl.support_ticket_id = sti.ticket_id
  `).catch(() => {});
  await pool.query(`
    UPDATE support_ticket_items
       SET pickup_type = COALESCE(
             pickup_type,
             CASE WHEN source_item_id IS NOT NULL THEN 'repair' ELSE 'return' END
           ),
           updated_at = NOW()
     WHERE item_type = 'pickup'
       AND pickup_type IS NULL
  `).catch(() => {});
  await pool.query(`
    UPDATE support_ticket_items
       SET customer_otp_code = COALESCE(
             customer_otp_code, otp_code,
             LPAD((floor(random() * 1000000))::int::text, 6, '0')
           ),
           customer_otp_sent_at = COALESCE(customer_otp_sent_at, NOW()),
           updated_at = NOW()
     WHERE item_type = 'pickup'
       AND customer_otp_code IS NULL
       AND customer_otp_verified_at IS NULL
       AND warehouse_received_at IS NULL
  `).catch(() => {});
}

/** Return DC list — sourced from the actual Return DC rows
 *  (delivery_challan_lines with movement_type='return'), one row per RDC. */
async function listReturnDeliveryChallans({ page = 1, limit = 25, search = '' } = {}) {
  await healReturnDcPickupLinks();
  await regenerateStaleReturnDcPdfs(pool, 8);

  const params = [];
  let searchSql = '';
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    searchSql = ` AND (
      rl.dc_number ILIKE $${n}
      OR rl.customer_name ILIKE $${n}
      OR rl.sales_order_number ILIKE $${n}
      OR rl.original_dc_number ILIKE $${n}
      OR st.return_dc_number ILIKE $${n}
      OR COALESCE(sti.ttspl_id, '') ILIKE $${n}
      OR COALESCE(sti.serial_number, '') ILIKE $${n}
    )`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM delivery_challan_lines rl
       LEFT JOIN support_tickets st ON st.id = rl.support_ticket_id
       LEFT JOIN LATERAL (
         SELECT ttspl_id, serial_number
           FROM support_ticket_items
          WHERE item_type = 'pickup'
            AND (
              return_dc_number = rl.dc_number
              OR (return_dc_number IS NULL AND ticket_id = rl.support_ticket_id)
            )
          ORDER BY CASE WHEN return_dc_number = rl.dc_number THEN 0 ELSE 1 END, id DESC
          LIMIT 1
       ) sti ON true
      WHERE rl.movement_type = 'return'${searchSql}`,
    params
  );

  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];
  const limitIdx = listParams.length - 1;
  const offsetIdx = listParams.length;

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
       rl.pdf_path,
       rl.dispatch_mode,
       rl.sales_order_number,
       COALESCE(rl.dispatched_at, rl.created_at) AS dispatched_at,
       rl.delivered_at,
       COALESCE(rl.quantity, 1) AS quantity,
       (SELECT COUNT(*)::int FROM support_ticket_items pi
         WHERE pi.return_dc_number = rl.dc_number AND pi.item_type = 'pickup') AS unit_count,
       COALESCE(rl.original_dc_number, st.dc_number, vsn.current_dc_number) AS original_dc_number,
       COALESCE(st.complaint_type, sti.pickup_type, 'return') AS reason,
       sti.pickup_type,
       sti.customer_otp_code,
       sti.customer_otp_verified_at,
       sti.warehouse_received_at,
       COALESCE(sti.ttspl_id, vsn.inventory_asset_code, NULLIF(split_part(rl.serial_number->>0, '|', 3), '')) AS ttspl_id
     FROM delivery_challan_lines rl
     LEFT JOIN support_tickets st ON st.id = rl.support_ticket_id
     LEFT JOIN LATERAL (
       SELECT pickup_type, ttspl_id, unique_serial_number, serial_number,
              COALESCE(customer_otp_code, otp_code) AS customer_otp_code,
              customer_otp_verified_at, warehouse_received_at
       FROM support_ticket_items
       WHERE item_type = 'pickup'
         AND (
           return_dc_number = rl.dc_number
           OR (return_dc_number IS NULL AND ticket_id = rl.support_ticket_id)
         )
       ORDER BY CASE WHEN return_dc_number = rl.dc_number THEN 0 ELSE 1 END, id DESC
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
     WHERE rl.movement_type = 'return'${searchSql}
     ORDER BY rl.created_at DESC NULLS LAST
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams
  );

  const total = countResult.rows[0]?.total || 0;
  return {
    return_dcs: result.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/** Full Return DC detail — units, pickup items, POD, e-signatures, PDF. */
async function getReturnDcDetail(rdcNumber) {
  const dclRes = await pool.query(
    `SELECT dcl.*, st.customer_phone, st.ticket_email
       FROM delivery_challan_lines dcl
       LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
      WHERE dcl.dc_number = $1 AND dcl.movement_type = 'return'
      LIMIT 1`,
    [rdcNumber]
  );
  const dcl = dclRes.rows[0];
  if (!dcl) return null;

  const itemsRes = await pool.query(
    `SELECT sti.*,
            u1.name AS tech_name,
            u2.name AS warehouse_receiver_name
       FROM support_ticket_items sti
       LEFT JOIN users u1 ON u1.user_id = COALESCE(sti.pickup_assigned_to, sti.assigned_to)
       LEFT JOIN users u2 ON u2.user_id = sti.warehouse_received_by
      WHERE sti.return_dc_number = $1 AND sti.item_type = 'pickup'
      ORDER BY sti.id ASC`,
    [rdcNumber]
  );
  const pickupItems = itemsRes.rows;

  const { buildUnitsForRdc } = require('./returnDcPdfService');
  const units = await buildUnitsForRdc(pool, dcl, pickupItems);

  const shipping = typeof dcl.customer_shipping_address === 'object'
    ? dcl.customer_shipping_address
    : (() => { try { return JSON.parse(dcl.customer_shipping_address); } catch { return {}; } })();

  const techItem = pickupItems.find((i) => i.technician_esign_url) || pickupItems[0];
  const whItem = pickupItems.find((i) => i.warehouse_esign_url)
    || pickupItems.find((i) => i.warehouse_received_at)
    || pickupItems[0];

  let pdfPath = dcl.pdf_path;
  const shouldRegenPdf = !pdfPath || pickupItems.some((i) =>
    i.technician_esign_url || i.warehouse_esign_url || i.customer_otp_verified_at
  );
  if (shouldRegenPdf) {
    try {
      const { regenerateReturnDcPdfByRdc } = require('./returnDcPdfService');
      const regen = await regenerateReturnDcPdfByRdc(pool, rdcNumber);
      if (regen) pdfPath = regen;
    } catch (e) {
      console.error('[getReturnDcDetail] pdf regen:', e.message);
    }
  }

  return {
    return_dc_number: rdcNumber,
    ticket_id: dcl.support_ticket_id,
    customer_id: dcl.customer_id,
    customer_name: dcl.customer_name,
    customer_email: dcl.email,
    customer_phone: dcl.customer_phone,
    pickup_address: shipping,
    status: dcl.status,
    pdf_path: pdfPath,
    dispatch_mode: dcl.dispatch_mode,
    sales_order_number: dcl.sales_order_number,
    original_dc_number: dcl.original_dc_number,
    created_at: dcl.created_at,
    dispatched_at: dcl.dispatched_at,
    delivered_at: dcl.delivered_at,
    unit_count: pickupItems.length || dcl.quantity || 1,
    units,
    customer_otp_code: pickupItems[0]?.customer_otp_code || pickupItems[0]?.otp_code || null,
    customer_otp_verified_at: pickupItems.length && pickupItems.every((i) => i.customer_otp_verified_at)
      ? pickupItems.find((i) => i.customer_otp_verified_at)?.customer_otp_verified_at
      : null,
    pickup_items: pickupItems.map((i) => ({
      id: i.id,
      serial_number: i.serial_number,
      ttspl_id: i.ttspl_id || i.unique_serial_number,
      brand: i.brand,
      model: i.model,
      pickup_type: i.pickup_type,
      status: i.status,
      pod_image_path: i.pod_image_path || i.proof_of_completion_path,
      technician_esign_url: i.technician_esign_url,
      technician_esign_at: i.technician_esign_at,
      tech_name: i.tech_name,
      warehouse_esign_url: i.warehouse_esign_url,
      warehouse_esign_at: i.warehouse_esign_at,
      warehouse_received_at: i.warehouse_received_at,
      warehouse_receiver_name: i.warehouse_receiver_name,
      customer_otp_verified_at: i.customer_otp_verified_at,
      floor_ticket_id: i.floor_ticket_id,
    })),
    floor_ticket_ids: pickupItems.map((i) => i.floor_ticket_id).filter(Boolean),
    esign: {
      technician_url: techItem?.technician_esign_url || null,
      technician_name: techItem?.tech_name || null,
      technician_at: techItem?.technician_esign_at || null,
      warehouse_url: whItem?.warehouse_esign_url || null,
      warehouse_name: whItem?.warehouse_receiver_name || null,
      warehouse_at: whItem?.warehouse_esign_at || whItem?.warehouse_received_at || null,
    },
    can_warehouse_confirm: pickupItems.some((i) => !i.warehouse_received_at)
      && pickupItems.filter((i) => !i.warehouse_received_at).every((i) => {
        const isInhouse = i.pickup_method !== 'courier' && i.pickup_method !== 'porter';
        return !isInhouse || i.customer_otp_verified_at;
      }),
  };
}

async function countReturnDcPickupPairs() {
  const r = await pool.query(`
    SELECT pickuped_serial_numbers
      FROM delivery_challan_lines
     WHERE COALESCE(movement_type, 'outbound') = 'outbound'
       AND COALESCE(jsonb_array_length(pickuped_serial_numbers), 0) > 0
  `);
  const pairs = new Set();
  for (const row of r.rows) {
    for (const item of parseJsonArray(row.pickuped_serial_numbers)) {
      const parts = String(item).split('|');
      if (parts[1] && parts[2]) pairs.add(`${parts[1]}-${parts[2]}`);
    }
  }
  return pairs.size;
}

async function getOperationCounts() {
  const [q, so, dc, rdcPairs, rdcLines] = await Promise.all([
    pool.query(`SELECT COUNT(DISTINCT quotation_number)::int AS c FROM sales_quotations`),
    pool.query(`SELECT COUNT(DISTINCT sales_order_number)::int AS c FROM sales_order_lines`),
    pool.query(`SELECT COUNT(*)::int AS c FROM delivery_challan_lines WHERE COALESCE(movement_type, 'outbound') = 'outbound'`),
    countReturnDcPickupPairs(),
    pool.query(`SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines WHERE movement_type = 'return'`),
  ]);
  return {
    quotations: q.rows[0]?.c || 0,
    sales_orders: so.rows[0]?.c || 0,
    delivery_challans: dc.rows[0]?.c || 0,
    return_dc: rdcPairs || 0,
    return_dc_lines: rdcLines.rows[0]?.c || 0,
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

// ---------------------------------------------------------------------------
// GST / amount calculation (shared by SO/DC detail endpoints + PDF service).
// Mirrors the ERP logic: GST applies to the goods subtotal only. Intra-state
// (buyer state == seller state, Haryana) splits into CGST 9% + SGST 9%; inter-
// state charges IGST 18%. Shipping and security are added after tax (untaxed).
// ---------------------------------------------------------------------------
const SELLER_STATE_CODE = '06'; // Rentfoxxy / Gorefurbo are registered in Haryana.
const GST_RATE = 18;

function isIntraState(supplyState, sellerStateCode = SELLER_STATE_CODE) {
  const s = String(supplyState || '').trim().toLowerCase();
  if (!s) return true; // Unknown buyer state -> assume intra (seller's own state).
  return s === String(sellerStateCode).toLowerCase() || s === '06' || s.includes('haryana');
}

function computeGstBreakdown({
  subtotal = 0, shipping = 0, security = 0, supplyState = '',
  sellerStateCode = SELLER_STATE_CODE, gstRate = GST_RATE,
} = {}) {
  const sub = +Number(subtotal || 0).toFixed(2);
  const ship = +Number(shipping || 0).toFixed(2);
  const sec = +Number(security || 0).toFixed(2);
  const gstTotal = +(sub * gstRate / 100).toFixed(2);
  const intra = isIntraState(supplyState, sellerStateCode);
  const half = +(gstTotal / 2).toFixed(2);
  return {
    subtotal: sub,
    gst_rate: gstRate,
    gst_type: intra ? 'intra' : 'inter',
    cgst: intra ? half : 0,
    sgst: intra ? +(gstTotal - half).toFixed(2) : 0,
    igst: intra ? 0 : gstTotal,
    gst_total: gstTotal,
    shipping: ship,
    security: sec,
    grand_total: +(sub + gstTotal + ship + sec).toFixed(2),
  };
}

// Build a per-config rate lookup from a sales order's lines, used to price a DC
// (delivery_challan_lines has no rate column — the rate lives on the SO).
async function getSalesOrderRateMap(salesOrderNumber) {
  const r = await pool.query(
    `SELECT brand, model_name, rate FROM sales_order_lines WHERE sales_order_number = $1`,
    [salesOrderNumber]
  );
  const map = new Map();
  for (const row of r.rows) {
    const key = `${String(row.brand || '').trim().toLowerCase()}|${String(row.model_name || '').trim().toLowerCase()}`;
    if (!map.has(key)) map.set(key, Number(row.rate || 0));
  }
  return { map, single: r.rows.length === 1 ? Number(r.rows[0].rate || 0) : null };
}

function rateForDcLine(line, rateMap) {
  if (!rateMap) return 0;
  const model = String(line.model_name || '').trim().toLowerCase();
  const key = `${String(line.brand || '').trim().toLowerCase()}|${model}`;
  if (rateMap.map.has(key)) return rateMap.map.get(key);
  for (const [k, v] of rateMap.map) {
    if (model && k.endsWith(`|${model}`)) return v;
  }
  return rateMap.single != null ? rateMap.single : 0;
}

module.exports = {
  nextDocumentNumber,
  nextFinancialYearNumber,
  peekFinancialYearNumber,
  currentFinancialYear,
  computeGstBreakdown,
  getSalesOrderRateMap,
  rateForDcLine,
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
  getReturnDcDetail,
  getOperationCounts,
  searchAvailableInventory,
};
