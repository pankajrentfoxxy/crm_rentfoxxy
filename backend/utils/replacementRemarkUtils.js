/** SO/DC line remark for support replacement (no service imports — safe for circular deps). */

function buildReplacementSoLineRemark(cfg) {
  const code = String(cfg?.old_machine_serial || '').trim();
  return code ? `Support replacement against TTSPL: ${code}` : 'Support replacement';
}

/** Use SO line remark, or derive TTSPL-specific text from a linked replacement order. */
function effectiveReplacementLineRemark(soRemark, oldMachineSerial) {
  const r = String(soRemark || '').trim();
  if (r && r !== 'Support replacement') return r;
  if (String(oldMachineSerial || '').trim()) {
    return buildReplacementSoLineRemark({ old_machine_serial: oldMachineSerial });
  }
  return r || 'Support replacement';
}

module.exports = {
  buildReplacementSoLineRemark,
  effectiveReplacementLineRemark,
};
