/**
 * Shared SQL builder for inventory list + export (vendor_serial_numbers segments).
 */
const { buildListWhere } = require('../services/inventoryManagementService');
const { appendDateRangeClauses } = require('./dateRangeFilter');
const { buildSerialSpecFilter } = require('./inventorySpecFilter');

const TICKET_JOIN_SQL = `
  LEFT JOIN LATERAL (
    SELECT tk.ticket_id FROM tickets tk
    WHERE tk.vendor_serial_id = s.serial_id
    ORDER BY tk.created_at DESC LIMIT 1
  ) latest_ticket ON true
  LEFT JOIN LATERAL (
    SELECT tk.ticket_id, st.stage_name
    FROM tickets tk
    LEFT JOIN stages st ON st.stage_id = tk.current_stage_id
    WHERE tk.vendor_serial_id = s.serial_id
      AND tk.status IN ('in_progress', 'on_hold')
    ORDER BY tk.created_at DESC LIMIT 1
  ) active_ticket ON true
`;

const LIST_SELECT_SQL = `
  s.serial_id, s.serial_number, s.inventory_asset_code, s.qc_status, s.remark,
  s.extra, s.created_at AS serial_created_at, s.updated_at AS serial_updated_at,
  s.rental_start_date, s.grn_id, s.inventory_status,
  p.po_id, p.purchase_order_number, p.purchase_order_type, p.vendor_id, p.line_items,
  p.product_details_legacy_ids,
  v.business_name, v.first_name || ' ' || v.last_name AS vendor_name,
  g.meta->>'product_id' AS grn_product_id,
  latest_ticket.ticket_id,
  active_ticket.ticket_id AS active_floor_ticket_id,
  active_ticket.stage_name AS ticket_stage_name
`;

const LIST_SELECT_SQL_NO_TICKETS = `
  s.serial_id, s.serial_number, s.inventory_asset_code, s.qc_status, s.remark,
  s.extra, s.created_at AS serial_created_at, s.updated_at AS serial_updated_at,
  s.rental_start_date, s.grn_id, s.inventory_status,
  p.po_id, p.purchase_order_number, p.purchase_order_type, p.vendor_id, p.line_items,
  p.product_details_legacy_ids,
  v.business_name, v.first_name || ' ' || v.last_name AS vendor_name,
  g.meta->>'product_id' AS grn_product_id,
  NULL::int AS ticket_id,
  NULL::int AS active_floor_ticket_id,
  NULL::text AS ticket_stage_name
`;

/** Batch-load ticket IDs for a page of serials (replaces per-row LATERAL joins). */
async function attachSerialTicketIds(pool, rows) {
  if (!rows?.length) return rows;
  const serialIds = rows.map((r) => r.serial_id);
  const [latestR, activeR] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (vendor_serial_id) vendor_serial_id, ticket_id
         FROM tickets
        WHERE vendor_serial_id = ANY($1::int[])
        ORDER BY vendor_serial_id, created_at DESC`,
      [serialIds]
    ),
    pool.query(
      `SELECT DISTINCT ON (tk.vendor_serial_id) tk.vendor_serial_id, tk.ticket_id, st.stage_name AS ticket_stage_name
         FROM tickets tk
         LEFT JOIN stages st ON st.stage_id = tk.current_stage_id
        WHERE tk.vendor_serial_id = ANY($1::int[])
          AND tk.status IN ('in_progress', 'on_hold')
        ORDER BY tk.vendor_serial_id, tk.created_at DESC`,
      [serialIds]
    ),
  ]);
  const latestBySerial = new Map(latestR.rows.map((r) => [r.vendor_serial_id, r.ticket_id]));
  const activeBySerial = new Map(activeR.rows.map((r) => [r.vendor_serial_id, r.ticket_id]));
  const stageBySerial = new Map(activeR.rows.map((r) => [r.vendor_serial_id, r.ticket_stage_name]));
  for (const row of rows) {
    row.ticket_id = latestBySerial.get(row.serial_id) ?? null;
    row.active_floor_ticket_id = activeBySerial.get(row.serial_id) ?? null;
    row.ticket_stage_name = stageBySerial.get(row.serial_id) ?? null;
  }
  return rows;
}

function listSelectSql(includeTicketJoins) {
  return includeTicketJoins ? LIST_SELECT_SQL : LIST_SELECT_SQL_NO_TICKETS;
}

function buildInventorySerialListQuery({
  segment,
  search = '',
  dateFrom,
  dateTo,
  specFilters = {},
  includeTicketJoins = true,
  includeGrnJoin = true,
  ticketStageFilter = 'all',
}) {
  const params = [];
  const { sql: segmentSql } = buildListWhere(segment, params);

  let ticketStageSql = '';
  if (segment === 'qc_process' && ticketStageFilter === 'qc1_qc2') {
    ticketStageSql = ` AND EXISTS (
      SELECT 1 FROM tickets tk
      INNER JOIN stages st ON st.stage_id = tk.current_stage_id
      WHERE tk.vendor_serial_id = s.serial_id
        AND tk.status IN ('in_progress', 'on_hold')
        AND st.stage_name IN ('QC1', 'QC2')
    )`;
  }

  let searchSql = '';
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    searchSql = ` AND (
      s.serial_number ILIKE $${i}
      OR COALESCE(s.inventory_asset_code, '') ILIKE $${i}
      OR p.purchase_order_number ILIKE $${i}
      OR COALESCE(v.business_name, '') ILIKE $${i}
      OR s.extra::text ILIKE $${i}
    )`;
  }

  const dateClauses = appendDateRangeClauses({
    column: 'updated_at', dateFrom, dateTo, params, tableAlias: 's',
  });
  const dateSql = dateClauses.length ? ` AND ${dateClauses.join(' AND ')}` : '';

  const specFilter = buildSerialSpecFilter(specFilters, params);

  const grnJoinSql = includeGrnJoin
    ? 'LEFT JOIN vendor_goods_received_notes g ON g.grn_id = s.grn_id AND g.deleted_at IS NULL'
    : '';

  const ticketJoinSql = includeTicketJoins ? TICKET_JOIN_SQL : '';

  const fromSql = `
    FROM vendor_serial_numbers s
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
    ${grnJoinSql}
    ${specFilter.joinSql}
    ${ticketJoinSql}
    WHERE s.deleted_at IS NULL
    ${segmentSql}
    ${ticketStageSql}
    ${searchSql}${dateSql}${specFilter.whereSql}
  `;

  return { fromSql, params, specFilter, segmentSql, searchSql, dateSql };
}

module.exports = {
  TICKET_JOIN_SQL,
  LIST_SELECT_SQL,
  LIST_SELECT_SQL_NO_TICKETS,
  listSelectSql,
  attachSerialTicketIds,
  buildInventorySerialListQuery,
};
