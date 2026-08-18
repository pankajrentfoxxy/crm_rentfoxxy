/**
 * Client-side TTSPL + Serial dual identity check (mirrors backend util).
 */

export function normalizeMachineId(value) {
  return String(value || '').trim().toUpperCase();
}

export function checkTtsplAndSerial({
  expectedTtspl,
  expectedSerial,
  verifiedTtspl,
  verifiedSerial,
  label = 'This laptop',
  requireSerial = true,
} = {}) {
  const et = normalizeMachineId(expectedTtspl);
  const es = normalizeMachineId(expectedSerial);
  const vt = normalizeMachineId(verifiedTtspl);
  const vs = normalizeMachineId(verifiedSerial);

  if (!vt) return { ok: false, message: `${label}: enter TTSPL ID to verify` };
  if (requireSerial && !vs) {
    return { ok: false, message: `${label}: enter both TTSPL ID and Serial number to verify` };
  }
  if (!et) return { ok: false, message: `${label}: missing TTSPL ID on record` };
  if (requireSerial && !es) {
    return { ok: false, message: `${label}: missing Serial number on record — laptop is ON, serial is required` };
  }
  if (vt !== et) return { ok: false, message: `${label}: TTSPL ID does not match` };
  if (requireSerial && vs !== es) return { ok: false, message: `${label}: Serial number does not match` };
  if (!requireSerial && vs && es && vs !== es) {
    return { ok: false, message: `${label}: Serial number does not match` };
  }
  return { ok: true };
}
