/**
 * Production — a laptop's configuration, one answer.
 *
 * Reads (never writes) the places configuration is kept, in this order:
 *   1. vendor_serial_numbers.extra   the working record every sales document,
 *                                    DC and invoice already reads
 *   2. production_assets             the floor's working copy
 *   3. grn_received_config           what arrived from the vendor
 *   4. inventory                     legacy
 * and says, field by field, where each value came from and whether the latest
 * confirmation (QC2 script match or part fit, laptop_config_confirmations)
 * agrees. `recordConfirmation` adds a confirmation row; it never edits a table
 * that billing reads.
 */
const pool = require('../config/db');

const FIELDS = ['brand', 'model', 'processor', 'generation', 'ram', 'storage', 'gpu', 'screen_size'];
const clean = (v) => (v == null ? '' : String(v).trim());
// Compare "16 GB" / "16GB DDR4" / "16" as the same size; text fields ignore case/spaces.
const norm = (field, v) => {
  const s = clean(v).toLowerCase();
  if (['ram', 'storage'].includes(field)) {
    const m = s.match(/(\d+(?:\.\d+)?)\s*(tb|gb)?/);
    if (!m) return s;
    return String(Number(m[1]) * (m[2] === 'tb' ? 1024 : 1));
  }
  if (['generation', 'screen_size'].includes(field)) {
    const m = s.match(/\d+(?:\.\d+)?/);
    if (m) return String(Number(m[0]));
  }
  // "Dell Dell Latitude 5420" and "Dell Latitude 5420" are the same model.
  return s.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\b(\w+) \1\b/g, '$1');
};

async function getCurrentConfig(db, { serialId }) {
  const c = db || pool;
  const vsn = (await c.query(
    `SELECT serial_id, serial_number, inventory_asset_code AS ttspl_id, extra, grn_received_config
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  )).rows[0];
  if (!vsn) return null;
  const extra = vsn.extra || {};
  const pa = (await c.query(
    `SELECT brand, model, processor, generation, ram, ssd AS storage, gpu, screen_size
       FROM production_assets WHERE vendor_serial_id = $1 ORDER BY production_asset_id DESC LIMIT 1`,
    [serialId]
  )).rows[0] || {};
  const inv = vsn.serial_number ? ((await c.query(
    `SELECT brand, model, processor, generation, ram, storage, gpu, screen_size
       FROM inventory WHERE LOWER(serial_number) = LOWER($1) ORDER BY inventory_id DESC LIMIT 1`,
    [vsn.serial_number]
  )).rows[0] || {}) : {};
  let confirmed = null;
  try {
    confirmed = (await c.query(
      `SELECT source, config, confirmed_at FROM laptop_config_confirmations
        WHERE vendor_serial_id = $1 ORDER BY confirmed_at DESC LIMIT 1`,
      [serialId]
    )).rows[0] || null;
  } catch (_) { /* migration 340 not applied yet */ }

  const grn = vsn.grn_received_config || {};
  const sources = {
    record: { ...extra, storage: extra.storage || extra.ssd },
    floor: pa,
    received: { ...grn, storage: grn.storage || grn.ssd },
    legacy: inv,
  };
  const config = {};
  const sourceByField = {};
  const disagreements = [];
  for (const f of FIELDS) {
    for (const [name, src] of Object.entries(sources)) {
      if (clean(src[f])) { config[f] = clean(src[f]); sourceByField[f] = name; break; }
    }
    if (!config[f]) continue;
    for (const name of ['floor', 'legacy']) {
      const v = clean(sources[name][f]);
      if (v && norm(f, v) !== norm(f, config[f])) disagreements.push({ field: f, where: name, value: v, current: config[f] });
    }
    const cv = clean(confirmed?.config?.[f]);
    if (cv && norm(f, cv) !== norm(f, config[f])) disagreements.push({ field: f, where: 'last_confirmed', value: cv, current: config[f] });
  }
  return {
    serial_id: vsn.serial_id, ttspl_id: vsn.ttspl_id, config, source_by_field: sourceByField,
    confirmed: confirmed ? { source: confirmed.source, at: confirmed.confirmed_at, config: confirmed.config } : null,
    disagreements,
  };
}

/** Insert-only. Best-effort: a missing table never breaks the caller's work. */
async function recordConfirmation(db, { serialId, ttsplId = null, source, config, ticketId = null, tokenId = null, userId = null, notes = null }) {
  if (!serialId || !config) return null;
  const c = db || pool;
  const inTx = c !== pool; // a client inside the caller's transaction
  if (inTx) await c.query('SAVEPOINT lcc');
  try {
    const r = await c.query(
      `INSERT INTO laptop_config_confirmations (vendor_serial_id, ttspl_id, source, config, ticket_id, token_id, confirmed_by, notes)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING confirmation_id`,
      [serialId, ttsplId, source, JSON.stringify(config), ticketId, tokenId, userId, notes]
    );
    if (inTx) await c.query('RELEASE SAVEPOINT lcc');
    return r.rows[0].confirmation_id;
  } catch (e) {
    if (inTx) await c.query('ROLLBACK TO SAVEPOINT lcc').catch(() => {});
    console.warn('recordConfirmation skipped:', e.message);
    return null;
  }
}

module.exports = { getCurrentConfig, recordConfirmation, FIELDS, norm };
