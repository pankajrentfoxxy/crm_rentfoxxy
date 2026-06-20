const pool = require('../config/db');

/**
 * GRN hardware configuration verification.
 * Compares the actual laptop config (read on the received machine) against the
 * expected config stored on the GRN/PO line item, with tolerant normalization.
 */

// ── Normalization helpers ─────────────────────────────────────────
function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const BRAND_NOISE = new Set([
  'inc', 'corporation', 'corp', 'co', 'ltd', 'limited', 'technologies',
  'technology', 'computer', 'computers', 'international', 'group', 'gmbh',
]);

function normBrand(s) {
  return norm(s)
    .split(' ')
    .filter((t) => t && !BRAND_NOISE.has(t))
    .join(' ');
}

function normModel(s) {
  return norm(s).replace(/\s+/g, '');
}

/** Extract a comparable processor type: i3/i5/i7/i9 or ryzen3/5/7/9 or apple m1/m2/m3. */
function cpuType(s) {
  const t = norm(s);
  let m = t.match(/\bi\s?([3579])\b/) || t.match(/core\s?i\s?([3579])/) || t.match(/i([3579])\s?\d{3,5}/);
  if (m) return `i${m[1]}`;
  m = t.match(/ryzen\s?([3579])/);
  if (m) return `ryzen${m[1]}`;
  m = t.match(/\bm([1234])\b/) || t.match(/apple\s?m([1234])/);
  if (m) return `m${m[1]}`;
  if (/celeron/.test(t)) return 'celeron';
  if (/pentium/.test(t)) return 'pentium';
  if (/xeon/.test(t)) return 'xeon';
  return t; // fall back to full normalized string
}

/** Leading generation number, e.g. "12th Gen" → 12, "13" → 13. */
function genNum(s) {
  const m = String(s == null ? '' : s).match(/(\d{1,2})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Derive the Intel Core generation from the ACTUAL machine config. The receiver's
 * script can't reliably compute this (a 4-digit model like i7-1165G7 is 11th gen,
 * but i5-8250U is 8th — length alone is ambiguous), so we derive it here from the
 * full CPU name, which is the single source of truth.
 *   1) Prefer the explicit "Xth Gen" text Windows puts in the CPU name.
 *   2) Else the model number after i3/i5/i7/i9:
 *        5 digits          -> first two   (10210U -> 10, 12700H -> 12)
 *        4 digits, "1..."  -> first two   (1165G7 -> 11, 1260P -> 12, 1360P -> 13)
 *        4 digits, else    -> first one   (8550U -> 8, 9750H -> 9, 7200U -> 7)
 *        3 digits          -> first one
 *   3) Else any script-provided generation value.
 * Returns null when it can't be determined (e.g. Ryzen / Apple) so it won't block.
 */
function genFromActual(actual = {}) {
  const cpu = String(actual.processor || '');
  let m = cpu.match(/(\d{1,2})\s*(?:st|nd|rd|th)\s*gen/i);
  if (m) return parseInt(m[1], 10);
  m = cpu.match(/i[3579][-\s]?(\d{3,5})/i);
  if (m) {
    const n = m[1];
    if (n.length >= 5) return parseInt(n.slice(0, 2), 10);
    if (n.length === 4) return n[0] === '1' ? parseInt(n.slice(0, 2), 10) : parseInt(n[0], 10);
    return parseInt(n[0], 10);
  }
  return genNum(actual.generation);
}

/** First integer found, e.g. "256 GB SSD" → 256, "32GB" → 32. */
function sizeNum(s) {
  if (typeof s === 'number') return Math.round(s);
  const m = String(s == null ? '' : s).match(/(\d+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1])) : null;
}

// ── Expected config loader ────────────────────────────────────────
function parseLineItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

async function loadExpectedConfig(poId, lineIndex, db = pool) {
  const r = await db.query(
    `SELECT line_items FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`,
    [poId]
  );
  const lines = parseLineItems(r.rows[0]?.line_items);
  const line = lines[lineIndex] || {};
  return {
    brand: line.brand ?? line.brand_name ?? '',
    model: line.model ?? '',
    processor: line.processor ?? '',
    generation: line.generation ?? '',
    ram: line.ram ?? '',
    ssd: line.ssd ?? line.storage ?? '',
    gpu: line.gpu ?? '',
  };
}

// ── Comparison ────────────────────────────────────────────────────
const FIELD_LABELS = {
  brand: 'Brand',
  model: 'Model',
  processor: 'Processor',
  generation: 'Generation',
  ram: 'RAM',
  ssd: 'SSD',
  gpu: 'GPU',
};

function bothContain(a, b) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Returns { configurationMatched, checks: [{field,label,matched,required,expected,actual}], errors }.
 * Blocking fields: brand, model, processor, generation, ram (exact), ssd (±10%).
 * GPU is informational only.
 */
