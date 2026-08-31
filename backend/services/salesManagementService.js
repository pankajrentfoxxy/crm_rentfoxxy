const crypto = require('crypto');
const pool = require('../config/db');
const { effectiveReplacementLineRemark } = require('../utils/replacementRemarkUtils');
const { resolveLineItem } = require('./qcManagementService');
const { parseJsonArray } = require('./deliveryRegisterService');
const {
  partialSpecMatch,
  normalizedSpecMatch,
  normalizedModelMatch,
  enrichSerialSpecs,
} = require('../utils/soInventorySpecMatch');
const columnExistsCache = new Map();
const { appendDateRangeClauses, appendDateRangeToWhere } = require('../utils/dateRangeFilter');

/** Dispatch role with assigned scope: pending SOs live in Pending Orders; Sales Orders list after accept. */
function dispatchWorkflowListFilterClauses(params, { role, userId, restrictDispatchWorkflow = false } = {}) {
  if (role !== 'dispatch' || !userId || !restrictDispatchWorkflow) {
    return { sql: '' };
  }

  params.push(userId);
  const p = `$${params.length}`;
  const clauses = [
    `NOT EXISTS (
      SELECT 1 FROM dispatch_workflow dw
      WHERE dw.sales_order_number = sales_order_lines.sales_order_number
        AND dw.status = 'waiting_acceptance'
    )`,
    `(
      NOT EXISTS (
        SELECT 1 FROM dispatch_workflow dw
        WHERE dw.sales_order_number = sales_order_lines.sales_order_number
      )
      OR EXISTS (
        SELECT 1 FROM dispatch_workflow dw
        WHERE dw.sales_order_number = sales_order_lines.sales_order_number
          AND (dw.assigned_user_id = ${p} OR dw.accepted_by = ${p})
      )
    )`,
  ];

  return {
    sql: clauses.map((c) => `(${c})`).join(' AND '),
  };
}

function appendDispatchWorkflowListFilters(where, params, viewer = {}) {
  const { sql } = dispatchWorkflowListFilterClauses(params, viewer);
  if (!sql) return where;
  if (!where) return `WHERE ${sql}`;
  return `${where} AND ${sql}`;
}

async function assertSalesOrderVisibleToUser(salesOrderNumber, user, permissionCache) {
  const role = user?.role;
  const userId = user?.user_id;
  if (role === 'super_admin' || role === 'admin') return;

  if (role === 'dispatch') {
    const { hasUnrestrictedSalesOrderAccess } = require('./dataScopeService');
    const fullAccess = await hasUnrestrictedSalesOrderAccess(userId, role, permissionCache);
    if (fullAccess) return;
  }

  const r = await pool.query(
    `SELECT status, assigned_user_id, accepted_by
       FROM dispatch_workflow
      WHERE sales_order_number = $1
      LIMIT 1`,
    [salesOrderNumber]
  );
  if (!r.rows.length) return;

  const wf = r.rows[0];

  if (role === 'dispatch') {
    if (wf.status === 'waiting_acceptance') {
      const err = new Error('Accept this order from Dispatch Pending Orders first');
      err.status = 403;
      throw err;
    }
    if (wf.assigned_user_id === userId || wf.accepted_by === userId) return;
    const err = new Error('This sales order is not assigned to you for dispatch');
    err.status = 403;
    throw err;
  }

  // Sales and other roles keep normal SO access while dispatch acceptance is pending.
}

