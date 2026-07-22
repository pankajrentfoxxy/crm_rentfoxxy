/**
 * Reconcile vendor_serial_numbers deployment anchors (current_customer_id, DC, status)
 * from delivered outbound delivery challans. Fixes ERP-migrated units stuck on out_stock
 * without a customer link.
 */
const pool = require('../config/db');
const inventorySM = require('./inventoryStateMachine');

const DC_SERIAL_ELEMENTS_SQL = `
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(dcl.serial_number) = 'array' THEN dcl.serial_number ELSE '[]'::jsonb END
  ) AS elem
`;

function parseDcSerialElemSql(alias = 'elem') {
  return {
    serialId: `NULLIF(REGEXP_REPLACE(split_part(${alias}, '|', 1), '[^0-9]', '', 'g'), '')::int`,
    serialNumber: `NULLIF(split_part(${alias}, '|', 2), '')`,
    ttspl: `NULLIF(split_part(${alias}, '|', 3), '')`,
  };
}

async function fetchDeploymentGaps(db, { customerId = null } = {}) {
  const p = parseDcSerialElemSql('elem');
  const params = [];
  let customerFilter = '';
  if (customerId != null) {
    params.push(customerId);
    customerFilter = ` AND dcl.customer_id = $${params.length}`;
  }

  const { rows } = await db.query(
    `WITH outbound AS (
       SELECT
         dcl.dc_number,
         dcl.customer_id,
         dcl.delivered_at,
         dcl.delivery_completed_at,
         dcl.entity_code,
         dcl.sales_order_number,
         dcl.dispatch_mode,
         ${p.serialId} AS serial_id,
         ${p.serialNumber} AS serial_number
       FROM delivery_challan_lines dcl
       ${DC_SERIAL_ELEMENTS_SQL}
       WHERE COALESCE(dcl.movement_type, 'outbound') = 'outbound'
         AND dcl.status = 'delivered'
         ${customerFilter}
     ),
     latest_outbound AS (
       SELECT DISTINCT ON (serial_id) *
         FROM outbound
        WHERE serial_id IS NOT NULL
        ORDER BY serial_id, COALESCE(delivered_at, delivery_completed_at) DESC NULLS LAST
     ),
     returns AS (
       SELECT
         ${p.serialId} AS serial_id,
         MAX(COALESCE(dcl.delivered_at, dcl.delivery_completed_at)) AS last_return_at
       FROM delivery_challan_lines dcl
       ${DC_SERIAL_ELEMENTS_SQL}
       WHERE dcl.movement_type = 'return'
         AND dcl.status = 'delivered'
       GROUP BY 1
     )
     SELECT
       lo.serial_id,
       lo.serial_number,
       lo.dc_number,
       lo.customer_id,
       lo.entity_code,
       lo.dispatch_mode,
       COALESCE(lo.delivered_at, lo.delivery_completed_at) AS delivered_at,
       vsn.inventory_status,
       vsn.current_customer_id,
       vsn.current_dc_number,
       COALESCE(sos_qt.quotation_type, sol_qt.quotation_type, 'rental') AS quotation_type
     FROM latest_outbound lo
     JOIN vendor_serial_numbers vsn ON vsn.serial_id = lo.serial_id AND vsn.deleted_at IS NULL
     LEFT JOIN returns r ON r.serial_id = lo.serial_id
     LEFT JOIN LATERAL (
       SELECT sol.quotation_type
         FROM sales_order_serials sos
         JOIN sales_order_lines sol ON sol.sales_order_number = sos.sales_order_number
        WHERE sos.serial_id = lo.serial_id
          AND sos.dc_number = lo.dc_number
          AND sos.status <> 'removed'
        ORDER BY sos.allocation_id DESC
        LIMIT 1
     ) sos_qt ON TRUE
     LEFT JOIN LATERAL (
       SELECT sol.quotation_type
         FROM sales_order_lines sol
        WHERE sol.sales_order_number = lo.sales_order_number
        ORDER BY sol.id DESC
        LIMIT 1
     ) sol_qt ON TRUE
     WHERE vsn.inventory_status NOT IN ('scrapped')
       AND (
         r.last_return_at IS NULL
         OR r.last_return_at < COALESCE(lo.delivered_at, lo.delivery_completed_at)
       )
       AND (
         vsn.current_customer_id IS DISTINCT FROM lo.customer_id
         OR vsn.current_dc_number IS DISTINCT FROM lo.dc_number
         OR vsn.inventory_status IN ('out_stock', 'in_stock', 'passed', 'returned')
       )
     ORDER BY lo.customer_id, lo.delivered_at DESC`,
    params
  );
  return rows;
}

async function syncDeployedAssets(db, { customerId = null, actorName = 'deployed-assets-sync' } = {}) {
  const client = db || pool;
  const gaps = await fetchDeploymentGaps(client, { customerId });
  const results = [];

  for (const row of gaps) {
    try {
      const needsOverride = row.inventory_status === 'returned';
      const result = await inventorySM.markDelivered(client, row.serial_id, {
        quotationType: row.quotation_type,
        dcNumber: row.dc_number,
        customerId: row.customer_id,
        entityCode: row.entity_code || null,
        dispatchMode: row.dispatch_mode || 'courier',
        deliveredAt: row.delivered_at || new Date(),
        actorUserId: null,
        actorName,
        allowOverride: needsOverride,
      });
      results.push({
        serial_id: row.serial_id,
        serial_number: row.serial_number,
        customer_id: row.customer_id,
        dc_number: row.dc_number,
        ok: true,
        from: result.from,
        to: result.to,
      });
    } catch (err) {
      results.push({
        serial_id: row.serial_id,
        serial_number: row.serial_number,
        customer_id: row.customer_id,
        dc_number: row.dc_number,
        ok: false,
        error: err.message,
      });
    }
  }

  return {
    scanned: gaps.length,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    results,
  };
}

module.exports = {
  fetchDeploymentGaps,
  syncDeployedAssets,
};
