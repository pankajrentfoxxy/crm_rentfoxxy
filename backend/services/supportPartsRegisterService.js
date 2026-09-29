'use strict';
const pool = require('../config/db');
const { pickSortColumn, pickSortDirection } = require('../utils/sqlSafety');

/**
 * Register of every service-parts document, newest first — the Carret Parts
 * desk "All challans" list (the other lists there show open items only).
 *
 * Three kinds, one row each:
 *   technician_challan — support_part_challans (warehouse → technician)
 *   part_dc            — delivery_challan_lines, dc_purpose 'part_delivery' (warehouse → customer)
 *   return_dc          — delivery_challan_lines, dc_purpose 'part_return'   (old part back, RPDC)
 * A Part DC / RPDC is written as one header line today; DISTINCT ON keeps it one
 * row even if a DC ever carries more. Parts are counted from the requests on it.
 *
 * Filters: type, status (the document's own status value), search (number,
 * customer, technician, ticket, TTSPL), from/to on the document date.
 * Every value is a $N parameter; sort column and direction are whitelisted.
 */
const TYPES = ['technician_challan', 'part_dc', 'return_dc'];
const SORT_COLUMNS = { date: 'doc_date', number: 'number', customer: 'customer_name', type: 'type' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const REGISTER_SQL = `
  WITH reg AS (
    SELECT 'technician_challan'::text AS type,
           sc.challan_number AS number, sc.id AS challan_id, NULL::text AS dc_number,
           sc.created_at AS doc_date, sc.status,
           st.customer_name, u.name AS technician_name,
           ('STK-' || LPAD(st.id::text, 4, '0')) AS ticket_number, st.id AS ticket_id,
           sc.ttspl_id,
           COALESCE(ci.parts_count, 0)::int AS parts_count,
           NULL::text AS ship_by, NULL::text AS courier_name, NULL::text AS awb_number
      FROM support_part_challans sc
      LEFT JOIN users u ON u.user_id = sc.issued_to
      LEFT JOIN support_tickets st ON st.id = sc.support_ticket_id
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(i.quantity, 1)) AS parts_count
          FROM support_challan_items i WHERE i.challan_id = sc.id
      ) ci ON TRUE
    UNION ALL
    SELECT CASE d.dc_purpose WHEN 'part_delivery' THEN 'part_dc' ELSE 'return_dc' END,
           d.dc_number, NULL::int, d.dc_number,
           d.created_at, d.status,
           d.customer_name, pr.technician_name,
           ('STK-' || LPAD(st.id::text, 4, '0')), st.id,
           pr.ttspl_id,
           COALESCE(pr.parts_count, 0)::int,
           d.ship_by, d.courier_name, d.awb_number
      FROM (
        SELECT DISTINCT ON (dcl.dc_number) dcl.*
          FROM delivery_challan_lines dcl
         WHERE dcl.dc_purpose IN ('part_delivery', 'part_return')
         ORDER BY dcl.dc_number, dcl.id
      ) d
      LEFT JOIN support_tickets st ON st.id = d.support_ticket_id
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(spr.quantity, 1)) AS parts_count,
               string_agg(DISTINCT u.name, ', ') AS technician_name,
               MIN(spr.ttspl_id) AS ttspl_id
          FROM support_part_requests spr
          LEFT JOIN users u ON u.user_id = spr.assigned_to_tech
         WHERE (d.dc_purpose = 'part_delivery' AND spr.customer_dc_number = d.dc_number)
            OR (d.dc_purpose = 'part_return'   AND spr.return_part_dc_number = d.dc_number)
      ) pr ON TRUE
  )`;

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function listChallansRegister(query = {}, db = pool) {
  const limit = clampInt(query.limit, 50, 1, 200);
  const offset = clampInt(query.offset, 0, 0, 1e7);
  const params = [];
  const where = [];

  const type = String(query.type || '').trim();
  if (type) {
    if (!TYPES.includes(type)) throw Object.assign(new Error('Unknown type'), { status: 400 });
    params.push(type);
    where.push(`type = $${params.length}`);
  }
  const status = String(query.status || '').trim();
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  const search = String(query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(`(number ILIKE $${i} OR customer_name ILIKE $${i} OR technician_name ILIKE $${i}
                 OR ticket_number ILIKE $${i} OR ttspl_id ILIKE $${i})`);
  }
  const from = String(query.from || '').trim();
  if (from) {
    if (!DATE_RE.test(from)) throw Object.assign(new Error('from must be YYYY-MM-DD'), { status: 400 });
    params.push(from);
    where.push(`doc_date >= $${params.length}::date`);
  }
  const to = String(query.to || '').trim();
  if (to) {
    if (!DATE_RE.test(to)) throw Object.assign(new Error('to must be YYYY-MM-DD'), { status: 400 });
    params.push(to);
    where.push(`doc_date < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const sortCol = pickSortColumn(query.sort, SORT_COLUMNS, 'date');
  const sortDir = query.dir ? pickSortDirection(query.dir) : 'DESC';
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const filterParams = params.slice();
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const [page, count] = await Promise.all([
    db.query(
      `${REGISTER_SQL}
       SELECT reg.* FROM reg
         ${whereSql}
        ORDER BY ${sortCol} ${sortDir} NULLS LAST, number ${sortDir}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    ),
    db.query(`${REGISTER_SQL} SELECT COUNT(*)::int AS total FROM reg ${whereSql}`, filterParams),
  ]);
  return { rows: page.rows, total: count.rows[0]?.total || 0, limit, offset };
}

module.exports = { listChallansRegister, REGISTER_TYPES: TYPES };
