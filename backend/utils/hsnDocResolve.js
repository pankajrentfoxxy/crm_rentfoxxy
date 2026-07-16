/**
 * DB helpers to resolve transaction type / HSN for SO, DC, and Return DC documents.
 */
const {
  resolveDefaultHsn,
  txnTypeFromQuotation,
  txnTypeFromEntity,
  resolveHsnForDisplay,
} = require('../constants/hsnDefaults');

/**
 * Resolve transaction type for a return/outbound DC from linked SO or original DC.
 * @returns {Promise<'rental'|'sale'>}
 */
async function resolveTxnTypeForDc(client, {
  salesOrderNumber = null,
  originalDcNumber = null,
  entityCode = null,
  quotationType = null,
} = {}) {
  if (quotationType) return txnTypeFromQuotation(quotationType);

  if (salesOrderNumber) {
    const r = await client.query(
      `SELECT quotation_type, entity_code
         FROM sales_order_lines
        WHERE sales_order_number = $1
        ORDER BY id ASC
        LIMIT 1`,
      [salesOrderNumber]
    );
    if (r.rows[0]?.quotation_type) {
      return txnTypeFromQuotation(r.rows[0].quotation_type);
    }
    if (r.rows[0]?.entity_code) {
      return txnTypeFromEntity(r.rows[0].entity_code);
    }
  }

  if (originalDcNumber) {
    const r = await client.query(
      `SELECT dcl.entity_code, dcl.sales_order_number, dcl.hsn_code,
              sol.quotation_type AS so_quotation_type
         FROM delivery_challan_lines dcl
         LEFT JOIN LATERAL (
           SELECT quotation_type FROM sales_order_lines
            WHERE sales_order_number = dcl.sales_order_number
            ORDER BY id ASC LIMIT 1
         ) sol ON TRUE
        WHERE dcl.dc_number = $1
          AND COALESCE(dcl.movement_type, 'outbound') <> 'return'
        ORDER BY dcl.id ASC
        LIMIT 1`,
      [originalDcNumber]
    );
    const row = r.rows[0];
    if (row?.so_quotation_type) return txnTypeFromQuotation(row.so_quotation_type);
    if (row?.entity_code) return txnTypeFromEntity(row.entity_code);
    if (row?.sales_order_number) {
      return resolveTxnTypeForDc(client, { salesOrderNumber: row.sales_order_number });
    }
  }

  if (entityCode) return txnTypeFromEntity(entityCode);
  return 'rental';
}

/** Default HSN for a return DC (or any DC) from linked documents. Never blank. */
async function resolveHsnForReturnDc(client, opts = {}) {
  const txn = await resolveTxnTypeForDc(client, opts);
  return resolveDefaultHsn(txn);
}

/** Prefer SO line HSN; else default from SO quotation_type. */
async function resolveHsnFromSalesOrder(client, salesOrderNumber, { role, override } = {}) {
  const {
    resolveHsnForPersist,
  } = require('../constants/hsnDefaults');

  if (!salesOrderNumber) {
    return resolveHsnForPersist({ transactionType: 'rental', override, role });
  }

  const r = await client.query(
    `SELECT hsn_code, quotation_type, entity_code
       FROM sales_order_lines
      WHERE sales_order_number = $1
      ORDER BY id ASC
      LIMIT 1`,
    [salesOrderNumber]
  );
  const row = r.rows[0];
  if (!row) {
    return resolveHsnForPersist({ transactionType: 'rental', override, role });
  }

  const stored = String(row.hsn_code || '').trim();
  if (stored && !(override != null && String(override).trim() !== '')) {
    return stored;
  }

  return resolveHsnForPersist({
    quotationType: row.quotation_type,
    transactionType: row.quotation_type
      ? undefined
      : txnTypeFromEntity(row.entity_code),
    override,
    role,
  });
}

function displayHsnForLine(line, quotationTypeHint) {
  return resolveHsnForDisplay(line?.hsn_code, {
    quotationType: line?.quotation_type || quotationTypeHint,
    transactionType: line?.quotation_type || quotationTypeHint
      ? undefined
      : (line?.entity_code ? txnTypeFromEntity(line.entity_code) : undefined),
  });
}

module.exports = {
  resolveTxnTypeForDc,
  resolveHsnForReturnDc,
  resolveHsnFromSalesOrder,
  displayHsnForLine,
};