function compareConfig(expected, actual) {
  const checks = [];

  // Brand — required, contains-match after stripping corp noise.
  {
    const e = normBrand(expected.brand);
    const a = normBrand(actual.manufacturer ?? actual.brand);
    const matched = !e || bothContain(a, e);
    checks.push({ field: 'brand', label: FIELD_LABELS.brand, required: true, matched, expected: expected.brand, actual: actual.manufacturer ?? actual.brand ?? '' });
  }

  // Model — required, normalized contains-match.
  {
    const e = normModel(expected.model);
    const a = normModel(actual.model);
    const matched = !e || (a.length >= 2 && bothContain(a, e));
    checks.push({ field: 'model', label: FIELD_LABELS.model, required: true, matched, expected: expected.model, actual: actual.model ?? '' });
  }

  // Processor type — required.
  {
    const e = cpuType(expected.processor);
    const a = cpuType(actual.processor);
    const matched = !expected.processor || e === a;
    checks.push({ field: 'processor', label: FIELD_LABELS.processor, required: true, matched, expected: expected.processor, actual: actual.processor ?? '' });
  }

  // Generation — derived authoritatively from the actual CPU name (handles the
  // 11th-gen "1165G7" case). Required only when both sides resolve to a number.
  {
    const e = genNum(expected.generation);
    const a = genFromActual(actual);
    const matched = e == null || a == null || e === a;
    checks.push({
      field: 'generation', label: FIELD_LABELS.generation, required: true, matched,
      expected: expected.generation,
      actual: a != null ? `${a}th Gen` : (actual.generation ?? ''),
    });
  }

  // RAM — required, exact GB.
  {
    const e = sizeNum(expected.ram);
    const a = sizeNum(actual.ram);
    const matched = e == null || a === e;
    checks.push({ field: 'ram', label: FIELD_LABELS.ram, required: true, matched, expected: expected.ram, actual: actual.ram ?? '' });
  }

  // SSD — required, ±10% tolerance.
  {
    const e = sizeNum(expected.ssd);
    const a = sizeNum(actual.ssd);
    const matched = e == null || (a != null && Math.abs(a - e) <= e * 0.1);
    checks.push({ field: 'ssd', label: FIELD_LABELS.ssd, required: true, matched, expected: expected.ssd, actual: actual.ssd ?? '' });
  }

  // GPU — informational only (never blocks).
  {
    const e = norm(expected.gpu);
    const a = norm(actual.gpu);
    const matched = !e || bothContain(a, e);
    checks.push({ field: 'gpu', label: FIELD_LABELS.gpu, required: false, matched, expected: expected.gpu, actual: actual.gpu ?? '' });
  }

  const errors = checks
    .filter((c) => c.required && !c.matched)
    .map((c) => ({ field: c.field, expected: c.expected, actual: c.actual }));

  return { configurationMatched: errors.length === 0, checks, errors };
}

// ── Public entrypoint: verify + persist + audit ───────────────────
async function verifyConfiguration({ tokenRow, actual, ip }) {
  const expected = await loadExpectedConfig(tokenRow.po_id, tokenRow.line_index);
  const result = compareConfig(expected, actual);

  const matchedFields = result.checks.filter((c) => c.matched).map((c) => c.field);
  const mismatchedFields = result.checks.filter((c) => !c.matched).map((c) => ({
    field: c.field, expected: c.expected, actual: c.actual, required: c.required,
  }));

  await pool.query(
    `INSERT INTO grn_config_verifications
       (token_id, po_id, line_index, expected_config, actual_config,
        matched_fields, mismatched_fields, configuration_matched, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      tokenRow.token_id,
      tokenRow.po_id,
      tokenRow.line_index,
      JSON.stringify(expected),
      JSON.stringify(actual),
      matchedFields,
      JSON.stringify(mismatchedFields),
      result.configurationMatched,
      ip ? String(ip).slice(0, 64) : null,
    ]
  );

  await pool.query(
    `UPDATE grn_serial_capture_tokens
        SET config_verified = $2,
            config_verified_at = CASE WHEN $2 THEN NOW() ELSE config_verified_at END,
            actual_config = $3,
            config_check = $4
      WHERE token_id = $1`,
    [
      tokenRow.token_id,
      result.configurationMatched,
      JSON.stringify(actual),
      JSON.stringify({ configuration_matched: result.configurationMatched, checks: result.checks }),
    ]
  );

  return { ...result, expected };
}

module.exports = {
  loadExpectedConfig,
  compareConfig,
  verifyConfiguration,
  // exported for tests / reuse
  norm,
  cpuType,
  genNum,
  genFromActual,
  sizeNum,
};