const DOC_TYPES = {
  quotation: { prefix: 'EST-', pad: 6 },
  sales_order: { prefix: 'SO-', pad: 6 },
  delivery_challan: { prefix: 'DC-', pad: 6 },
  return_dc: { prefix: 'RDC', pad: 6 },
  service_dc: { prefix: 'SDC', pad: 6 },
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
// Demo can be tagged to either entity via branch on create (sale-section demo → gorefurbo).
function entityForQuotationType(quotationType, branch) {
  const t = String(quotationType || 'rental').toLowerCase();
  if (t === 'sale' || t === 'sales') return 'gorefurbo';
  if (t === 'demo') {
    const b = String(branch || '').toLowerCase();
    if (b === 'gorefurbo' || b === 'rentfoxxy') return b;
    return 'rentfoxxy';
  }
  return 'rentfoxxy';
}

/** SQL predicate for sale vs rental SO list segregation. */
function salesOrderScopeWhere(scope, alias = '') {
  const p = alias ? `${alias}.` : '';
  if (scope === 'sale') {
    return `(LOWER(COALESCE(${p}quotation_type, '')) IN ('sale', 'sales')
      OR LOWER(COALESCE(${p}entity_code, '')) = 'gorefurbo')`;
  }
  if (scope === 'rental') {
    return `(LOWER(COALESCE(${p}quotation_type, 'rental')) = 'rental'
      OR (LOWER(COALESCE(${p}quotation_type, '')) = 'demo'
        AND LOWER(COALESCE(${p}entity_code, 'rentfoxxy')) = 'rentfoxxy'))`;
  }
  return '';
}

async function listCustomersForOrderScope(scope, allowedCustomerTypes = null) {
  const {
    customerTypeSqlCondition,
    customerTypeFilterForQuotation,
  } = require('../utils/customerType');
  const { appendCustomerTypeCondition } = require('./customerAccessScope');
  // scope: 'sale' | 'rental' — map onto customer_type eligibility
  const typeKey = scope === 'sale' || scope === 'sales'
    ? 'sales'
    : customerTypeFilterForQuotation(scope === 'rental' ? 'rental' : scope);
  const typeSql = customerTypeSqlCondition(typeKey) || 'TRUE';

  // Role-based Customer Access scope (all/sales/rental) intersects the order scope
  const params = [];
  const conditions = [];
  appendCustomerTypeCondition(allowedCustomerTypes, conditions, params);

  const { rows } = await pool.query(
    `SELECT customer_id, name, company_name, email, phone, gst_no, address, details, customer_type
       FROM customers c
      WHERE COALESCE(c.status, 1) = 1
        AND ${typeSql}
        ${conditions.length ? `AND ${conditions[0]}` : ''}
      ORDER BY company_name ASC NULLS LAST, name ASC
      LIMIT 500`,
    params
  );
  return rows;
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
  service_dc: { docType: 'service_dc', prefix: 'SDC', table: 'delivery_challan_lines', column: 'dc_number' },
  part_dc: { docType: 'part_dc_rentfoxxy', prefix: 'PDC', table: 'delivery_challan_lines', column: 'dc_number' },
  part_return_dc: { docType: 'part_rpdc_rentfoxxy', prefix: 'RPDC', table: 'delivery_challan_lines', column: 'dc_number' },
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

const SO_FULFILLMENT_DELIVERED_SQL = `(SELECT COUNT(*)::int FROM sales_order_serials sos
  WHERE sos.sales_order_number = %SO%
    AND sos.status = 'dispatched'
    AND sos.dc_number IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM delivery_challan_lines dcl
      WHERE dcl.dc_number = sos.dc_number AND dcl.status = 'delivered'
    ))`;

const SO_FULFILLMENT_DISPATCHED_SQL = `(SELECT COUNT(*)::int FROM sales_order_serials sos
  WHERE sos.sales_order_number = %SO%
    AND sos.status = 'dispatched'
    AND sos.dc_number IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM delivery_challan_lines dcl
      WHERE dcl.dc_number = sos.dc_number
        AND COALESCE(dcl.status, 'pending') NOT IN ('delivered', 'rejected')
    ))`;

function fulfillmentSql(template, soRef) {
  return template.replace(/%SO%/g, soRef);
}

/** Cap serial counts to ordered qty so pending + attached + dispatched + delivered = laptop_qty. */
function reconcileFulfillmentCounts(laptopQty, attached, delivered, dispatched) {
  const total = Math.max(0, Number(laptopQty || 0));
  let a = Math.max(0, Number(attached || 0));
  let d = Math.max(0, Number(delivered || 0));
  let dp = Math.max(0, Number(dispatched || 0));
  let accounted = a + d + dp;

  if (accounted > total) {
    let excess = accounted - total;
    const trim = (val) => {
      const cut = Math.min(val, excess);
      excess -= cut;
      return val - cut;
    };
    d = trim(d);
    dp = trim(dp);
    a = trim(a);
  }

  const pending = Math.max(0, total - a - d - dp);
  return {
    laptop_qty: total,
    attached_count: a,
    delivered_count: d,
    dispatched_count: dp,
    pending_qty: pending,
  };
}

function withPendingQty(row = {}) {
  const reconciled = reconcileFulfillmentCounts(
    row.laptop_qty,
    row.attached_count,
    row.delivered_count,
    row.dispatched_count
  );
  return { ...row, ...reconciled };
}

/** List/detail status from fulfillment — SO lines often stay `pending` after DC delivery. */
function deriveSalesOrderListStatus(row = {}) {
  if (String(row.status || '').toLowerCase() === 'cancelled') return 'cancelled';
  const qty = Math.max(0, Number(row.laptop_qty ?? 0));
  const delivered = Math.max(0, Number(row.delivered_count ?? 0));
  const dispatched = Math.max(0, Number(row.dispatched_count ?? 0));
  if (qty > 0 && delivered >= qty) return 'delivered';
  if (dispatched > 0 || delivered > 0) return 'dispatched';
  return 'pending';
}

function soLaptopQtySql(soRef) {
  return `(SELECT COALESCE(SUM(COALESCE(main_qty, quantity, 0)), 0)::int
             FROM sales_order_lines sol_q
            WHERE sol_q.sales_order_number = ${soRef})`;
}

function soFullyDeliveredSql(soRef) {
  return `${soLaptopQtySql(soRef)} > 0
    AND ${fulfillmentSql(SO_FULFILLMENT_DELIVERED_SQL, soRef)} >= ${soLaptopQtySql(soRef)}`;
}

function soNotCancelledSql(soRef) {
  return `${soRef} IN (
    SELECT sales_order_number FROM sales_order_lines
    GROUP BY sales_order_number
    HAVING COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'pending')) = 'cancelled') < COUNT(*)
  )`;
}

async function getSalesOrderDispatchDate(salesOrderNumber) {
  const r = await pool.query(
    `SELECT MIN(dcl.dispatched_at) AS dispatch_date,
            MAX(dcl.dispatched_at) AS last_dispatch_date
       FROM delivery_challan_lines dcl
      WHERE dcl.sales_order_number = $1
        AND dcl.dispatched_at IS NOT NULL
        AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'`,
    [salesOrderNumber]
  );
  return {
    dispatch_date: r.rows[0]?.dispatch_date || null,
    last_dispatch_date: r.rows[0]?.last_dispatch_date || null,
  };
}

async function getSalesOrderFulfillmentCounts(salesOrderNumber) {
  const r = await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(COALESCE(main_qty, quantity, 0)), 0)::int
          FROM sales_order_lines WHERE sales_order_number = $1) AS laptop_qty,
       (SELECT COUNT(*)::int FROM sales_order_serials
          WHERE sales_order_number = $1 AND status = 'attached') AS attached_count,
       ${fulfillmentSql(SO_FULFILLMENT_DELIVERED_SQL, '$1')} AS delivered_count,
       ${fulfillmentSql(SO_FULFILLMENT_DISPATCHED_SQL, '$1')} AS dispatched_count`,
    [salesOrderNumber]
  );
  return withPendingQty(r.rows[0] || {});
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
       (SELECT COALESCE(SUM(quantity), 0) FROM sales_quotations sq WHERE sq.quotation_number = g.quotation_number) AS remaining_qty,
       (SELECT COALESCE(SUM(COALESCE(rate,0) * COALESCE(quantity,0)), 0) FROM sales_quotations sq WHERE sq.quotation_number = g.quotation_number) AS total_value
     FROM (
       SELECT DISTINCT ON (quotation_number)
         quotation_number, customer_id, customer_name, company_name, contact_name,
         customer_email, customer_mobile, gst_number, status, quotation_type,
         pdf_path, accepted_at, quotation_sent_at, status_updated_by_id, status_updated_by_name,
         created_at, updated_at, source_lead_id
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

async function listSalesOrdersGrouped({
  page = 1, limit = 20, search = '', assignedUserId = null, dateFrom, dateTo,
  customerId = null, status = '', entityScope = '', orderType = '',
  viewerRole = null, viewerUserId = null, restrictDispatchWorkflow = false,
} = {}) {
  const hasEntityCode = await tableColumnExists('sales_order_lines', 'entity_code');
  const entitySelect = hasEntityCode ? 'entity_code' : `'rentfoxxy' AS entity_code`;
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE (sales_order_number ILIKE $1 OR customer_name ILIKE $1 OR gst_number ILIKE $1)`;
  }
  if (assignedUserId) {
    params.push(assignedUserId);
    where += where ? ` AND created_by = $${params.length}` : `WHERE created_by = $${params.length}`;
  }
  if (customerId) {
    params.push(Number(customerId));
    where += where ? ` AND customer_id = $${params.length}` : `WHERE customer_id = $${params.length}`;
  }
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedStatus === 'cancelled') {
    where += where ? ` AND sales_order_number IN (
      SELECT sales_order_number FROM sales_order_lines
      GROUP BY sales_order_number
      HAVING COUNT(*) > 0
        AND COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'pending')) = 'cancelled') = COUNT(*)
    )` : `WHERE sales_order_number IN (
      SELECT sales_order_number FROM sales_order_lines
      GROUP BY sales_order_number
      HAVING COUNT(*) > 0
        AND COUNT(*) FILTER (WHERE LOWER(COALESCE(status, 'pending')) = 'cancelled') = COUNT(*)
    )`;
  } else if (normalizedStatus === 'pending') {
    where += where ? ` AND ${soNotCancelledSql('sales_order_lines.sales_order_number')}` : `WHERE ${soNotCancelledSql('sales_order_lines.sales_order_number')}`;
    where += ` AND NOT (${soFullyDeliveredSql('sales_order_lines.sales_order_number')})`;
    where += ` AND ${fulfillmentSql(SO_FULFILLMENT_DISPATCHED_SQL, 'sales_order_lines.sales_order_number')} = 0`;
    where += ` AND ${fulfillmentSql(SO_FULFILLMENT_DELIVERED_SQL, 'sales_order_lines.sales_order_number')} = 0`;
  } else if (normalizedStatus === 'active') {
    // Anything still in flight: not cancelled and not yet fully delivered.
    where += where ? ` AND ${soNotCancelledSql('sales_order_lines.sales_order_number')}` : `WHERE ${soNotCancelledSql('sales_order_lines.sales_order_number')}`;
    where += ` AND NOT (${soFullyDeliveredSql('sales_order_lines.sales_order_number')})`;
  } else if (normalizedStatus === 'delivered') {
    where += where ? ` AND ${soNotCancelledSql('sales_order_lines.sales_order_number')}` : `WHERE ${soNotCancelledSql('sales_order_lines.sales_order_number')}`;
    where += ` AND (${soFullyDeliveredSql('sales_order_lines.sales_order_number')})`;
  } else if (normalizedStatus === 'dispatched') {
    where += where ? ` AND ${soNotCancelledSql('sales_order_lines.sales_order_number')}` : `WHERE ${soNotCancelledSql('sales_order_lines.sales_order_number')}`;
    where += ` AND NOT (${soFullyDeliveredSql('sales_order_lines.sales_order_number')})`;
    where += ` AND ${fulfillmentSql(SO_FULFILLMENT_DISPATCHED_SQL, 'sales_order_lines.sales_order_number')} > 0`;
  }
  const replacementSoSubquery = `SELECT DISTINCT sales_order_number FROM support_replacement_orders WHERE sales_order_number IS NOT NULL`;
  const normalizedOrderType = String(orderType || '').trim().toLowerCase();
  if (normalizedOrderType === 'replacement') {
    where += where ? ` AND sales_order_number IN (${replacementSoSubquery})` : `WHERE sales_order_number IN (${replacementSoSubquery})`;
  } else if (normalizedOrderType === 'standard') {
    where += where ? ` AND sales_order_number NOT IN (${replacementSoSubquery})` : `WHERE sales_order_number NOT IN (${replacementSoSubquery})`;
  }
  where = appendDateRangeToWhere(
    where,
    appendDateRangeClauses({ column: 'created_at', dateFrom, dateTo, params })
  );
  const scopeSql = salesOrderScopeWhere(entityScope);
  if (scopeSql) {
    where += where ? ` AND ${scopeSql}` : `WHERE ${scopeSql}`;
  }
  where = appendDispatchWorkflowListFilters(where, params, {
    role: viewerRole,
    userId: viewerUserId,
    restrictDispatchWorkflow,
  });
  const statsQuery = `
    WITH filtered AS (
      SELECT DISTINCT sales_order_number
      FROM sales_order_lines
      ${where}
    ),
    so_metrics AS (
      SELECT
        f.sales_order_number,
        (SELECT COALESCE(SUM(COALESCE(main_qty, quantity, 0)), 0)::int
           FROM sales_order_lines sol WHERE sol.sales_order_number = f.sales_order_number) AS laptop_qty,
        (SELECT COUNT(*)::int FROM sales_order_serials sos
           WHERE sos.sales_order_number = f.sales_order_number AND sos.status = 'attached') AS attached_count,
        ${fulfillmentSql(SO_FULFILLMENT_DELIVERED_SQL, 'f.sales_order_number')} AS delivered_count,
        ${fulfillmentSql(SO_FULFILLMENT_DISPATCHED_SQL, 'f.sales_order_number')} AS dispatched_count
      FROM filtered f
    )
    SELECT
      COUNT(*)::int AS orders,
      COALESCE(SUM(laptop_qty), 0)::int AS total_laptops,
      COALESCE(SUM(attached_count), 0)::int AS attached,
      COALESCE(SUM(delivered_count), 0)::int AS delivered,
      COALESCE(SUM(dispatched_count), 0)::int AS dispatched
    FROM so_metrics`;
  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];
  const [countResult, listResult, statsResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT sales_order_number)::int AS total FROM sales_order_lines ${where}`,
      params
    ),
    pool.query(
    `SELECT g.*,
       COALESCE(NULLIF(g.customer_name, ''), c.company_name, c.name) AS customer_name,
       (SELECT COALESCE(SUM(COALESCE(main_qty, quantity, 0)), 0)::int FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS laptop_qty,
       (SELECT COALESCE(SUM(quantity), 0) FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS remaining_qty,
       (SELECT COALESCE(SUM(COALESCE(rate,0) * COALESCE(quantity,0)), 0) FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS total_value,
       (SELECT COALESCE(SUM(COALESCE(rate,0) * COALESCE(quantity,0)), 0) FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS total_amount,
       (SELECT COUNT(*)::int FROM sales_order_serials sos
          WHERE sos.sales_order_number = g.sales_order_number AND sos.status = 'attached') AS attached_count,
       ${fulfillmentSql(SO_FULFILLMENT_DELIVERED_SQL, 'g.sales_order_number')} AS delivered_count,
       ${fulfillmentSql(SO_FULFILLMENT_DISPATCHED_SQL, 'g.sales_order_number')} AS dispatched_count,
       (SELECT MIN(dcl.dispatched_at)
          FROM delivery_challan_lines dcl
         WHERE dcl.sales_order_number = g.sales_order_number
           AND dcl.dispatched_at IS NOT NULL
           AND COALESCE(dcl.movement_type, 'outbound') = 'outbound') AS dispatch_date,
       (SELECT CASE WHEN COUNT(*) > 0 AND COUNT(*) FILTER (WHERE sol.status = 'cancelled') = COUNT(*)
                    THEN 'cancelled' ELSE 'pending' END
          FROM sales_order_lines sol WHERE sol.sales_order_number = g.sales_order_number) AS status,
       EXISTS (
         SELECT 1 FROM support_replacement_orders ro
          WHERE ro.sales_order_number = g.sales_order_number
            AND ro.sales_order_number IS NOT NULL
       ) AS is_replacement_order,
       (SELECT MIN(ro.ticket_id)::int
          FROM support_replacement_orders ro
         WHERE ro.sales_order_number = g.sales_order_number
           AND ro.sales_order_number IS NOT NULL) AS support_ticket_id
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
    ),
    pool.query(statsQuery, params),
  ]);
  const statsRow = statsResult.rows[0] || {};
  const statsCounts = reconcileFulfillmentCounts(
    statsRow.total_laptops,
    statsRow.attached,
    statsRow.delivered,
    statsRow.dispatched
  );
  return {
    sales_orders: listResult.rows.map((row) => {
      const reconciled = withPendingQty(row);
      return { ...reconciled, status: deriveSalesOrderListStatus(reconciled) };
    }),
    stats: {
      orders: Number(statsRow.orders || 0),
      total_laptops: statsCounts.laptop_qty,
      attached: statsCounts.attached_count,
      delivered: statsCounts.delivered_count,
      dispatched: statsCounts.dispatched_count,
      pending: statsCounts.pending_qty,
    },
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

async function getSalesOrderSupportMeta(salesOrderNumber) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM support_replacement_orders ro
        WHERE ro.sales_order_number = $1
          AND ro.sales_order_number IS NOT NULL
     ) AS is_replacement_order,
     (SELECT MIN(ro.ticket_id)::int
        FROM support_replacement_orders ro
       WHERE ro.sales_order_number = $1
         AND ro.sales_order_number IS NOT NULL) AS support_ticket_id`,
    [salesOrderNumber]
  );
  return result.rows[0] || { is_replacement_order: false, support_ticket_id: null };
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

function buildDeliveryChallanListWhere({
  search = '',
  status = '',
  dcPurpose = '',
  assignedUserId = null,
  dateFrom,
  dateTo,
} = {}) {
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
  if (dcPurpose === 'standard') {
    where += ` AND COALESCE(d.dc_purpose, 'standard') = 'standard'`;
  } else if (dcPurpose === 'replacement') {
    where += ` AND d.dc_purpose = 'replacement'`;
  } else if (dcPurpose === 'service_return') {
    where += ` AND d.dc_purpose = 'service_return'`;
  }
  if (status === 'pending') {
    where += ` AND (d.status IS NULL OR d.status = 'pending')`;
  } else if (status === 'dispatch_ready') {
    where += ` AND d.status = 'dispatch_ready'`;
  } else if (status === 'in_transit') {
    where += ` AND d.status IN ('in_transit', 'shipped', 'reached')`;
  } else if (status && status !== 'all') {
    params.push(status);
    where += ` AND d.status = $${params.length}`;
  }
  where = appendDateRangeToWhere(
    where,
    appendDateRangeClauses({ column: 'created_at', dateFrom, dateTo, params, tableAlias: 'd' })
  );
  return { where, params };
}

async function listDeliveryChallansGrouped({
  page = 1, limit = 20, search = '', status = '', dcPurpose = '', assignedUserId = null, dateFrom, dateTo,
} = {}) {
  const { where, params } = buildDeliveryChallanListWhere({
    search, status, dcPurpose, assignedUserId, dateFrom, dateTo,
  });
  // A DC can have several line items; list/count one row per DC (not per line)
  // so multi-laptop challans don't appear duplicated.
  const laptopUnitSql = `CASE
    WHEN COALESCE(jsonb_array_length(d.serial_number), 0) > 0
      THEN jsonb_array_length(d.serial_number)
    ELSE COALESCE(d.quantity, 1)
  END`;
  const [countResult, laptopResult, statusResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT d.dc_number)::int AS total FROM delivery_challan_lines d ${where}`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(${laptopUnitSql}), 0)::int AS total_laptops
         FROM delivery_challan_lines d
         ${where}`,
      params
    ),
    pool.query(
      `WITH dc_heads AS (
         SELECT DISTINCT ON (d.dc_number)
                d.dc_number,
                COALESCE(NULLIF(TRIM(d.status), ''), 'pending') AS dc_status
           FROM delivery_challan_lines d
           ${where}
          ORDER BY d.dc_number, d.id DESC
       )
       SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE dc_status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE dc_status = 'dispatch_ready')::int AS dispatch_ready,
         COUNT(*) FILTER (WHERE dc_status IN ('in_transit', 'shipped', 'reached'))::int AS in_transit,
         COUNT(*) FILTER (WHERE dc_status = 'delivered')::int AS delivered,
         COUNT(*) FILTER (WHERE dc_status = 'rejected')::int AS rejected
       FROM dc_heads`,
      params
    ),
  ]);
  const statusRow = statusResult.rows[0] || {};
  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];
  const listResult = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (d.dc_number)
            d.id, d.dc_number, d.sales_order_number, d.quotation_number, d.customer_id, d.customer_name,
            d.gst_number, d.status, d.pdf_path, d.file_path, d.ship_by, d.delivery_person_id,
            d.courier_name, d.awb_number, d.model_name, d.dispatch_mode, d.dispatched_at,
            d.created_at, d.updated_at, d.dc_purpose, d.support_ticket_id,
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
    stats: {
      total_delivery_challans: countResult.rows[0]?.total || 0,
      total_laptops: laptopResult.rows[0]?.total_laptops || 0,
      total: statusRow.total || countResult.rows[0]?.total || 0,
      pending: statusRow.pending || 0,
      dispatch_ready: statusRow.dispatch_ready || 0,
      in_transit: statusRow.in_transit || 0,
      delivered: statusRow.delivered || 0,
      rejected: statusRow.rejected || 0,
    },
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
  const rows = result.rows;
  if (rows.length && !rows.some((r) => r.support_ticket_id)) {
    try {
      const t = await pool.query(
        `SELECT ticket_id
           FROM support_ticket_items
          WHERE service_dc_number = $1 OR return_dc_number = $1
          ORDER BY id DESC
          LIMIT 1`,
        [dcNumber]
      );
      const ticketId = t.rows[0]?.ticket_id || null;
      if (ticketId) {
        for (const row of rows) row.support_ticket_id = ticketId;
      }
    } catch (_) { /* support tables may be missing on very old DBs */ }
  }
  return rows;
}

async function healReturnDcPickupLinks() {
  await pool.query(`
    UPDATE support_ticket_items sti
       SET return_dc_number = dcl.dc_number, updated_at = NOW()
      FROM delivery_challan_lines dcl
     WHERE sti.item_type = 'pickup'
       AND sti.return_dc_number IS NULL
       AND COALESCE(sti.status, '') NOT IN ('cancelled', 'closed', 'resolved', 'inventory_updated')
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

