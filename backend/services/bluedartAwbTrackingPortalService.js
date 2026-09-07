/**
 * Standalone BlueDart AWB tracking for the CRM portal (manual AWB + DC-linked AWBs).
 */
const pool = require('../config/db');
const bluedartTracking = require('./bluedartTrackingService');
const { splitAwbTokens } = require('../utils/bluedartAwbUtils');

function normalizeAwbList(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.flatMap((v) => splitAwbTokens(v)))];
  }
  return splitAwbTokens(raw);
}

function formatTrackingRow(t, link = {}) {
  const scans = Array.isArray(t.scans) ? t.scans : [];
  const locationFromScan = scans.find((s) => s?.location)?.location || scans[0]?.location || null;
  const isDl = bluedartTracking.isDeliveredShipment(t);
  return {
    awb_number: t.awb_number,
    courier_name: link.courier_name || 'BlueDart',
    status: t.status || null,
    status_type: t.status_type || null,
    status_date: t.status_date || null,
    status_time: t.status_time || null,
    last_updated: [t.status_date, t.status_time].filter(Boolean).join(' ') || null,
    current_location: locationFromScan || t.destination || t.origin || null,
    received_by: isDl ? (t.received_by || null) : null,
    origin: t.origin || null,
    destination: t.destination || null,
    expected_delivery: t.expected_delivery || null,
    found: t.found !== false,
    scans,
    dc_number: link.dc_number || null,
    sales_order_number: link.sales_order_number || null,
    customer_name: link.customer_name || null,
    dc_status: link.dc_status || null,
    ttspl_id: link.ttspl_id || null,
    serial_number: link.serial_number || null,
    laptop: link.ttspl_id || link.serial_number
      ? `${link.ttspl_id || ''}${link.ttspl_id && link.serial_number ? ' / ' : ''}${link.serial_number || ''}`.trim()
      : null,
  };
}

async function lookupAwbLinks(awbNumbers) {
  const list = normalizeAwbList(awbNumbers);
  if (!list.length) return new Map();

  const r = await pool.query(
    `SELECT DISTINCT ON (awb_token)
            awb_token,
            dc_number,
            sales_order_number,
            customer_name,
            status AS dc_status,
            courier_name,
            dispatched_at,
            delivered_at
       FROM (
         SELECT regexp_split_to_table(
                  regexp_replace(TRIM(COALESCE(dcl.awb_number, '')), '[/|,;\\s]+', ',', 'g'),
                  ','
                ) AS awb_token,
                dcl.dc_number,
                dcl.sales_order_number,
                dcl.customer_name,
                dcl.status,
                dcl.courier_name,
                dcl.dispatched_at,
                dcl.delivered_at,
                dcl.id
           FROM delivery_challan_lines dcl
          WHERE dcl.awb_number IS NOT NULL
            AND TRIM(dcl.awb_number) <> ''
            AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'
       ) x
      WHERE awb_token = ANY($1::text[])
      ORDER BY awb_token, id DESC`,
    [list]
  );

  const unitRes = await pool.query(
    `SELECT dsu.awb_number,
            dsu.dc_number,
            dsu.ttspl_id,
            dsu.serial_number,
            dcl.sales_order_number,
            dcl.customer_name,
            dcl.status AS dc_status,
            COALESCE(dsu.courier_name, dcl.courier_name) AS courier_name
       FROM dc_shipment_units dsu
       JOIN delivery_challan_lines dcl ON dcl.dc_number = dsu.dc_number
      WHERE dsu.awb_number = ANY($1::text[])
      ORDER BY dsu.id DESC`,
    [list]
  ).catch(() => ({ rows: [] }));

  const byAwb = new Map();
  for (const row of r.rows) {
    const key = String(row.awb_token || '').trim();
    if (!key || byAwb.has(key)) continue;
    byAwb.set(key, {
      dc_number: row.dc_number,
      sales_order_number: row.sales_order_number,
      customer_name: row.customer_name,
      dc_status: row.dc_status,
      courier_name: row.courier_name,
    });
  }
  for (const row of unitRes.rows || []) {
    const key = String(row.awb_number || '').trim();
    if (!key) continue;
    const prev = byAwb.get(key) || {};
    byAwb.set(key, {
      ...prev,
      dc_number: prev.dc_number || row.dc_number,
      sales_order_number: prev.sales_order_number || row.sales_order_number,
      customer_name: prev.customer_name || row.customer_name,
      dc_status: prev.dc_status || row.dc_status,
      courier_name: prev.courier_name || row.courier_name,
      ttspl_id: row.ttspl_id,
      serial_number: row.serial_number,
    });
  }
  return byAwb;
}

async function trackAwbs(awbNumbers) {
  const list = normalizeAwbList(awbNumbers);
  if (!list.length) {
    const err = new Error('Enter a valid BlueDart AWB number (8+ digits)');
    err.status = 400;
    throw err;
  }
  if (!bluedartTracking.isConfigured()) {
    const err = new Error('BlueDart tracking is not configured on the server');
    err.status = 503;
    throw err;
  }

  const links = await lookupAwbLinks(list);
  const raw = await bluedartTracking.trackAwbs(list);
  return raw.map((t) => formatTrackingRow(t, links.get(String(t.awb_number || '').trim()) || {}));
}

async function listRegisteredAwbs({ search, page = 1, limit = 50 } = {}) {
  const params = [];
  let where = `
    COALESCE(dcl.movement_type, 'outbound') = 'outbound'
    AND dcl.awb_number IS NOT NULL
    AND TRIM(dcl.awb_number) <> ''
    AND (
      dcl.courier_name ILIKE '%bluedart%'
      OR dcl.courier_name ILIKE '%blue dart%'
      OR dcl.dispatch_mode = 'courier'
    )
  `;
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const n = params.length;
    where += ` AND (
      dcl.dc_number ILIKE $${n}
      OR dcl.awb_number ILIKE $${n}
      OR dcl.customer_name ILIKE $${n}
      OR dcl.sales_order_number ILIKE $${n}
    )`;
  }

  const offset = (Math.max(1, page) - 1) * limit;
  params.push(limit, offset);

  const [countRes, rowsRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT dcl.dc_number)::int AS total
         FROM delivery_challan_lines dcl
        WHERE ${where}`,
      params.slice(0, -2)
    ),
    pool.query(
      `SELECT DISTINCT ON (dcl.dc_number)
              dcl.dc_number,
              dcl.sales_order_number,
              dcl.customer_name,
              dcl.status,
              dcl.courier_name,
              dcl.awb_number,
              dcl.dispatched_at,
              dcl.delivered_at,
              dcl.created_at
         FROM delivery_challan_lines dcl
        WHERE ${where}
        ORDER BY dcl.dc_number, dcl.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
  ]);

  const deliveries = (rowsRes.rows || []).flatMap((row) => {
    const tokens = splitAwbTokens(row.awb_number);
    if (!tokens.length) return [{ ...row, awb_number: row.awb_number }];
    return tokens.map((awb) => ({ ...row, awb_number: awb }));
  });

  const total = countRes.rows[0]?.total || 0;
  return {
    rows: deliveries,
    pagination: {
      page: Math.max(1, page),
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

module.exports = {
  normalizeAwbList,
  formatTrackingRow,
  lookupAwbLinks,
  trackAwbs,
  listRegisteredAwbs,
};
