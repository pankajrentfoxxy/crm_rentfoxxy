/**
 * Require TTSPL ID (always) and Serial number (when machine is ON).
 * Used for Out-for-Repair DC creation and Production Diagnosis gates.
 */

function normalizeMachineId(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * @param {{
 *   expectedTtspl?: string|null,
 *   expectedSerial?: string|null,
 *   verifiedTtspl?: string|null,
 *   verifiedSerial?: string|null,
 *   label?: string,
 *   requireSerial?: boolean,
 * }} opts
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function checkTtsplAndSerial(opts = {}) {
  const label = opts.label || 'This laptop';
  const requireSerial = opts.requireSerial !== false;
  const expectedTtspl = normalizeMachineId(opts.expectedTtspl);
  const expectedSerial = normalizeMachineId(opts.expectedSerial);
  const verifiedTtspl = normalizeMachineId(opts.verifiedTtspl);
  const verifiedSerial = normalizeMachineId(opts.verifiedSerial);

  if (!verifiedTtspl) {
    return { ok: false, message: `${label}: enter TTSPL ID to verify` };
  }
  if (requireSerial && !verifiedSerial) {
    return { ok: false, message: `${label}: enter both TTSPL ID and Serial number to verify` };
  }
  if (!expectedTtspl) {
    return { ok: false, message: `${label}: missing TTSPL ID on record` };
  }
  if (requireSerial && !expectedSerial) {
    return { ok: false, message: `${label}: missing Serial number on record — laptop is ON, serial is required` };
  }
  if (verifiedTtspl !== expectedTtspl) {
    return { ok: false, message: `${label}: TTSPL ID does not match` };
  }
  if (requireSerial && verifiedSerial !== expectedSerial) {
    return { ok: false, message: `${label}: Serial number does not match` };
  }
  if (!requireSerial && verifiedSerial && expectedSerial && verifiedSerial !== expectedSerial) {
    return { ok: false, message: `${label}: Serial number does not match` };
  }
  return { ok: true };
}

function assertTtsplAndSerial(opts = {}) {
  const result = checkTtsplAndSerial(opts);
  if (!result.ok) {
    const err = new Error(result.message);
    err.status = 400;
    throw err;
  }
  return true;
}

/**
 * Resolve per-ticket verification map from request body.
 * Accepts: { [ticketId]: { ttspl, serial } } or arrays aligned with ticket_ids.
 */
function resolveItemVerifications(raw, ticketIds = []) {
  const map = new Map();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, val] of Object.entries(raw)) {
      const tid = Number(key);
      if (!tid || !val || typeof val !== 'object') continue;
      map.set(tid, {
        ttspl: val.ttspl ?? val.verify_ttspl ?? val.ttspl_id ?? '',
        serial: val.serial ?? val.verify_serial ?? val.serial_number ?? '',
      });
    }
  }
  for (const tid of ticketIds.map(Number).filter(Boolean)) {
    if (!map.has(tid)) map.set(tid, { ttspl: '', serial: '' });
  }
  return map;
}

const isRealSerial = (v) => {
  const n = normalizeMachineId(v);
  return Boolean(n) && n !== 'NOT_ON';
};

/**
 * The person acting types the laptop's TTSPL and serial in full, from its
 * label; both must equal the ticket's record exactly — no partial match, no
 * pre-filled values. Serial is required while the laptop is ON (or when
 * `condition` says it is). Used at every floor assignment and at QC1 start
 * and submit.
 *
 * @param {{ ttspl_id?: string, serial_number?: string, received_condition?: string }} ticket
 * @param {object} body  request body: verify_ttspl / ttspl_id / ttspl, verify_serial / serial_number / serial
 * @param {{ label?: string, condition?: string }} [opts]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function checkTicketIdentity(ticket, body = {}, opts = {}) {
  // eslint-disable-next-line global-require
  const { requiresSerialIdentity } = require('../constants/laptopConditions');
  const label = opts.label || 'This laptop';
  const requireSerial = requiresSerialIdentity(opts.condition || ticket?.received_condition);
  const typedTtspl = normalizeMachineId(body.verify_ttspl ?? body.ttspl_id ?? body.ttspl);
  const typedSerial = normalizeMachineId(body.verify_serial ?? body.serial_number ?? body.serial);
  const recordTtspl = normalizeMachineId(ticket?.ttspl_id);
  const recordSerial = isRealSerial(ticket?.serial_number) ? normalizeMachineId(ticket.serial_number) : '';

  if (!typedTtspl) return { ok: false, message: `${label}: type the laptop's full TTSPL ID.` };
  if (requireSerial && !typedSerial) return { ok: false, message: `${label}: type the laptop's full Serial number (it is ON).` };
  if (!recordTtspl) return { ok: false, message: `${label}: this ticket has no TTSPL ID on record — ask the floor manager to fix it before continuing.` };
  if (typedTtspl !== recordTtspl) {
    return { ok: false, message: `${label}: TTSPL ID ${typedTtspl} does not match this laptop. Type the full TTSPL ID from the laptop's label.` };
  }
  if (typedSerial || requireSerial) {
    if (!recordSerial) return { ok: false, message: `${label}: this ticket has no Serial number on record — ask the floor manager to fix it before continuing.` };
    if (typedSerial !== recordSerial) {
      return { ok: false, message: `${label}: Serial number ${typedSerial} does not match this laptop. Type the full Serial number from the laptop.` };
    }
  }
  return { ok: true };
}

module.exports = {
  normalizeMachineId,
  isRealSerial,
  checkTicketIdentity,
  checkTtsplAndSerial,
  assertTtsplAndSerial,
  resolveItemVerifications,
};