/** Link or create pickup rows so warehouse receive can complete legacy / stuck Return DCs. */
async function ensureReturnDcPickupItems(db, dcl) {
  const rdcNumber = dcl.dc_number;
  const ticketId = dcl.support_ticket_id;

  if (ticketId) {
    await db.query(
      `UPDATE support_ticket_items
          SET return_dc_number = $1, updated_at = NOW()
        WHERE ticket_id = $2 AND item_type = 'pickup'
          AND return_dc_number IS NULL
          AND COALESCE(status, '') NOT IN ('cancelled', 'closed', 'resolved', 'inventory_updated')`,
      [rdcNumber, ticketId]
    );
  }

  const isDelivered = dcl.status === 'delivered' || !!dcl.delivered_at;
  const isCourier = ['courier', 'porter'].includes(String(dcl.dispatch_mode || ''));
  if (isDelivered || isCourier) {
    await db.query(
      `UPDATE support_ticket_items SET
          customer_otp_verified_at = COALESCE(customer_otp_verified_at, NOW()),
          picked_up_at = COALESCE(picked_up_at, NOW()),
          status = CASE
            WHEN status IN ('pending_dispatch', 'assigned', 'reached') THEN 'picked_up'
            ELSE status
          END,
          updated_at = NOW()
        WHERE return_dc_number = $1
          AND item_type = 'pickup'
          AND warehouse_received_at IS NULL`,
      [rdcNumber]
    );
  }

  const existingRes = await db.query(
    `SELECT * FROM support_ticket_items
      WHERE return_dc_number = $1 AND item_type = 'pickup'
        AND COALESCE(status, '') NOT IN ('cancelled')
      ORDER BY id ASC`,
    [rdcNumber]
  );
  if (existingRes.rows.length) return existingRes.rows;
  if (!ticketId) return [];

  const { buildUnitsForRdc } = require('./returnDcPdfService');
  const units = await buildUnitsForRdc(db, dcl, []);
  const inserted = [];
  for (const unit of units) {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const ins = await db.query(
      `INSERT INTO support_ticket_items (
          ticket_id, serial_number, unique_serial_number, ttspl_id,
          brand, model, item_type, pickup_type, status, return_dc_number,
          pickup_method, otp_code, customer_otp_code, customer_otp_sent_at,
          customer_otp_verified_at, picked_up_at
       ) VALUES (
          $1, $2, $3, $4, $5, $6, 'pickup', 'return',
          $7, $8, $9, $10, $10, NOW(), $11, $12
       )
       RETURNING *`,
      [
        ticketId,
        unit.serial || null,
        unit.ttspl || null,
        unit.ttspl || null,
        unit.brand || dcl.brand || null,
        unit.model || dcl.model_name || null,
        isDelivered ? 'picked_up' : 'assigned',
        rdcNumber,
        dcl.dispatch_mode || null,
        otp,
        (isDelivered || isCourier) ? new Date() : null,
        isDelivered ? new Date() : null,
      ]
    );
    inserted.push(ins.rows[0]);
  }
  return inserted;
}

/** Pickup marked received but unit still held by the return customer / no floor ticket. */
function isIncompleteWarehouseReceive(item, returnCustomerId = null) {
  if (!item) return false;
  if (!item.warehouse_received_at) return false;
  // ERP/backfill may set warehouse_received_at without warehouse e-sign — allow receive + sign.
  if (!item.warehouse_esign_at && !item.warehouse_esign_url) return true;
  if (!item.floor_ticket_id) return true;
  const inv = String(item.inventory_status || '').toLowerCase();
  if (!['rented', 'on_demo', 'in_transit', 'out_stock'].includes(inv)) return false;
  if (returnCustomerId != null && item.current_customer_id != null) {
    return parseInt(item.current_customer_id, 10) === parseInt(returnCustomerId, 10);
  }
  return true;
}

function evaluateReturnDcWarehouseConfirm(pickupItems, units, dcl) {
  if (String(dcl?.status || '').toLowerCase() === 'cancelled') {
    return { can_warehouse_confirm: false, warehouse_block_reason: null, warehouse_receive_pending: false };
  }
  const returnCustomerId = dcl?.customer_id ?? null;
  const pendingItems = (pickupItems || []).filter(
    (i) => !i.warehouse_received_at || isIncompleteWarehouseReceive(i, returnCustomerId)
  );
  const fullyDone = pickupItems.length > 0
    && pickupItems.every((i) => i.warehouse_received_at && !isIncompleteWarehouseReceive(i, returnCustomerId));
  if (fullyDone) {
    return { can_warehouse_confirm: false, warehouse_block_reason: null, warehouse_receive_pending: false };
  }

  const hasUnits = (units || []).length > 0;
  const needsReceive = pendingItems.length > 0 || (pickupItems.length === 0 && hasUnits);
  if (!needsReceive) {
    return { can_warehouse_confirm: false, warehouse_block_reason: null, warehouse_receive_pending: false };
  }

  const isDelivered = dcl.status === 'delivered' || !!dcl.delivered_at;
  const itemsToCheck = pendingItems.length ? pendingItems : pickupItems;
  const otpBlocked = itemsToCheck.some((i) => {
    const isInhouse = i.pickup_method !== 'courier' && i.pickup_method !== 'porter';
    return isInhouse && !i.customer_otp_verified_at && !isDelivered;
  });
  const gateBlocked = itemsToCheck.some((i) => i.return_dc_number && !i.gate_inward_at);

  let warehouse_block_reason = null;
  if (otpBlocked) {
    warehouse_block_reason = 'Customer OTP must be verified before warehouse can confirm receipt (or mark Return DC delivered first).';
  } else if (gateBlocked) {
    warehouse_block_reason = 'Guard must scan this Return DC inward before warehouse e-sign.';
  }

  return {
    can_warehouse_confirm: !otpBlocked && !gateBlocked,
    warehouse_block_reason,
    warehouse_receive_pending: true,
  };
}

