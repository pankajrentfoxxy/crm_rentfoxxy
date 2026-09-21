/**
 * The asset timeline (Part 2.7, reading the spine built in 2.1).
 *
 * This is the component the audit says the ERP most needs and could not render
 * for any entity: a laptop's life crosses PO, GRN, production, QC, sales order,
 * DC, gate, delivery, support, return and billing, and until Part 2.1 that
 * history lived in two partial logs that disagreed with each other (I15).
 *
 * It reads `events` and nothing else. The rule Decision 5 sets is that state
 * lives in columns and history lives in events — so this endpoint answers "what
 * happened to this laptop", never "where is it now".
 */
const pool = require('../../config/db');
const { ENTITY, timelineFor, correlatedSet } = require('../../services/eventService');

/** Accepts a TTSPL code or a numeric serial_id. */
async function resolveAsset(code) {
  const raw = String(code || '').trim();
  if (!raw) return null;

  const { rows } = await pool.query(
    `SELECT serial_id,
            COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl_id,
            serial_number, inventory_status, qc_status,
            current_customer_id, current_dc_number, current_entity,
            rent_monthly_rate, rent_start_date, rent_billed_until,
            extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (COALESCE(inventory_asset_code, extra->>'ttspl_id') = $1
             OR serial_number = $1
             OR ($2::int IS NOT NULL AND serial_id = $2::int))
      LIMIT 1`,
    [raw, /^\d+$/.test(raw) ? Number(raw) : null]
  );
  return rows[0] || null;
}

exports.getAssetTimeline = async (req, res) => {
  try {
    const asset = await resolveAsset(req.params.ttspl);
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }

    // Events were written against the TTSPL where one existed and the serial id
    // where it did not, so both keys are asked for. Backfilled rows from
    // migration 257 use whichever the source log carried.
    const byTtspl = asset.ttspl_id
      ? await timelineFor(ENTITY.ASSET, asset.ttspl_id, { limit: 500 })
      : [];
    const bySerial = await timelineFor(ENTITY.ASSET, String(asset.serial_id), { limit: 500 });

    const seen = new Set();
    const events = [...byTtspl, ...bySerial]
      .filter((e) => (seen.has(e.event_id) ? false : seen.add(e.event_id)))
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));

    res.json({ success: true, asset, events, count: events.length });
  } catch (err) {
    console.error('getAssetTimeline:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Every event one business action wrote.
 *
 * This is the endpoint that makes finding V1 provable rather than merely
 * described: one delivery currently writes from up to five paths, and asking
 * for its correlated set shows exactly how many. After Part 3 collapses them,
 * the same call is the regression test.
 */
exports.getCorrelatedSet = async (req, res) => {
  try {
    const events = await correlatedSet(req.params.correlationId);
    const paths = [...new Set(events.map((e) => e.source))];
    res.json({
      success: true,
      correlation_id: req.params.correlationId,
      count: events.length,
      distinct_sources: paths.length,
      sources: paths,
      events,
    });
  } catch (err) {
    console.error('getCorrelatedSet:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
