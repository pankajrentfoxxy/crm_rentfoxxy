/**
 * Match what a field technician scanned against the laptops on a challan.
 *
 * Pure, so the rules are unit-tested (test/myDeliveriesPickups.test.js):
 *   - every scan must be a laptop on the challan (a stray code is refused,
 *     never ignored — the old check passed as soon as ONE code matched);
 *   - the same laptop twice (TTSPL then its serial) is refused;
 *   - for a pickup (requireAll) every laptop on the challan must be scanned,
 *     because a pickup that only scanned one of three laptops is how the wrong
 *     laptop comes back.
 *
 * laptops: [{ key, codes: [ttspl, serial, …] }]
 */
function norm(v) {
  return String(v || '').trim().toLowerCase();
}

function matchScans(laptops, scans, { requireAll = false } = {}) {
  const list = (Array.isArray(scans) ? scans : [scans]).map((s) => String(s || '').trim()).filter(Boolean);
  const matched = new Map();
  const unknown = [];
  const duplicates = [];
  for (const raw of list) {
    const s = norm(raw);
    const hit = (laptops || []).find((l) => (l.codes || []).some((c) => c && norm(c) === s));
    if (!hit) { unknown.push(raw); continue; }
    if (matched.has(hit.key)) { duplicates.push(raw); continue; }
    matched.set(hit.key, raw);
  }
  const missing = (laptops || []).filter((l) => !matched.has(l.key)).map((l) => l.key);

  let message = null;
  if (!list.length) message = 'Scan the laptop’s TTSPL or serial';
  else if (unknown.length) message = `${unknown.join(', ')} is not on this challan`;
  else if (duplicates.length) message = `${duplicates.join(', ')} was already scanned (same laptop)`;
  else if (requireAll && missing.length) {
    message = `Scan every laptop you collect — ${matched.size} of ${(laptops || []).length} scanned`;
  }
  return {
    ok: !message,
    message,
    matched: [...matched.entries()].map(([key, scan]) => ({ key, scan })),
    unknown,
    duplicates,
    missing,
  };
}

module.exports = { matchScans, norm };