/** Return DC list — sourced from the actual Return DC rows
 *  (delivery_challan_lines with movement_type='return'), one row per RDC. */
/** Assigned-only Return DC: match ticket pickup user or RDC delivery person (user id or technician id). */
function appendReturnDcAssignedFilter(alias, userId, params) {
  if (!userId) return '';
  params.push(userId);
  const i = params.length;
  return ` AND (
    ${alias}.delivery_person_id = $${i}
    OR EXISTS (
      SELECT 1 FROM delivery_technicians dt
       WHERE dt.user_id = $${i}
         AND dt.technician_id = ${alias}.delivery_person_id
    )
    OR EXISTS (
      SELECT 1 FROM support_ticket_items sti_a
       WHERE sti_a.item_type = 'pickup'
         AND (
           sti_a.return_dc_number = ${alias}.dc_number
           OR (sti_a.return_dc_number IS NULL AND sti_a.ticket_id = ${alias}.support_ticket_id)
         )
         AND (sti_a.pickup_assigned_to = $${i} OR sti_a.assigned_to = $${i})
    )
  )`;
}

const RETURN_DC_STATUS_CLAUSES = {
  pending: `COALESCE(rl.status, 'pending') IN ('pending', 'processing')`,
  in_transit: `rl.status IN ('in_transit', 'shipped', 'reached')`,
  reached: `rl.status = 'reached'`,
  delivered: `rl.status = 'delivered'`,
  cancelled: `rl.status = 'cancelled'`,
};

function parseReturnDcStatusKeys(status) {
  const raw = Array.isArray(status) ? status : String(status || '').split(',');
  return [...new Set(raw.map((s) => String(s).trim().toLowerCase().replace(/-/g, '_')).filter(Boolean))];
}

function returnDcStatusFilterSql(status) {
  const keys = parseReturnDcStatusKeys(status);
  if (!keys.length || keys.includes('all')) return '';
  const clauses = keys.map((k) => RETURN_DC_STATUS_CLAUSES[k]).filter(Boolean);
  if (!clauses.length) return '';
  const mainKeys = ['pending', 'in_transit', 'delivered', 'cancelled'];
  if (mainKeys.every((k) => keys.includes(k))) return '';
  return ` AND (${clauses.join(' OR ')})`;
}

async function userCanAccessReturnDc(rdcNumber, userId) {
  if (!rdcNumber || !userId) return false;
  const params = [rdcNumber];
  const assignedSql = appendReturnDcAssignedFilter('rl', userId, params);
  const r = await pool.query(
    `SELECT 1
       FROM delivery_challan_lines rl
      WHERE rl.dc_number = $1
        AND rl.movement_type = 'return'
        ${assignedSql}
      LIMIT 1`,
    params
  );
  return r.rows.length > 0;
}

