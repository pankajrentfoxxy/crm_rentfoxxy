/**
 * Data access for vendor_serial_numbers inventory list segments.
 */
const pool = require('../config/db');
const {
  buildInventorySerialListQuery,
  listSelectSql,
  attachSerialTicketIds,
} = require('../utils/inventoryListQuery');

function useBatchTickets(segment) {
  return segment === 'passed';
}

function buildQueries(options) {
  const {
    segment,
    search = '',
    dateFrom,
    dateTo,
    specFilters = {},
    cursor,
  } = options;

  const batchTickets = useBatchTickets(segment);
  const listQuery = buildInventorySerialListQuery({
    segment,
    search,
    dateFrom,
    dateTo,
    specFilters,
    includeTicketJoins: !batchTickets,
    includeGrnJoin: true,
  });
  const countQuery = buildInventorySerialListQuery({
    segment,
    search,
    dateFrom,
    dateTo,
    specFilters,
    includeTicketJoins: false,
    includeGrnJoin: false,
  });

  let cursorSql = '';
  const listParams = [...listQuery.params];
  if (cursor) {
    listParams.push(cursor);
    cursorSql = ` AND s.updated_at < $${listParams.length}::timestamptz`;
  }

  return {
    batchTickets,
    listQuery,
    countQuery,
    cursorSql,
    listParams,
    selectSql: listSelectSql(!batchTickets),
  };
}

async function countInventoryRows(options) {
  const { countQuery } = buildQueries(options);
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total ${countQuery.fromSql}`,
    countQuery.params
  );
  return r.rows[0]?.total || 0;
}

async function fetchInventoryPage(options) {
  const { segment, limit, offset } = options;
  const { batchTickets, listQuery, cursorSql, listParams, selectSql } = buildQueries(options);

  const queryParams = [...listParams];
  if (!options.cursor) {
    queryParams.push(limit, offset);
    const limitIdx = queryParams.length - 1;
    const offsetIdx = queryParams.length;
    const rowsR = await pool.query(
      `SELECT ${selectSql} ${listQuery.fromSql}${cursorSql}
       ORDER BY s.updated_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams
    );
    if (batchTickets) await attachSerialTicketIds(pool, rowsR.rows);
    return rowsR.rows;
  }

  queryParams.push(limit);
  const limitIdx = queryParams.length;
  const rowsR = await pool.query(
    `SELECT ${selectSql} ${listQuery.fromSql}${cursorSql}
     ORDER BY s.updated_at DESC
     LIMIT $${limitIdx}`,
    queryParams
  );
  if (batchTickets) await attachSerialTicketIds(pool, rowsR.rows);
  return rowsR.rows;
}

module.exports = {
  useBatchTickets,
  countInventoryRows,
  fetchInventoryPage,
};
