/**
 * Part 5.1 — the GRN configuration gate.
 *
 * Findings P3/P4/P5. `capture_token` was `.optional()` on unit receive and did
 * not exist at all on bulk receive, so up to 250 laptops could be booked in with
 * nothing checked; and `grn_config_verifications`, written on every capture
 * since migration 092, had zero readers.
 *
 * One place decides whether a unit may be received, and one place reads the
 * verification back out. No second comparator: the matching itself stays in
 * grnConfigService.compareConfig, which the public capture endpoint already
 * calls — this file only decides whether a capture happened and whether it
 * belongs to the unit in front of it.
 *
 * The hardware sets the boundary of what "mandatory" can mean. A `not_on`
 * laptop cannot run the capture script — constants/laptopConditions.js has said
 * so since intake conditions were introduced. So the gate is:
 *
 *   on           → a matched capture token is required
 *   part_missing → a matched token, unless the caller waives it with a reason
 *   not_on       → no token is possible; a reason is required instead
 *
 * Every waiver is stored on the serial and written to the event spine, so the
 * skip is attributable. That is the part that did not exist before: receiving
 * without verification used to leave no trace at all.
 */
const pool = require('../config/db');
const { recordAssetEvent } = require('./eventService');

class CaptureGateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CaptureGateError';
    this.status = status;
  }
}

/** Conditions for which the capture script can physically run. */
// D5 (26 Sep 2026): every laptop that powers on is checked. "Part missing"
// used to allow a waiver, so a laptop whose configuration did NOT match could
// be booked in by picking that condition and typing five characters. A
// missing part does not stop the check (45 of 46 such laptops in 90 days ran
// it); only a laptop that will not power on genuinely cannot.
const CONDITIONS_REQUIRING_TOKEN = new Set(['on', 'part_missing']);
const CONDITIONS_ALLOWING_WAIVER = new Set(['not_on']);

function normalizeSerial(s) {
  return String(s || '').trim().toUpperCase();
}

/**
 * Resolve one capture token and prove it belongs to this unit.
 *
 * "Matched" means all four: the token is for this PO, for this line, it carries
 * a configuration that was verified against that line, and the serial it
 * captured is the serial being received. Three of those were never checked —
 * the old code took any UUID and used it only to look up a config to copy.
 */
async function resolveMatchedToken(db, { token, poId, lineIndex, serialNumber }) {
  const client = db || pool;
  const tokenId = String(token || '').trim();
  if (!tokenId) {
    throw new CaptureGateError('A configuration capture link is required to receive this unit');
  }

  const { rows } = await client.query(
    `SELECT token_id, po_id, line_index, serial_number, status,
            config_verified, config_check, actual_config
       FROM grn_serial_capture_tokens
      WHERE token_id = $1`,
    [tokenId]
  );
  const row = rows[0];
  if (!row) throw new CaptureGateError('Capture link not found', 404);

  if (Number(row.po_id) !== Number(poId)) {
    throw new CaptureGateError('This capture link belongs to a different purchase order', 409);
  }
  if (Number(row.line_index) !== Number(lineIndex)) {
    throw new CaptureGateError('This capture link belongs to a different line on this purchase order', 409);
  }
  if (!['captured', 'used'].includes(String(row.status))) {
    throw new CaptureGateError(
      row.status === 'expired'
        ? 'This capture link expired — generate a new one and re-run the capture on the laptop'
        : 'No configuration has been captured on this link yet',
      409
    );
  }
  if (!row.config_verified) {
    throw new CaptureGateError('The captured configuration did not match this purchase order line', 409);
  }
  const captured = normalizeSerial(row.serial_number);
  const offered = normalizeSerial(serialNumber);
  if (!captured || captured !== offered) {
    throw new CaptureGateError(
      `This capture link captured serial ${row.serial_number || '(none)'}, not ${serialNumber}`,
      409
    );
  }
  return row;
}

/**
 * Decide the gate for one unit about to be received.
 *
 * Returns { tokenId, waived, waiverReason } for the caller to persist. Throws
 * CaptureGateError with a usable message when the unit may not be received.
 */