async function listReturnDeliveryChallans({
  page = 1,
  limit = 25,
  search = '',
  dateFrom,
  dateTo,
  status = 'all',
  assignedUserId = null,
} = {}) {
  const params = [];
  let searchSql = '';
  const dateClauses = appendDateRangeClauses({
    column: 'created_at', dateFrom, dateTo, params, tableAlias: 'rl',
  });
  const dateSql = dateClauses.length ? ` AND ${dateClauses.join(' AND ')}` : '';
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    searchSql = ` AND (
      rl.dc_number ILIKE $${n}
      OR rl.customer_name ILIKE $${n}
      OR rl.sales_order_number ILIKE $${n}
      OR rl.original_dc_number ILIKE $${n}
      OR st.return_dc_number ILIKE $${n}
      OR EXISTS (
        SELECT 1 FROM support_ticket_items sti_s
         WHERE sti_s.item_type = 'pickup'
           AND (
             sti_s.return_dc_number = rl.dc_number
             OR (sti_s.return_dc_number IS NULL AND sti_s.ticket_id = rl.support_ticket_id)
           )
           AND (
             COALESCE(sti_s.ttspl_id, '') ILIKE $${n}
             OR COALESCE(sti_s.serial_number, '') ILIKE $${n}
           )
      )
    )`;
  }

  const statusSql = returnDcStatusFilterSql(status);

  const assignedSql = appendReturnDcAssignedFilter('rl', assignedUserId, params);
  const baseWhere = `rl.movement_type = 'return'${searchSql}${dateSql}${assignedSql}`;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM delivery_challan_lines rl
       LEFT JOIN support_tickets st ON st.id = rl.support_ticket_id
      WHERE ${baseWhere}${statusSql}`,
    params
  );

  const statsResult = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE COALESCE(rl.status, 'pending') IN ('pending', 'processing'))::int AS pending,
       COUNT(*) FILTER (WHERE rl.status IN ('in_transit', 'shipped', 'reached'))::int AS in_transit,
       COUNT(*) FILTER (WHERE rl.status = 'reached')::int AS reached,
       COUNT(*) FILTER (WHERE rl.status = 'delivered')::int AS delivered,
       COUNT(*) FILTER (WHERE rl.status = 'cancelled')::int AS cancelled
       FROM delivery_challan_lines rl
       LEFT JOIN support_tickets st ON st.id = rl.support_ticket_id
      WHERE ${baseWhere}`,
    params
  );

  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];
  const limitIdx = listParams.length - 1;
  const offsetIdx = listParams.length;

  const result = await pool.query(
    `WITH pickup_counts AS (
       SELECT return_dc_number, COUNT(*)::int AS unit_count
         FROM support_ticket_items
        WHERE item_type = 'pickup' AND return_dc_number IS NOT NULL
        GROUP BY return_dc_number
     ),
     pickup_dates AS (
       SELECT return_dc_number,
              MIN(picked_up_at) AS picked_up_at,
              MIN(pickup_scheduled_at) AS pickup_scheduled_at
         FROM support_ticket_items
        WHERE item_type = 'pickup' AND return_dc_number IS NOT NULL
        GROUP BY return_dc_number
     ),
     pickup_dates_by_ticket AS (
       SELECT ticket_id,
              MIN(picked_up_at) AS picked_up_at,
              MIN(pickup_scheduled_at) AS pickup_scheduled_at
         FROM support_ticket_items
        WHERE item_type = 'pickup' AND return_dc_number IS NULL
        GROUP BY ticket_id
     ),
     pickup_by_rdc AS (
       SELECT DISTINCT ON (return_dc_number)
              return_dc_number, pickup_type, ttspl_id, serial_number, floor_ticket_id,
              COALESCE(customer_otp_code, otp_code) AS customer_otp_code,
              customer_otp_verified_at, warehouse_received_at,
              warehouse_esign_at, warehouse_esign_url
         FROM support_ticket_items
        WHERE item_type = 'pickup' AND return_dc_number IS NOT NULL
        ORDER BY return_dc_number, id DESC
     ),
     pickup_by_ticket AS (
       SELECT DISTINCT ON (ticket_id)
              ticket_id, pickup_type, ttspl_id, serial_number, floor_ticket_id,
              COALESCE(customer_otp_code, otp_code) AS customer_otp_code,
              customer_otp_verified_at, warehouse_received_at,
              warehouse_esign_at, warehouse_esign_url
         FROM support_ticket_items
        WHERE item_type = 'pickup' AND return_dc_number IS NULL
        ORDER BY ticket_id, id DESC
     )
     SELECT
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
       COALESCE(
         pd.picked_up_at,
         pdt.picked_up_at,
         pd.pickup_scheduled_at,
         pdt.pickup_scheduled_at,
         rl.dispatched_at
       ) AS pickup_date,
       COALESCE(rl.quantity, 1) AS quantity,
       COALESCE(pc.unit_count, COALESCE(rl.quantity, 1)) AS unit_count,
       COALESCE(rl.original_dc_number, st.dc_number) AS original_dc_number,
       COALESCE(st.complaint_type, sti_rdc.pickup_type, sti_tkt.pickup_type, 'return') AS reason,
       COALESCE(sti_rdc.pickup_type, sti_tkt.pickup_type) AS pickup_type,
       COALESCE(sti_rdc.customer_otp_code, sti_tkt.customer_otp_code) AS customer_otp_code,
       COALESCE(sti_rdc.customer_otp_verified_at, sti_tkt.customer_otp_verified_at) AS customer_otp_verified_at,
       COALESCE(sti_rdc.warehouse_received_at, sti_tkt.warehouse_received_at) AS warehouse_received_at,
       (
         LOWER(COALESCE(rl.status, '')) <> 'cancelled'
         AND (
           COALESCE(sti_rdc.warehouse_received_at, sti_tkt.warehouse_received_at) IS NULL
           OR (
             COALESCE(sti_rdc.warehouse_received_at, sti_tkt.warehouse_received_at) IS NOT NULL
             AND COALESCE(sti_rdc.warehouse_esign_at, sti_tkt.warehouse_esign_at) IS NULL
             AND COALESCE(sti_rdc.warehouse_esign_url, sti_tkt.warehouse_esign_url) IS NULL
           )
           OR COALESCE(sti_rdc.floor_ticket_id, sti_tkt.floor_ticket_id) IS NULL
           OR EXISTS (
             SELECT 1 FROM vendor_serial_numbers v_pending
              WHERE v_pending.deleted_at IS NULL
                AND (
                  v_pending.inventory_asset_code = COALESCE(sti_rdc.ttspl_id, sti_tkt.ttspl_id, NULLIF(split_part(rl.serial_number->>0, '|', 3), ''))
                  OR v_pending.serial_number = COALESCE(sti_rdc.serial_number, sti_tkt.serial_number, NULLIF(split_part(rl.serial_number->>0, '|', 2), ''))
                )
                AND v_pending.current_customer_id = rl.customer_id
                AND COALESCE(v_pending.inventory_status, '') IN ('rented','on_demo','in_transit','out_stock')
            )
         )
       ) AS warehouse_receive_pending,
       COALESCE(
         sti_rdc.ttspl_id,
         sti_tkt.ttspl_id,
         NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
       ) AS ttspl_id,
       COALESCE(
         NULLIF(st.pickup_address->>'city', ''),
         NULLIF(rl.customer_shipping_address->>'city', '')
       ) AS city
     FROM delivery_challan_lines rl
     LEFT JOIN support_tickets st ON st.id = rl.support_ticket_id
     LEFT JOIN pickup_counts pc ON pc.return_dc_number = rl.dc_number
     LEFT JOIN pickup_dates pd ON pd.return_dc_number = rl.dc_number
     LEFT JOIN pickup_dates_by_ticket pdt
       ON pdt.ticket_id = rl.support_ticket_id AND pd.return_dc_number IS NULL
     LEFT JOIN pickup_by_rdc sti_rdc ON sti_rdc.return_dc_number = rl.dc_number
     LEFT JOIN pickup_by_ticket sti_tkt
       ON sti_tkt.ticket_id = rl.support_ticket_id AND sti_rdc.return_dc_number IS NULL
     WHERE ${baseWhere}${statusSql}
     ORDER BY rl.created_at DESC NULLS LAST
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams
  );

  const total = countResult.rows[0]?.total || 0;
  const statsRow = statsResult.rows[0] || {};
  return {
    return_dcs: result.rows,
    stats: {
      total: statsRow.total || 0,
      pending: statsRow.pending || 0,
      in_transit: statsRow.in_transit || 0,
      reached: statsRow.reached || 0,
      delivered: statsRow.delivered || 0,
      cancelled: statsRow.cancelled || 0,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

function parseReturnAddress(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return {};
  const text = raw.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { address: text };
  } catch {
    return { address: text };
  }
}

function formatReturnAddressParts(raw) {
  const a = parseReturnAddress(raw);
  const street = a.address || a.address_line_1 || a.line1 || a.address_line || '';
  const city = a.city || '';
  const state = a.state || '';
  const pincode = a.pincode != null && a.pincode !== '' ? String(a.pincode) : (a.zip_code || a.pin || '');
  const line = [street, city, state, pincode].filter(Boolean).join(', ');
  return { street, city, state, pincode, line };
}

function describeReturnLaptopLocation(row) {
  const city = row.city || '';
  const place = city || row.address || 'customer';
  const mode = String(row.dispatch_mode || row.pickup_method || '').toLowerCase();
  const assignee = row.assignee_name || '';
  const courier = row.courier_name || '';
  const awb = row.awb_number || '';
  const porter = row.porter_tracking_id || '';

  if (row.warehouse_esign_at || (row.warehouse_received_at && row.rdc_status === 'delivered')) {
    return 'Warehouse received';
  }
  if (row.warehouse_received_at) {
    return 'At warehouse — pending confirmation';
  }
  if (row.customer_otp_verified_at || row.picked_up_at) {
    if (mode === 'courier' || courier) {
      return `In transit to warehouse via courier${courier ? ` (${courier})` : ''}${awb ? ` · AWB ${awb}` : ''} — from ${place}`;
    }
    if (mode === 'porter' || porter) {
      return `In transit to warehouse via porter${porter ? ` (${porter})` : ''} — from ${place}`;
    }
    if (assignee) {
      return `In transit to warehouse with ${assignee} — from ${place}`;
    }
    return `Picked up — in transit to warehouse from ${place}`;
  }
  if (assignee) {
    return `Pending pickup with ${assignee} at ${place}`;
  }
  if (mode === 'courier' || courier) {
    return `Pending courier pickup${courier ? ` (${courier})` : ''} at ${place}`;
  }
  if (mode === 'porter' || porter) {
    return `Pending porter pickup at ${place}`;
  }
  return `At customer — ${place}`;
}

async function listReturnDcLaptopExportRows({
  search = '',
  dateFrom,
  dateTo,
  status = 'in_transit',
  assignedUserId = null,
} = {}) {
  const params = [];
  const dateClauses = appendDateRangeClauses({
    column: 'created_at', dateFrom, dateTo, params, tableAlias: 'rl',
  });
  const dateSql = dateClauses.length ? ` AND ${dateClauses.join(' AND ')}` : '';

  let searchSql = '';
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    searchSql = ` AND (
      rl.dc_number ILIKE $${n}
      OR rl.customer_name ILIKE $${n}
      OR rl.sales_order_number ILIKE $${n}
      OR rl.original_dc_number ILIKE $${n}
      OR COALESCE(sti.ttspl_id, '') ILIKE $${n}
      OR COALESCE(sti.serial_number, '') ILIKE $${n}
      OR COALESCE(sti.unique_serial_number, '') ILIKE $${n}
    )`;
  }

  const statusSql = returnDcStatusFilterSql(status);

  const { rows } = await pool.query(
    `SELECT
       rl.dc_number AS return_dc_number,
       rl.customer_name,
       rl.sales_order_number,
       COALESCE(rl.original_dc_number, st.dc_number) AS original_dc_number,
       rl.status AS rdc_status,
       rl.created_at,
       COALESCE(
         pd.picked_up_at,
         sti.picked_up_at,
         pd.pickup_scheduled_at,
         sti.pickup_scheduled_at,
         rl.dispatched_at
       ) AS pickup_date,
       COALESCE(rl.dispatch_mode, sti.pickup_method) AS dispatch_mode,
       sti.pickup_method,
       COALESCE(sti.pickup_courier_name, rl.courier_name) AS courier_name,
       COALESCE(sti.pickup_awb, rl.awb_number) AS awb_number,
       rl.porter_tracking_id,
       COALESCE(u.name, u.email) AS assignee_name,
       COALESCE(
         sti.ttspl_id,
         sti.unique_serial_number,
         NULLIF(split_part(rl.serial_number->>0, '|', 3), '')
       ) AS ttspl,
       COALESCE(
         sti.serial_number,
         NULLIF(split_part(rl.serial_number->>0, '|', 2), '')
       ) AS serial_number,
       COALESCE(sti.brand, rl.brand) AS brand,
       COALESCE(sti.model, rl.model_name) AS model,
       COALESCE(sti.pickup_type, st.complaint_type, 'return') AS pickup_type,
       sti.picked_up_at,
       sti.visited_at,
       sti.customer_otp_verified_at,
       sti.warehouse_received_at,
       sti.warehouse_esign_at,
       st.pickup_address AS ticket_pickup_address,
       rl.customer_shipping_address,
       st.ticket_address
     FROM delivery_challan_lines rl
     LEFT JOIN support_tickets st ON st.id = rl.support_ticket_id
     LEFT JOIN support_ticket_items sti
       ON sti.item_type = 'pickup'
      AND (
        sti.return_dc_number = rl.dc_number
        OR (sti.return_dc_number IS NULL AND sti.ticket_id = rl.support_ticket_id)
      )
     LEFT JOIN users u ON u.user_id = COALESCE(sti.pickup_assigned_to, sti.assigned_to)
     LEFT JOIN LATERAL (
       SELECT MIN(p.picked_up_at) AS picked_up_at,
              MIN(p.pickup_scheduled_at) AS pickup_scheduled_at
         FROM support_ticket_items p
        WHERE p.item_type = 'pickup'
          AND (
            p.return_dc_number = rl.dc_number
            OR (p.return_dc_number IS NULL AND p.ticket_id = rl.support_ticket_id)
          )
     ) pd ON TRUE
     WHERE rl.movement_type = 'return'${searchSql}${dateSql}${statusSql}${appendReturnDcAssignedFilter('rl', assignedUserId, params)}
     ORDER BY rl.created_at DESC NULLS LAST, rl.dc_number, sti.id NULLS LAST`,
    params
  );

  return rows.map((row) => {
    const addr = formatReturnAddressParts(
      row.ticket_pickup_address || row.customer_shipping_address || row.ticket_address
    );
    const mapped = {
      ...row,
      city: addr.city,
      state: addr.state,
      pincode: addr.pincode,
      address: addr.line,
    };
    return {
      ...mapped,
      current_location: describeReturnLaptopLocation(mapped),
    };
  });
}

/** Full Return DC detail — units, pickup items, POD, e-signatures, PDF. */
async function getReturnDcDetail(rdcNumber) {
  await healReturnDcPickupLinks();

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

  await ensureReturnDcPickupItems(pool, dcl);

  const itemsRes = await pool.query(
    `SELECT sti.*,
            COALESCE(sti.technician_esign_name, u_tech_esign.name, u_tech_esign.email, u1.name, u1.email) AS tech_name,
            COALESCE(sti.warehouse_esign_name, u2.name, u2.email) AS warehouse_receiver_name,
            vsn.inventory_status,
            vsn.current_customer_id
       FROM support_ticket_items sti
       LEFT JOIN users u1 ON u1.user_id = COALESCE(sti.pickup_assigned_to, sti.assigned_to)
       LEFT JOIN users u_tech_esign ON u_tech_esign.user_id = sti.technician_esign_by
       LEFT JOIN users u2 ON u2.user_id = COALESCE(sti.warehouse_esign_by, sti.warehouse_received_by)
       LEFT JOIN LATERAL (
         SELECT v.inventory_status, v.current_customer_id
           FROM vendor_serial_numbers v
          WHERE v.deleted_at IS NULL
            AND (
              v.inventory_asset_code = COALESCE(sti.ttspl_id, sti.unique_serial_number)
              OR v.serial_number = sti.serial_number
            )
          ORDER BY
            CASE WHEN v.inventory_asset_code = COALESCE(sti.ttspl_id, sti.unique_serial_number) THEN 0 ELSE 1 END,
            v.serial_id ASC
          LIMIT 1
       ) vsn ON TRUE
      WHERE sti.item_type = 'pickup'
        AND COALESCE(sti.status, '') NOT IN ('cancelled')
        AND (
          sti.return_dc_number = $1
          OR (sti.return_dc_number IS NULL AND sti.ticket_id = $2)
        )
      ORDER BY sti.id ASC`,
    [rdcNumber, dcl.support_ticket_id]
  );
  let pickupItems = itemsRes.rows;
  if (pickupItems.some((i) => !i.return_dc_number)) {
    await pool.query(
      `UPDATE support_ticket_items SET return_dc_number = $1, updated_at = NOW()
        WHERE ticket_id = $2 AND item_type = 'pickup'
          AND return_dc_number IS NULL
          AND COALESCE(status, '') NOT IN ('cancelled', 'closed', 'resolved', 'inventory_updated')`,
      [rdcNumber, dcl.support_ticket_id]
    );
    pickupItems = pickupItems
      .filter((i) => i.status !== 'cancelled')
      .map((i) => ({ ...i, return_dc_number: i.return_dc_number || rdcNumber }));
  }

  pickupItems = pickupItems.filter((i) => i.status !== 'cancelled');

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
    remarks: (dcl.remarks || '').trim() || null,
    created_at: dcl.created_at,
    dispatched_at: dcl.dispatched_at,
    delivered_at: dcl.delivered_at,
    unit_count: pickupItems.length || dcl.quantity || 1,
    units,
    customer_otp_code: pickupItems[0]?.customer_otp_code || pickupItems[0]?.otp_code || null,
    customer_otp_verified_at: pickupItems.length && pickupItems.every((i) => i.customer_otp_verified_at)
      ? pickupItems.find((i) => i.customer_otp_verified_at)?.customer_otp_verified_at
      : null,
    gate_inward_at: pickupItems.length && pickupItems.every((i) => i.gate_inward_at)
      ? pickupItems.find((i) => i.gate_inward_at)?.gate_inward_at
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
      gate_inward_at: i.gate_inward_at,
      floor_ticket_id: i.floor_ticket_id,
    })),
    floor_ticket_ids: pickupItems.map((i) => i.floor_ticket_id).filter(Boolean),
    esign: {
      technician_url: techItem?.technician_esign_url || null,
      technician_name: techItem?.tech_name || null,
      technician_at: techItem?.technician_esign_at || null,
      warehouse_url: whItem?.warehouse_esign_url || null,
      warehouse_name: whItem?.warehouse_receiver_name || null,
      warehouse_at: whItem?.warehouse_esign_at || null,
    },
    ...evaluateReturnDcWarehouseConfirm(pickupItems, units, dcl),
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

async function getOperationCounts({
  role = null,
  userId = null,
  restrictDispatchSale = false,
  restrictDispatchRental = false,
  restrictDispatchAll = false,
} = {}) {
  const saleScope = salesOrderScopeWhere('sale');
  const rentalScope = salesOrderScopeWhere('rental');
  const saleParams = [];
  const rentalParams = [];
  const allParams = [];
  const saleDispatchFilter = dispatchWorkflowListFilterClauses(saleParams, {
    role, userId, restrictDispatchWorkflow: restrictDispatchSale,
  }).sql;
  const rentalDispatchFilter = dispatchWorkflowListFilterClauses(rentalParams, {
    role, userId, restrictDispatchWorkflow: restrictDispatchRental,
  }).sql;
  const allDispatchFilter = dispatchWorkflowListFilterClauses(allParams, {
    role, userId, restrictDispatchWorkflow: restrictDispatchAll,
  }).sql;
  const saleWhere = saleDispatchFilter ? `WHERE ${saleScope} AND ${saleDispatchFilter}` : `WHERE ${saleScope}`;
  const rentalWhere = rentalDispatchFilter ? `WHERE ${rentalScope} AND ${rentalDispatchFilter}` : `WHERE ${rentalScope}`;
  const allWhere = allDispatchFilter ? `WHERE ${allDispatchFilter}` : '';
  const [q, so, soSale, soRental, dc, rdcPairs, rdcLines] = await Promise.all([
    pool.query(`SELECT COUNT(DISTINCT quotation_number)::int AS c FROM sales_quotations`),
    pool.query(`SELECT COUNT(DISTINCT sales_order_number)::int AS c FROM sales_order_lines ${allWhere}`, allParams),
    pool.query(`SELECT COUNT(DISTINCT sales_order_number)::int AS c FROM sales_order_lines ${saleWhere}`, saleParams),
    pool.query(`SELECT COUNT(DISTINCT sales_order_number)::int AS c FROM sales_order_lines ${rentalWhere}`, rentalParams),
    pool.query(`SELECT COUNT(*)::int AS c FROM delivery_challan_lines WHERE COALESCE(movement_type, 'outbound') = 'outbound'`),
    countReturnDcPickupPairs(),
    pool.query(`SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines WHERE movement_type = 'return'`),
  ]);
  return {
    quotations: q.rows[0]?.c || 0,
    sales_orders: so.rows[0]?.c || 0,
    sales_orders_sale: soSale.rows[0]?.c || 0,
    sales_orders_rental: soRental.rows[0]?.c || 0,
    delivery_challans: dc.rows[0]?.c || 0,
    return_dc: rdcPairs || 0,
    return_dc_lines: rdcLines.rows[0]?.c || 0,
  };
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

function filterSpecRows(rows, { brand, model_name, processor, generation, ram, storage, isSale }) {
  // Model is OPTIONAL (Phase 14): when provided it must match, otherwise we match
  // purely on processor + generation + RAM + storage so equivalent laptops with
  // a different model label still surface.
  const model = model_name?.trim();

  return rows.filter((row) => {
    const r = enrichSerialSpecs(row);
    const pdModel = r.pd_model || r.product_model_name || '';
    const brandHint = brand || r.brand || '';

    if (model) {
      if (isSale) {
        if (!partialSpecMatch(pdModel, model) && !partialSpecMatch(r.product_model_name, model)) {
          return false;
        }
      } else if (!normalizedModelMatch(pdModel, model, brandHint) &&
          !normalizedModelMatch(r.product_model_name, model, brandHint)) {
        return false;
      }
    }
    if (!normalizedSpecMatch(r.processor, processor, 'processors')) return false;
    if (!normalizedSpecMatch(r.generation, generation, 'generations')) return false;
    if (!normalizedSpecMatch(r.ram, ram, 'ram')) return false;
    if (!normalizedSpecMatch(r.storage, storage, 'storage')) return false;
    if (isSale && !r.po_id) return false;
    return true;
  });
}

/**
 * Laravel getAllProductFromInventoryUsingModelIfSaleNew / getAllProductFromInventoryUsingModelNew
 * — vendor_product_inventory (in_stock) + product_details specs + serial_numbers unique code.
 */
/**
 * Units that finished QC after a customer return can stay inventory_status=returned
 * even when qc_status=passed — heal them so SO attach / Ready to Rent lists work.
 */
async function healStaleReturnedPassedSerials(db = pool) {
  await db.query(
    `UPDATE vendor_serial_numbers vsn SET
        inventory_status = 'in_stock',
        updated_at = NOW()
      WHERE vsn.deleted_at IS NULL
        AND COALESCE(NULLIF(TRIM(vsn.qc_status), ''), NULLIF(TRIM(vsn.extra->>'status'), ''), 'pending') = 'passed'
        AND vsn.inventory_status = 'returned'
        AND NOT EXISTS (
          SELECT 1 FROM tickets t
           WHERE t.vendor_serial_id = vsn.serial_id
             AND t.status IN ('in_progress', 'on_hold', 'diagnosis_failed', 'out_for_repair')
        )`
  );
}

/**
 * Dispatch QC fail can detach a serial from the SO, but completing the rework ticket
 * used to force inventory_status=reserved anyway — heal those units for attach/search.
 */
async function healStaleReservedPassedSerials(db = pool) {
  await db.query(
    `UPDATE vendor_serial_numbers vsn SET
        inventory_status = 'in_stock',
        extra = (COALESCE(vsn.extra, '{}'::jsonb) - 'awaiting_inventory_receive')
                || jsonb_build_object('status', 'passed'),
        updated_at = NOW()
      WHERE vsn.deleted_at IS NULL
        AND COALESCE(NULLIF(TRIM(vsn.qc_status), ''), NULLIF(TRIM(vsn.extra->>'status'), ''), 'pending') = 'passed'
        AND vsn.inventory_status = 'reserved'
        AND NOT EXISTS (
          SELECT 1 FROM sales_order_serials sos
           WHERE sos.serial_id = vsn.serial_id
             AND sos.status = 'attached'
        )`
  );
}

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
  const hasSpecFilter = Boolean(brand || model || processor || generation || ram || storage);
  const responseLimit = Math.min(Number(limit) || 200, 500);
  // Spec-based SO attach must scan the full QC-passed pool — not only the 500 newest serials.
  const candidateLimit = hasSpecFilter ? 25000 : responseLimit;

  await healStaleReturnedPassedSerials();
  await healStaleReservedPassedSerials();

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

  // Single authoritative source: vendor_serial_numbers (QC-passed, shelf-available)
  // enriched with vendor_product_details specs. Anything procured and received
  // becomes selectable here automatically — no separate catalog/vpi table, so
  // status can no longer drift (the legacy vendor_product_inventory is bypassed).
  // Legacy ERP rows may still have inventory_status = in_repair after repair even
  // though qc_status is passed — treat any non-deployed QC-passed unit as pickable.
  const OFF_SHELF_INVENTORY_STATUSES = [
    'reserved', 'dispatch_ready', 'in_transit', 'rented', 'on_demo', 'sold',
    'returned', 'scrapped', 'out_stock', 'qc_failed',
    'out_for_repare', 'out_for_return',
  ];
  const offShelfList = OFF_SHELF_INVENTORY_STATUSES.map((s) => `'${s}'`).join(', ');
  // Never offer units already allocated on any SO (even if inventory_status drifted
  // back to in_stock after Dispatch QC pass).
  const notAlreadyAttachedSql = `
       AND NOT EXISTS (
         SELECT 1 FROM sales_order_serials sos_att
          WHERE sos_att.serial_id = vsn.serial_id
            AND sos_att.status = 'attached'
       )`;

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
       COALESCE(NULLIF(vsn.extra->>'storage', ''), NULLIF(vsn.extra->>'ssd', ''), vpd.storage) AS storage,
       vpo.purchase_order_type
     FROM vendor_serial_numbers vsn
     LEFT JOIN vendor_product_details vpd
       ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
     LEFT JOIN vendor_purchase_orders vpo
       ON vpo.po_id = vsn.po_id AND vpo.deleted_at IS NULL
     WHERE vsn.deleted_at IS NULL
       AND COALESCE(vsn.qc_status, vsn.extra->>'status', 'pending') = 'passed'
       AND COALESCE(vsn.inventory_status, 'in_stock') NOT IN (${offShelfList})
       ${notAlreadyAttachedSql}
       ${searchSql}
     ORDER BY vsn.serial_id DESC
     LIMIT ${candidateLimit}`,
    params
  );

  let rows = filterSpecRows(result.rows, {
    brand,
    model_name: model,
    processor,
    generation,
    ram,
    storage,
    isSale,
  });

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
         AND NOT EXISTS (
           SELECT 1 FROM sales_order_serials sos_att
            WHERE sos_att.serial_id = vsn.serial_id
              AND sos_att.status = 'attached'
         )
       ORDER BY vsn.serial_id DESC
       LIMIT ${candidateLimit}`
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
        return (
          normalizedModelMatch(row.product_model_name || row.pd_model, model, brand || row.brand) ||
          (isSale && partialSpecMatch(row.product_model_name || row.pd_model, model))
        );
      });

    rows = filterSpecRows(rows, {
      brand,
      model_name: model,
      processor,
      generation,
      ram,
      storage,
      isSale,
    });
  }

  // Brand is intentionally NOT applied here — warehouse attaches by specs
  // (processor, generation, RAM, storage). Sales-side brand labels are catalog
  // choices and must not hide otherwise matching inventory.

  return rows.slice(0, responseLimit).map(mapInventorySerialRow);
}

// ---------------------------------------------------------------------------
// GST / amount calculation (shared by SO/DC detail endpoints + PDF service).
// Mirrors the ERP logic: GST applies to the goods subtotal only. Intra-state
// (buyer state == seller state, Haryana) splits into CGST 9% + SGST 9%; inter-
// state charges IGST 18%. Shipping and security are added after tax (untaxed).
// ---------------------------------------------------------------------------
const SELLER_STATE_CODE = '06'; // Rentfoxxy / Gorefurbo are registered in Haryana.
const GST_RATE = 18;

function parseAddressField(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeStateForGst(state) {
  return String(state || '').trim().toLowerCase().replace(/\s+/g, '_');
}

/** Prefer shipping-address state for GST; fall back to stored supply_state. */
function resolveSupplyStateFromAddress(shippingAddress, explicitSupplyState = '') {
  const addr = parseAddressField(shippingAddress);
  const fromAddr = addr?.state;
  if (fromAddr && String(fromAddr).trim()) {
    return normalizeStateForGst(fromAddr);
  }
  return normalizeStateForGst(explicitSupplyState);
}

function isIntraState(supplyState, sellerStateCode = SELLER_STATE_CODE) {
  const s = normalizeStateForGst(supplyState);
  if (!s) return true; // Unknown buyer state -> assume intra (seller's own state).
  const seller = String(sellerStateCode || SELLER_STATE_CODE).toLowerCase();
  return s === seller || s === '06' || s === 'hr' || s.includes('haryana');
}

/** One laptop's security share on an SO line (one month rent when applicable). */
function perUnitSecurityForLine(line) {
  const qty = Number(line.main_qty ?? line.quantity ?? 1) || 1;
  const type = String(line.security_type || '').toLowerCase();
  if (type === 'one_month_rental') {
    const rate = Number(line.rate || 0);
    if (rate > 0) return +rate.toFixed(2);
  }
  return +(Number(line.security_amount || 0) / qty).toFixed(2);
}

/** Total security deposit for a sales order. */
function sumSoSecurityAmount(lines = []) {
  if (!lines.length) return 0;
  const type = String(lines[0].security_type || '').toLowerCase();
  if (type === 'one_month_rental') {
    return +lines.reduce((sum, line) => {
      const qty = Number(line.main_qty ?? line.quantity ?? 1) || 1;
      const rate = Number(line.rate || 0);
      if (rate > 0) return sum + rate * qty;
      return sum + Number(line.security_amount || 0);
    }, 0).toFixed(2);
  }
  return +Number(lines[0].security_amount || 0).toFixed(2);
}

/** Security for a DC from the serials (and their SO lines) in that shipment. */
function computeDcSecurityFromSerials(serials = [], soLines = []) {
  const lineMap = new Map(soLines.map((l) => [Number(l.id), l]));
  let total = 0;
  for (const serial of serials) {
    const line = lineMap.get(Number(serial.line_id));
    if (line) total += perUnitSecurityForLine(line);
  }
  return +total.toFixed(2);
}

/** Recompute per-line one-month security; returns new SO total or null. */
async function recalcSoSecurityIfOneMonthRental(db, salesOrderNumber) {
  const typeRes = await db.query(
    `SELECT security_type FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
    [salesOrderNumber]
  );
  if (String(typeRes.rows[0]?.security_type || '').toLowerCase() !== 'one_month_rental') {
    return null;
  }
  await db.query(
    `UPDATE sales_order_lines
        SET security_amount = ROUND((COALESCE(rate, 0) * COALESCE(main_qty, quantity, 1))::numeric, 2)
      WHERE sales_order_number = $1`,
    [salesOrderNumber]
  );
  const sumRes = await db.query(
    `SELECT COALESCE(SUM(security_amount), 0) AS total
       FROM sales_order_lines WHERE sales_order_number = $1`,
    [salesOrderNumber]
  );
  return +Number(sumRes.rows[0]?.total || 0).toFixed(2);
}

