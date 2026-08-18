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

module.exports = {
  normalizeMachineId,
  checkTtsplAndSerial,
  assertTtsplAndSerial,
  resolveItemVerifications,
};
