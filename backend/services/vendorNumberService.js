const pool = require('../config/db');

const PO_PREFIX = 'PO-';
const PO_PAD = 4;
/** Standard migrated ERP numbers: PO-0141 (not PO-0027-ERP28). */
const PO_STANDARD_RE = /^PO-\d+$/;
/** Advisory lock id for vendor PO number allocation (create). */
const PO_ALLOC_LOCK = 840001;

function formatPurchaseOrderNumber(n) {
  return `${PO_PREFIX}${String(n).padStart(PO_PAD, '0')}`;
}

function parseStandardPoSuffix(purchaseOrderNumber) {
  const s = String(purchaseOrderNumber || '').trim();
  if (!PO_STANDARD_RE.test(s)) return null;
  const n = parseInt(s.slice(PO_PREFIX.length), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Highest numeric suffix among standard PO-#### numbers (ignores migration suffixes like PO-0027-ERP28).
 */
async function maxStandardPoNumericSuffix(db = pool) {
  const r = await db.query(
    `SELECT COALESCE(MAX((substring(purchase_order_number FROM '[0-9]+$'))::int), 0) AS n
       FROM vendor_purchase_orders
      WHERE deleted_at IS NULL
        AND purchase_order_number ~ '^PO-[0-9]+$'`
  );
  return Number(r.rows[0]?.n || 0);
}

/**
 * Preview next PO for form-meta / next-number (does not reserve).
 */
async function peekNextPurchaseOrderNumber() {
  const max = await maxStandardPoNumericSuffix();
  return formatPurchaseOrderNumber(max + 1);
}

/**
 * Allocate a PO number inside an open transaction (prevents duplicate under concurrency).
 * @param {import('pg').PoolClient} client
 * @param {string|null} preferred — value from form-meta; used if still free
 */
async function allocatePurchaseOrderNumber(client, preferred = null) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [PO_ALLOC_LOCK]);

  const preferredTrim = preferred ? String(preferred).trim() : '';
  if (preferredTrim) {
    const taken = await client.query(
      `SELECT 1 FROM vendor_purchase_orders
        WHERE purchase_order_number = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [preferredTrim]
    );
    if (!taken.rows.length) return preferredTrim;
  }

  let candidate = (await maxStandardPoNumericSuffix(client)) + 1;
  for (;;) {
    const formatted = formatPurchaseOrderNumber(candidate);
    const taken = await client.query(
      `SELECT 1 FROM vendor_purchase_orders
        WHERE purchase_order_number = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [formatted]
    );
    if (!taken.rows.length) return formatted;
    candidate += 1;
  }
}

/** @deprecated Use peekNextPurchaseOrderNumber or allocatePurchaseOrderNumber */
async function nextPurchaseOrderNumber(options = {}) {
  if (options.client) {
    return allocatePurchaseOrderNumber(options.client, options.preferred ?? null);
  }
  return peekNextPurchaseOrderNumber();
}

async function maxStandardSpoNumericSuffix(db = pool) {
  const r = await db.query(
    `SELECT COALESCE(MAX((substring(purchase_order_number FROM '[0-9]+$'))::int), 0) AS n
       FROM vendor_spare_parts_purchase_orders
      WHERE deleted_at IS NULL
        AND purchase_order_number ~ '^SP-PO-[0-9]+$'`
  );
  return Number(r.rows[0]?.n || 0);
}

function formatSparePartsPurchaseOrderNumber(n) {
  return `SP-PO-${String(n).padStart(4, '0')}`;
}

async function peekNextSparePartsPurchaseOrderNumber() {
  const max = await maxStandardSpoNumericSuffix();
  return formatSparePartsPurchaseOrderNumber(max + 1);
}

async function nextSparePartsPurchaseOrderNumber() {
  return peekNextSparePartsPurchaseOrderNumber();
}

module.exports = {
  PO_PREFIX,
  PO_STANDARD_RE,
  formatPurchaseOrderNumber,
  parseStandardPoSuffix,
  maxStandardPoNumericSuffix,
  peekNextPurchaseOrderNumber,
  allocatePurchaseOrderNumber,
  nextPurchaseOrderNumber,
  peekNextSparePartsPurchaseOrderNumber,
  nextSparePartsPurchaseOrderNumber,
};