/** Refresh stored security on each DC from its dispatched serials. */
async function syncDcSecurityForSo(db, salesOrderNumber) {
  const soLinesRes = await db.query(
    `SELECT * FROM sales_order_lines WHERE sales_order_number = $1`,
    [salesOrderNumber]
  );
  const soLines = soLinesRes.rows;
  if (!soLines.length) return;

  const dcs = await db.query(
    `SELECT DISTINCT dc_number FROM delivery_challan_lines WHERE sales_order_number = $1`,
    [salesOrderNumber]
  );
  for (const { dc_number: dcNumber } of dcs.rows) {
    const serialsRes = await db.query(
      `SELECT line_id FROM sales_order_serials
        WHERE sales_order_number = $1 AND dc_number = $2 AND status <> 'removed'`,
      [salesOrderNumber, dcNumber]
    );
    const security = computeDcSecurityFromSerials(serialsRes.rows, soLines);
    await db.query(
      `UPDATE delivery_challan_lines SET security_amount = $1, updated_at = NOW() WHERE dc_number = $2`,
      [security, dcNumber]
    );
  }
}

function computeGstBreakdown({
  subtotal = 0, shipping = 0, security = 0, supplyState = '',
  sellerStateCode = SELLER_STATE_CODE, gstRate = GST_RATE,
  gstOnShipping = false,
} = {}) {
  const sub = +Number(subtotal || 0).toFixed(2);
  const ship = +Number(shipping || 0).toFixed(2);
  const sec = +Number(security || 0).toFixed(2);
  const taxable = +(sub + (gstOnShipping ? ship : 0)).toFixed(2);
  const gstTotal = +(taxable * gstRate / 100).toFixed(2);
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
    shipping_taxable: !!gstOnShipping,
    security: sec,
    taxable,
    grand_total: +(taxable + gstTotal + (gstOnShipping ? 0 : ship) + sec).toFixed(2),
  };
}

