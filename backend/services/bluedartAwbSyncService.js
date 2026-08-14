'use strict';

/**
 * BlueDart TNT → CRM delivery sync.
 * Fetches undelivered BlueDart AWBs, tracks in batches, marks DCs delivered when StatusType=DL.
 */

const pool = require('../config/db');
const bluedartTracking = require('./bluedartTrackingService');
const { splitAwbTokens } = require('../utils/bluedartAwbUtils');

const ACTOR = { user_id: null, name: 'BlueDart TNT Sync' };
const SKIP_STATUSES = ['delivered', 'cancelled', 'rejected'];

let running = false;

function log(level, msg, meta) {
  const prefix = '[BlueDartAwbSync]';
  if (meta) {
    console[level](prefix, msg, meta);
  } else {
    console[level](prefix, msg);
  }
}

async function ensureTrackingColumns() {
  await pool.query(`
    ALTER TABLE delivery_challan_lines
      ADD COLUMN IF NOT EXISTS courier_tracking_status TEXT,
      ADD COLUMN IF NOT EXISTS courier_tracking_status_type TEXT,
      ADD COLUMN IF NOT EXISTS courier_tracking_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS courier_received_by TEXT
  `);
}

/**
 * Unique undelivered BlueDart AWB tokens → DC numbers.
 * Expands composite awb_number values (slash/comma separated).
 */
async function fetchPendingAwbGroups() {
  const r = await pool.query(
    `SELECT TRIM(awb_number) AS awb_raw,
            array_agg(DISTINCT dc_number) AS dc_numbers
       FROM delivery_challan_lines
      WHERE awb_number IS NOT NULL
        AND TRIM(awb_number) <> ''
        AND NOT (COALESCE(status, '') = ANY($1::text[]))
        AND COALESCE(movement_type, 'outbound') <> 'return'
        AND (
          courier_name ILIKE '%bluedart%'
          OR courier_name ILIKE '%blue dart%'
          OR courier_name IS NULL
          OR TRIM(courier_name) = ''
        )
      GROUP BY TRIM(awb_number)
      ORDER BY MIN(id)`,
    [SKIP_STATUSES]
  );

  /** @type {Map<string, { awb_number: string, dc_numbers: Set<string>, sibling_awbs: Set<string> }>} */
  const byAwb = new Map();
  /** dc → all AWB tokens on undelivered lines */
  const dcAwbs = new Map();

  for (const row of r.rows) {
    const tokens = splitAwbTokens(row.awb_raw);
    if (!tokens.length) continue;
    for (const dc of row.dc_numbers || []) {
      if (!dcAwbs.has(dc)) dcAwbs.set(dc, new Set());
      for (const t of tokens) dcAwbs.get(dc).add(t);
    }
    for (const awb of tokens) {
      if (!byAwb.has(awb)) {
        byAwb.set(awb, { awb_number: awb, dc_numbers: new Set(), sibling_awbs: new Set(tokens) });
      }
      const g = byAwb.get(awb);
      for (const dc of row.dc_numbers || []) g.dc_numbers.add(dc);
      for (const t of tokens) g.sibling_awbs.add(t);
    }
  }

  return [...byAwb.values()].map((g) => ({
    awb_number: g.awb_number,
    dc_numbers: [...g.dc_numbers],
    sibling_awbs: [...g.sibling_awbs],
    dc_awb_map: Object.fromEntries(
      [...g.dc_numbers].map((dc) => [dc, [...(dcAwbs.get(dc) || [])]])
    ),
  }));
}

async function updateTrackingFields(awb, shipment) {
  await pool.query(
    `UPDATE delivery_challan_lines
        SET courier_tracking_status = $2,
            courier_tracking_status_type = $3,
            courier_tracking_synced_at = NOW(),
            courier_received_by = COALESCE($4, courier_received_by),
            updated_at = NOW()
      WHERE NOT (COALESCE(status, '') = ANY($5::text[]))
        AND $1 = ANY(
          string_to_array(
            regexp_replace(TRIM(awb_number), '[/|,;\\s]+', ',', 'g'),
            ','
          )
        )`,
    [
      awb,
      shipment.status || null,
      shipment.status_type || null,
      shipment.received_by || null,
      SKIP_STATUSES,
    ]
  );

  const delivered = bluedartTracking.isDeliveredShipment(shipment);
  await pool.query(
    `UPDATE dc_shipment_units
        SET tracking_status = $2,
            tracking_status_type = $3,
            tracking_synced_at = NOW(),
            received_by = COALESCE($4, received_by),
            status = CASE WHEN $5 THEN 'delivered' ELSE status END,
            delivered_at = CASE WHEN $5 THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
            updated_at = NOW()
      WHERE awb_number = $1
        AND COALESCE(status, '') <> 'delivered'`,
    [
      awb,
      shipment.status || null,
      shipment.status_type || null,
      shipment.received_by || null,
      delivered,
    ]
  ).catch(() => {});
}