async function assertUnitMayBeReceived(db, {
  poId, lineIndex, serialNumber, receivedCondition, captureToken, waiverReason,
}) {
  const condition = String(receivedCondition || 'on').toLowerCase();
  const token = String(captureToken || '').trim();
  const reason = String(waiverReason || '').trim();

  if (token) {
    await resolveMatchedToken(db, { token, poId, lineIndex, serialNumber });
    return { tokenId: token, waived: false, waiverReason: null };
  }

  if (CONDITIONS_REQUIRING_TOKEN.has(condition)) {
    throw new CaptureGateError(
      `Serial ${serialNumber}: a laptop that powers on must be verified through a capture link before it can be booked in. Only a laptop that will not power on can be received without it.`
    );
  }

  if (!CONDITIONS_ALLOWING_WAIVER.has(condition)) {
    throw new CaptureGateError(`Serial ${serialNumber}: unknown received condition "${condition}"`);
  }

  if (reason.length < 5) {
    throw new CaptureGateError(
      `Serial ${serialNumber}: a laptop received without a configuration capture needs a reason (at least 5 characters)`
    );
  }

  return { tokenId: null, waived: true, waiverReason: reason.slice(0, 2000) };
}

/** Persist the gate outcome on the serial row the caller just inserted. */
async function stampGateOutcome(db, { serialId, tokenId, waived, waiverReason }) {
  await (db || pool).query(
    `UPDATE vendor_serial_numbers
        SET capture_token_id = $2,
            config_capture_waived = $3,
            config_capture_waiver_reason = $4
      WHERE serial_id = $1`,
    [serialId, tokenId || null, !!waived, waiverReason || null]
  );
}

/** A waiver is a decision somebody made. It belongs in the timeline. */
async function recordWaiverEvent(db, { serialId, ttsplId, poId, lineIndex, serialNumber, receivedCondition, waiverReason, actor, correlationId }) {
  await recordAssetEvent(db, {
    serialId,
    ttsplId,
    eventType: 'grn_config_capture_waived',
    payload: {
      po_id: poId,
      line_index: lineIndex,
      serial_number: serialNumber,
      received_condition: receivedCondition,
      reason: waiverReason,
    },
    correlationId: correlationId || null,
    source: 'grnCaptureGateService.assertUnitMayBeReceived',
    actor,
  });
}

/**
 * Read the stored verification back for a set of received serials.
 *
 * This is the SELECT that finding P5 says does not exist. Each serial resolves
 * to its token's latest verification row; a waived unit resolves to the waiver
 * instead, so the GRN screen can say "not verified, and here is who decided
 * that and why" rather than showing a blank.
 */
async function loadVerificationsForSerials(db, serialIds) {
  const ids = (Array.isArray(serialIds) ? serialIds : []).map(Number).filter(Number.isFinite);
  if (!ids.length) return new Map();

  const { rows } = await (db || pool).query(
    `SELECT v.serial_id,
            v.capture_token_id,
            v.config_capture_waived,
            v.config_capture_waiver_reason,
            t.status              AS token_status,
            t.captured_at,
            t.config_verified,
            t.config_check,
            c.id                  AS verification_id,
            c.expected_config,
            c.actual_config,
            c.matched_fields,
            c.mismatched_fields,
            c.configuration_matched,
            c.created_at          AS verified_at
       FROM vendor_serial_numbers v
       LEFT JOIN grn_serial_capture_tokens t ON t.token_id = v.capture_token_id
       LEFT JOIN LATERAL (
              SELECT * FROM grn_config_verifications g
               WHERE g.token_id = v.capture_token_id
               ORDER BY g.created_at DESC, g.id DESC
               LIMIT 1
            ) c ON TRUE
      WHERE v.serial_id = ANY($1::int[])`,
    [ids]
  );

  const out = new Map();
  for (const r of rows) {
    if (r.config_capture_waived) {
      out.set(r.serial_id, {
        state: 'waived',
        reason: r.config_capture_waiver_reason || null,
        verified_at: null,
        configuration_matched: null,
        matched_fields: [],
        mismatched_fields: [],
        expected_config: null,
        actual_config: null,
      });
      continue;
    }
    if (!r.verification_id) {
      out.set(r.serial_id, {
        state: r.capture_token_id ? 'captured_without_verification' : 'none',
        reason: null,
        verified_at: null,
        configuration_matched: null,
        matched_fields: [],
        mismatched_fields: [],
        expected_config: null,
        actual_config: null,
      });
      continue;
    }
    out.set(r.serial_id, {
      state: r.configuration_matched ? 'matched' : 'mismatched',
      reason: null,
      verified_at: r.verified_at,
      configuration_matched: r.configuration_matched,
      matched_fields: r.matched_fields || [],
      mismatched_fields: r.mismatched_fields || [],
      expected_config: r.expected_config || null,
      actual_config: r.actual_config || null,
      checks: r.config_check?.checks || null,
    });
  }
  return out;
}

module.exports = {
  CaptureGateError,
  CONDITIONS_REQUIRING_TOKEN,
  CONDITIONS_ALLOWING_WAIVER,
  resolveMatchedToken,
  assertUnitMayBeReceived,
  stampGateOutcome,
  recordWaiverEvent,
  loadVerificationsForSerials,
};