// Build a per-config rate lookup from a sales order's lines, used to price a DC
// (delivery_challan_lines has no rate column — the rate lives on the SO).
async function getSalesOrderRateMap(salesOrderNumber) {
  const r = await pool.query(
    `SELECT id, brand, model_name, rate FROM sales_order_lines WHERE sales_order_number = $1`,
    [salesOrderNumber]
  );
  const map = new Map();
  const byLineId = new Map();
  const byModel = new Map();
  let rateSum = 0;
  for (const row of r.rows) {
    const rate = Number(row.rate || 0);
    rateSum += rate;
    const key = `${String(row.brand || '').trim().toLowerCase()}|${String(row.model_name || '').trim().toLowerCase()}`;
    if (!map.has(key)) map.set(key, rate);
    if (row.id != null) byLineId.set(Number(row.id), rate);
    const modelKey = String(row.model_name || '').trim().toLowerCase();
    if (modelKey && !byModel.has(modelKey)) byModel.set(modelKey, rate);
  }
  return {
    map,
    byLineId,
    byModel,
    single: r.rows.length === 1 ? Number(r.rows[0].rate || 0) : null,
    avgRate: r.rows.length ? rateSum / r.rows.length : 0,
  };
}

function normalizeModelForRateMatch(model, brand) {
  let m = String(model || '').trim().toLowerCase();
  const b = String(brand || '').trim().toLowerCase();
  if (!m) return m;
  if (b && m.startsWith(`${b} `)) return m.slice(b.length + 1).trim();
  const first = m.split(/\s+/)[0];
  if (first && first !== b && m.startsWith(`${first} `)) {
    return m.slice(first.length + 1).trim();
  }
  return m;
}

function rateForDcLine(line, rateMap) {
  if (!rateMap) return 0;
  const modelRaw = String(line.model_name || '').trim().toLowerCase();
  const brandRaw = String(line.brand || '').trim().toLowerCase();
  const key = `${brandRaw}|${modelRaw}`;
  if (rateMap.map.has(key)) return rateMap.map.get(key);

  const modelNorm = normalizeModelForRateMatch(line.model_name, line.brand);
  if (modelNorm && rateMap.byModel?.has(modelNorm)) return rateMap.byModel.get(modelNorm);

  for (const [k, v] of rateMap.map) {
    const mapModel = k.split('|')[1] || '';
    if (!modelNorm || !mapModel) continue;
    if (mapModel === modelNorm || modelNorm.includes(mapModel) || mapModel.includes(modelNorm)) return v;
  }
  if (rateMap.single != null) return rateMap.single;
  if (rateMap.avgRate > 0) return rateMap.avgRate;
  return 0;
}

/** Per-serial SO line rates for a DC (authoritative when allocations exist). */
async function getDcSerialRateLookup(dcNumber, salesOrderNumber) {
  const r = await pool.query(
    `SELECT sos.serial_id, sos.ttspl_id, sos.serial_number,
            sol.id AS line_id,
            sol.brand, sol.model_name, sol.processor, sol.generation,
            sol.ram, sol.storage, sol.gpu, sol.screen_size,
            sol.rate, sol.remark,
            ro.old_machine_serial
       FROM sales_order_serials sos
       INNER JOIN sales_order_lines sol
         ON sol.id = sos.line_id AND sol.sales_order_number = sos.sales_order_number
       LEFT JOIN LATERAL (
         SELECT old_machine_serial
           FROM support_replacement_orders ro
          WHERE ro.sales_order_line_id = sol.id
            AND COALESCE(TRIM(ro.old_machine_serial), '') <> ''
          ORDER BY ro.id DESC
          LIMIT 1
       ) ro ON TRUE
      WHERE sos.sales_order_number = $2
        AND sos.status <> 'removed'
        AND (
          sos.dc_number = $1
          OR EXISTS (
            SELECT 1
              FROM delivery_challan_lines dcl
             WHERE dcl.dc_number = $1
               AND dcl.sales_order_number = $2
               AND COALESCE(dcl.movement_type, 'outbound') <> 'return'
               AND (
                 dcl.serial_number::text ILIKE '%' || COALESCE(sos.serial_number, '') || '%'
                 OR (sos.ttspl_id IS NOT NULL AND dcl.serial_number::text ILIKE '%' || sos.ttspl_id || '%')
                 OR (sos.serial_id IS NOT NULL AND dcl.serial_number::text ILIKE '%' || sos.serial_id::text || '%')
               )
          )
        )`,
    [dcNumber, salesOrderNumber]
  );
  const bySerialId = new Map();
  const byTtspl = new Map();
  const bySerialNumber = new Map();
  for (const row of r.rows) {
    const payload = {
      rate: Number(row.rate || 0),
      brand: row.brand || '',
      model_name: row.model_name || '',
      processor: row.processor || '',
      generation: row.generation || '',
      ram: row.ram || '',
      storage: row.storage || '',
      gpu: row.gpu || '',
      screen_size: row.screen_size || '',
      remark: effectiveReplacementLineRemark(row.remark, row.old_machine_serial),
    };
    if (row.serial_id) bySerialId.set(Number(row.serial_id), payload);
    if (row.ttspl_id) byTtspl.set(String(row.ttspl_id).toUpperCase(), payload);
    if (row.serial_number) bySerialNumber.set(String(row.serial_number).toUpperCase(), payload);
  }
  return { bySerialId, byTtspl, bySerialNumber, rows: r.rows };
}