async function fireOnDeliveryRentalInvoice(dcNumber) {
  try {
    const { maybeInvoiceOnRentalDelivery } = require('./billingSchedulerService');
    const ctxRes = await pool.query(
      `SELECT dcl.customer_id,
              COALESCE(sol.quotation_type, sq.quotation_type, 'rental') AS quotation_type
         FROM delivery_challan_lines dcl
         LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
         LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
        WHERE dcl.dc_number = $1
        LIMIT 1`,
      [dcNumber]
    );
    const ctx = ctxRes.rows[0] || {};
    await maybeInvoiceOnRentalDelivery({
      customerId: ctx.customer_id || null,
      dcNumber,
      quotationType: ctx.quotation_type || 'rental',
    });
  } catch (err) {
    log('error', `on-delivery invoice failed for ${dcNumber}: ${err.message}`);
  }
}

/**
 * Mark all undelivered lines for a DC as delivered and finalize inventory / SO state.
 */
async function markDcDeliveredFromTracking(dcNumber, shipment) {
  const client = await pool.connect();
  try {
    const agg = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered
         FROM delivery_challan_lines WHERE dc_number = $1`,
      [dcNumber]
    );
    if (!agg.rows[0]?.total) {
      return { skipped: true, reason: 'dc_not_found' };
    }
    if (agg.rows[0].delivered === agg.rows[0].total) {
      return { skipped: true, reason: 'already_delivered' };
    }

    const deliveredAt =
      bluedartTracking.parseStatusTimestamp(shipment.status_date, shipment.status_time) || new Date();
    const receivedBy = shipment.received_by || null;
    const note = [
      'Auto-delivered via BlueDart TNT',
      shipment.status ? `Status: ${shipment.status}` : null,
      receivedBy ? `ReceivedBy: ${receivedBy}` : null,
      shipment.awb_number ? `AWB: ${shipment.awb_number}` : null,
    ].filter(Boolean).join(' | ');

    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE delivery_challan_lines
          SET status = 'delivered',
              delivered_at = COALESCE($2::timestamptz, NOW()),
              delivery_completed_at = COALESCE($2::timestamptz, NOW()),
              courier_tracking_status = $3,
              courier_tracking_status_type = $4,
              courier_tracking_synced_at = NOW(),
              courier_received_by = COALESCE($5, courier_received_by),
              delivery_notes = CASE
                WHEN delivery_notes IS NULL OR TRIM(delivery_notes) = '' THEN $6
                ELSE delivery_notes || E'\n' || $6
              END,
              updated_at = NOW()
        WHERE dc_number = $1
          AND NOT (COALESCE(status, '') = ANY($7::text[]))
        RETURNING id`,
      [
        dcNumber,
        deliveredAt.toISOString(),
        shipment.status || null,
        shipment.status_type || null,
        receivedBy,
        note,
        SKIP_STATUSES,
      ]
    );

    if (!upd.rowCount) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'no_lines_updated' };
    }

    const sm = require('../controllers/salesManagementController');
    await sm.finalizeDeliveryInventory(client, dcNumber, ACTOR);
    await client.query('COMMIT');

    await fireOnDeliveryRentalInvoice(dcNumber);
    return { delivered: true, lines: upd.rowCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * After all AWB tracking results are in:
 * - refresh tracking columns
 * - mark DC delivered only when every AWB for that DC is DL (multi-piece safe)
 */
async function applyTrackingResults(groups, shipmentByAwb, summary) {
  const dcMeta = new Map(); // dc → { awbs: Set, shipments: [] }

  for (const group of groups) {
    for (const dc of group.dc_numbers) {
      if (!dcMeta.has(dc)) {
        const awbs = group.dc_awb_map?.[dc] || group.sibling_awbs || [group.awb_number];
        dcMeta.set(dc, { awbs: new Set(awbs), shipments: [] });
      } else {
        for (const a of group.dc_awb_map?.[dc] || []) dcMeta.get(dc).awbs.add(a);
      }
    }
  }

  for (const [awb, shipment] of shipmentByAwb.entries()) {
    try {
      if (!shipment || shipment.found === false) {
        summary.not_found += 1;
        await updateTrackingFields(awb, shipment || { status: 'Not found', status_type: 'NF' });
        continue;
      }
      await updateTrackingFields(awb, shipment);
      summary.updated += 1;
    } catch (err) {
      summary.errors += 1;
      log('error', `Tracking field update failed for ${awb}: ${err.message}`);
    }
  }

  for (const [dcNumber, meta] of dcMeta.entries()) {
    const awbs = [...meta.awbs];
    const shipments = awbs.map((a) => shipmentByAwb.get(a)).filter(Boolean);
    if (!shipments.length) continue;

    const allDelivered = awbs.every((a) => {
      const s = shipmentByAwb.get(a);
      return s && s.found !== false && bluedartTracking.isDeliveredShipment(s);
    });
    if (!allDelivered) continue;

    // Prefer the latest delivered shipment for timestamp / received_by
    const primary =
      [...shipments].reverse().find((s) => bluedartTracking.isDeliveredShipment(s)) || shipments[0];

    try {
      const result = await markDcDeliveredFromTracking(dcNumber, primary);
      if (result.skipped) {
        summary.skipped += 1;
      } else if (result.delivered) {
        summary.delivered += 1;
        log('info', `Marked ${dcNumber} delivered (AWBs ${awbs.join(', ')})`);
      }
    } catch (dcErr) {
      summary.errors += 1;
      log('error', `Failed to mark ${dcNumber} delivered: ${dcErr.message}`);
    }
  }
}

/**
 * Full sync sweep. Safe to call from cron or admin trigger.
 * Returns summary stats; never throws for partial AWB failures.
 */
async function syncUndeliveredAwbs({ dryRun = false } = {}) {
  if (running) {
    return { success: false, skipped: true, reason: 'already_running' };
  }
  if (!bluedartTracking.isConfigured()) {
    return { success: false, skipped: true, reason: 'not_configured' };
  }

  running = true;
  const startedAt = Date.now();
  const summary = {
    success: true,
    awbs: 0,
    batches: 0,
    delivered: 0,
    updated: 0,
    skipped: 0,
    not_found: 0,
    errors: 0,
    dry_run: !!dryRun,
  };

  try {
    await ensureTrackingColumns().catch((err) => {
      log('warn', `ensureTrackingColumns: ${err.message}`);
    });

    const groups = await fetchPendingAwbGroups();
    summary.awbs = groups.length;
    if (!groups.length) {
      log('info', 'No undelivered BlueDart AWBs to sync');
      return summary;
    }

    const byAwb = new Map(groups.map((g) => [g.awb_number, g]));
    const { batchSize } = bluedartTracking.getConfig();
    const batches = bluedartTracking.chunk([...byAwb.keys()], batchSize);
    summary.batches = batches.length;

    log('info', `Syncing ${groups.length} AWB(s) in ${batches.length} batch(es) of ≤${batchSize}`);

    if (dryRun) {
      for (const batch of batches) {
        for (const awb of batch) {
          summary.updated += 1;
          log('info', `[dry-run] would track ${awb} → DCs ${byAwb.get(awb).dc_numbers.join(', ')}`);
        }
      }
      summary.duration_ms = Date.now() - startedAt;
      log('info', 'Sync complete', summary);
      return summary;
    }

    /** @type {Map<string, object>} */
    const shipmentByAwb = new Map();

    for (const batch of batches) {
      let shipments;
      try {
        shipments = await bluedartTracking.trackAwbs(batch);
      } catch (batchErr) {
        summary.errors += 1;
        log('error', `Batch track failed (${batch.join(',')}): ${batchErr.message}`);
        shipments = [];
        for (const awb of batch) {
          try {
            const [one] = await bluedartTracking.trackAwbs([awb]);
            shipments.push(one);
          } catch (oneErr) {
            summary.errors += 1;
            log('error', `Single AWB track failed (${awb}): ${oneErr.message}`);
            shipmentByAwb.set(awb, {
              awb_number: awb,
              found: false,
              status: oneErr.message,
              status_type: 'ERR',
            });
          }
        }
      }

      for (const shipment of shipments) {
        const key = String(shipment.awb_number || '').trim();
        if (key) shipmentByAwb.set(key, shipment);
      }
    }

    await applyTrackingResults(groups, shipmentByAwb, summary);

    summary.duration_ms = Date.now() - startedAt;
    log('info', 'Sync complete', summary);
    return summary;
  } catch (err) {
    summary.success = false;
    summary.errors += 1;
    summary.message = err.message;
    log('error', `Sync aborted: ${err.message}`);
    return summary;
  } finally {
    running = false;
  }
}

function isSyncRunning() {
  return running;
}

module.exports = {
  syncUndeliveredAwbs,
  isSyncRunning,
  fetchPendingAwbGroups,
  markDcDeliveredFromTracking,
  splitAwbTokens,
};