function lookupSerialRemark(lookup, { serialId, serialNumber, ttspl } = {}) {
  const hit = lookupSerialRate(lookup, { serialId, serialNumber, ttspl });
  return hit?.remark || '';
}

/** Resolve display remarks for SO line ids (replacement TTSPL when remark is generic). */
async function resolveSoLineRemarksForLines(lineIds = []) {
  const ids = [...new Set((lineIds || []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const r = await pool.query(
    `SELECT sol.id, sol.remark, ro.old_machine_serial
       FROM sales_order_lines sol
       LEFT JOIN LATERAL (
         SELECT old_machine_serial
           FROM support_replacement_orders ro
          WHERE ro.sales_order_line_id = sol.id
            AND COALESCE(TRIM(ro.old_machine_serial), '') <> ''
          ORDER BY ro.id DESC
          LIMIT 1
       ) ro ON TRUE
      WHERE sol.id = ANY($1::int[])`,
    [ids]
  );
  return r.rows.map((row) => effectiveReplacementLineRemark(row.remark, row.old_machine_serial));
}

function lookupSerialRate(lookup, { serialId, serialNumber, ttspl } = {}) {
  if (!lookup) return null;
  if (serialId && lookup.bySerialId.has(Number(serialId))) {
    return lookup.bySerialId.get(Number(serialId));
  }
  const tt = ttspl ? String(ttspl).toUpperCase() : '';
  const sn = serialNumber ? String(serialNumber).toUpperCase() : '';
  if (tt && lookup.byTtspl.has(tt)) return lookup.byTtspl.get(tt);
  if (sn && lookup.bySerialNumber.has(sn)) return lookup.bySerialNumber.get(sn);
  if (sn && lookup.byTtspl.has(sn)) return lookup.byTtspl.get(sn);
  return null;
}

/** Billing rows grouped by SO line for DC detail UI / totals. */
async function getDcBillingLines(dcNumber, salesOrderNumber) {
  const r = await pool.query(
    `SELECT sol.brand, sol.model_name, sol.processor, sol.generation,
            sol.ram, sol.storage, sol.gpu, sol.screen_size, sol.rate,
            COUNT(*)::int AS quantity
       FROM sales_order_serials sos
       INNER JOIN sales_order_lines sol
         ON sol.id = sos.line_id AND sol.sales_order_number = sos.sales_order_number
      WHERE sos.sales_order_number = $2
        AND sos.status <> 'removed'
        AND (
          sos.dc_number = $1
          OR EXISTS (
            SELECT 1
              FROM delivery_challan_lines dcl
             WHERE dcl.dc_number = $1
               AND dcl.sales_order_number = $2
               AND COALESCE(dcl.movement_type, 'outbound') <> 'return'
               AND (
                 dcl.serial_number::text ILIKE '%' || COALESCE(sos.serial_number, '') || '%'
                 OR (sos.ttspl_id IS NOT NULL AND dcl.serial_number::text ILIKE '%' || sos.ttspl_id || '%')
                 OR (sos.serial_id IS NOT NULL AND dcl.serial_number::text ILIKE '%' || sos.serial_id::text || '%')
               )
          )
        )
      GROUP BY sol.id, sol.brand, sol.model_name, sol.processor, sol.generation,
               sol.ram, sol.storage, sol.gpu, sol.screen_size, sol.rate
      ORDER BY MIN(sos.allocation_id)`,
    [dcNumber, salesOrderNumber]
  );
  return r.rows.map((row) => {
    const rate = Number(row.rate || 0);
    const qty = Number(row.quantity || 1);
    return {
      brand: row.brand || '',
      model_name: row.model_name || '',
      processor: row.processor || '',
      generation: row.generation || '',
      ram: row.ram || '',
      storage: row.storage || '',
      gpu: row.gpu || '',
      screen_size: row.screen_size || '',
      rate,
      quantity: qty,
      amount: +(rate * qty).toFixed(2),
    };
  });
}

/** Authoritative per-unit spec for DC/PDF (GRN extra → product details → inventory). */
async function loadSerialInventorySpec({ serialId, serialNumber, ttspl } = {}) {
  const sid = serialId ? Number(serialId) : null;
  const sn = serialNumber ? String(serialNumber).trim() : '';
  const tt = ttspl ? String(ttspl).trim() : '';
  if (!sid && !sn && !tt) return null;

  // Match SO Laptops tab / DC detail: extra → GRN received → VPD → inventory.
  const r = await pool.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code,
            COALESCE(
              NULLIF(TRIM(vsn.extra->>'brand'), ''),
              NULLIF(TRIM(vsn.grn_received_config->>'brand'), ''),
              NULLIF(TRIM(vpd.brand), ''),
              NULLIF(TRIM(inv.brand), '')
            ) AS brand,
            COALESCE(
              NULLIF(TRIM(vsn.extra->>'model'), ''),
              NULLIF(TRIM(vsn.extra->>'model_name'), ''),
              NULLIF(TRIM(vsn.grn_received_config->>'model'), ''),
              NULLIF(TRIM(vpd.model), ''),
              NULLIF(TRIM(inv.model), '')
            ) AS model,
            COALESCE(
              NULLIF(TRIM(vsn.extra->>'processor'), ''),
              NULLIF(TRIM(vsn.grn_received_config->>'processor'), ''),
              NULLIF(TRIM(vpd.processor), ''),
              NULLIF(TRIM(inv.processor), '')
            ) AS processor,
            COALESCE(
              NULLIF(TRIM(vsn.extra->>'generation'), ''),
              NULLIF(TRIM(vsn.grn_received_config->>'generation'), ''),
              NULLIF(TRIM(vpd.generation), ''),
              NULLIF(TRIM(inv.generation), '')
            ) AS generation,
            COALESCE(
              NULLIF(TRIM(vsn.extra->>'ram'), ''),
              NULLIF(TRIM(vsn.grn_received_config->>'ram'), ''),
              NULLIF(TRIM(vpd.ram), ''),
              NULLIF(TRIM(inv.ram), '')
            ) AS ram,
            COALESCE(
              NULLIF(TRIM(vsn.extra->>'storage'), ''),
              NULLIF(TRIM(vsn.extra->>'ssd'), ''),
              NULLIF(TRIM(vsn.grn_received_config->>'storage'), ''),
              NULLIF(TRIM(vpd.storage), ''),
              NULLIF(TRIM(inv.storage), '')
            ) AS storage,
            COALESCE(
              NULLIF(TRIM(vsn.extra->>'gpu'), ''),
              NULLIF(TRIM(vpd.gpu), ''),
              NULLIF(TRIM(inv.gpu), '')
            ) AS gpu,
            COALESCE(
              NULLIF(TRIM(vsn.extra->>'screen_size'), ''),
              NULLIF(TRIM(vpd.screen_size), ''),
              NULLIF(TRIM(inv.screen_size), '')
            ) AS screen_size
       FROM vendor_serial_numbers vsn
       LEFT JOIN vendor_product_details vpd
         ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
       LEFT JOIN LATERAL (
         SELECT i.brand, i.model, i.processor, i.generation, i.ram, i.storage, i.gpu, i.screen_size
           FROM inventory i
          WHERE i.serial_number = vsn.serial_number
             OR i.machine_number = vsn.serial_number
             OR i.machine_number = vsn.inventory_asset_code
          LIMIT 1
       ) inv ON TRUE
      WHERE vsn.deleted_at IS NULL
        AND (
          ($1::int IS NOT NULL AND vsn.serial_id = $1)
          OR ($2::text <> '' AND (vsn.serial_number = $2 OR vsn.inventory_asset_code = $2))
          OR ($3::text <> '' AND vsn.inventory_asset_code = $3)
        )
      LIMIT 1`,
    [sid, sn, tt]
  );
  return r.rows[0] || null;
}

/** Billing rows grouped by SO line for DC detail UI / totals. */
async function resolveDcBilling(dcNumber, lines) {
  const head = lines[0] || {};
  const son = head.sales_order_number;
  if (dcNumber && son) {
    const billingLines = await getDcBillingLines(dcNumber, son);
    if (billingLines.length) {
      const subtotal = billingLines.reduce((s, l) => s + l.amount, 0);
      return { billingLines, subtotal };
    }
  }

  const rateMapCache = new Map();
  let subtotal = 0;
  const billingLines = [];
  for (const line of lines) {
    const lineSon = line.sales_order_number || son;
    if (lineSon && !rateMapCache.has(lineSon)) {
      rateMapCache.set(lineSon, await getSalesOrderRateMap(lineSon));
    }
    const qty = Number(line.quantity || line.main_qty || 1) || 1;
    const rate = lineSon ? rateForDcLine(line, rateMapCache.get(lineSon)) : 0;
    const amount = +(rate * qty).toFixed(2);
    line.rate = rate;
    line.amount = amount;
    billingLines.push({
      brand: line.brand,
      model_name: line.model_name,
      rate,
      quantity: qty,
      amount,
    });
    subtotal += amount;
  }
  return { billingLines, subtotal };
}

module.exports = {
  nextDocumentNumber,
  nextFinancialYearNumber,
  peekFinancialYearNumber,
  currentFinancialYear,
  computeGstBreakdown,
  perUnitSecurityForLine,
  sumSoSecurityAmount,
  computeDcSecurityFromSerials,
  recalcSoSecurityIfOneMonthRental,
  syncDcSecurityForSo,
  resolveSupplyStateFromAddress,
  parseAddressField,
  normalizeStateForGst,
  isIntraState,
  GST_RATE,
  SELLER_STATE_CODE,
  getSalesOrderRateMap,
  rateForDcLine,
  getDcSerialRateLookup,
  lookupSerialRate,
  lookupSerialRemark,
  resolveSoLineRemarksForLines,
  loadSerialInventorySpec,
  getDcBillingLines,
  resolveDcBilling,
  entityForQuotationType,
  entityDocType,
  salesOrderScopeWhere,
  listCustomersForOrderScope,
  generateToken,
  getQuotationRemainingQty,
  getSalesOrderRemainingQty,
  getSalesOrderFulfillmentCounts,
  getSalesOrderDispatchDate,
  withPendingQty,
  deriveSalesOrderListStatus,
  listQuotationsGrouped,
  getQuotationLines,
  listSalesOrdersGrouped,
  getSalesOrderLines,
  getSalesOrderSupportMeta,
  listDeliveryChallansGrouped,
  getDeliveryChallanLines,
  listReturnDeliveryChallans,
  listReturnDcLaptopExportRows,
  getReturnDcDetail,
  userCanAccessReturnDc,
  healReturnDcPickupLinks,
  ensureReturnDcPickupItems,
  evaluateReturnDcWarehouseConfirm,
  getOperationCounts,
  searchAvailableInventory,
  healStaleReturnedPassedSerials,
  assertSalesOrderVisibleToUser,
};
