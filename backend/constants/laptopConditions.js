/**
 * Laptop intake condition shared by PO creation, GRN receive and floor tickets.
 *
 * `on`           — boots; the full serial-capture + config-match flow applies.
 * `not_on`       — dead unit; serial is typed manually, config cannot be read.
 * `part_missing` — boots or not, but arrives with parts absent (see PART_CATEGORIES).
 */

const LAPTOP_CONDITIONS = [
  { value: 'on', label: 'On' },
  { value: 'not_on', label: 'Not On' },
  { value: 'part_missing', label: 'Part Missing' },
];

/** Mirrors the spare-parts catalog categories so missing parts map to real parts. */
const PART_CATEGORIES = [
  { value: 'ram', label: 'RAM' },
  { value: 'storage', label: 'Storage / SSD' },
  { value: 'display', label: 'Display' },
  { value: 'battery', label: 'Battery' },
  { value: 'keyboard', label: 'Keyboard' },
  { value: 'motherboard', label: 'Motherboard / Chip Level' },
  { value: 'cooling', label: 'Cooling / Thermal' },
  { value: 'power', label: 'Power / Charger' },
  { value: 'body', label: 'Body / Casing' },
  { value: 'general', label: 'General / Other' },
];

const CONDITION_VALUES = LAPTOP_CONDITIONS.map((c) => c.value);
const PART_CATEGORY_VALUES = PART_CATEGORIES.map((c) => c.value);

const DEFAULT_CONDITION = 'on';

function toArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === '') return [];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return trimmed.split(',');
  }
  return [];
}

function normalizeList(raw, allowed) {
  const seen = new Set();
  const out = [];
  for (const item of toArray(raw)) {
    const value = String(item ?? '').trim().toLowerCase();
    if (!allowed.includes(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Conditions a PO line accepts. Empty/unknown input falls back to `['on']`. */
function normalizeAllowedConditions(raw) {
  const list = normalizeList(raw, CONDITION_VALUES);
  return list.length ? list : [DEFAULT_CONDITION];
}

/** Single received condition. Anything unrecognised is treated as `on`. */
function normalizeCondition(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  return CONDITION_VALUES.includes(value) ? value : DEFAULT_CONDITION;
}

function normalizeMissingParts(raw) {
  return normalizeList(raw, PART_CATEGORY_VALUES);
}

function conditionLabel(value) {
  return LAPTOP_CONDITIONS.find((c) => c.value === normalizeCondition(value))?.label || 'On';
}

function partCategoryLabel(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return PART_CATEGORIES.find((c) => c.value === key)?.label || key;
}

function partCategoryLabels(values) {
  return normalizeMissingParts(values).map(partCategoryLabel);
}

/** Only powered-on units can run the hardware script, so only they are config-verified. */
function requiresConfigVerification(condition) {
  return normalizeCondition(condition) === 'on';
}

/** Floor identity: Serial is mandatory when laptop is ON (or part_missing); optional when NOT ON. */
function requiresSerialIdentity(condition) {
  return normalizeCondition(condition) !== 'not_on';
}

/**
 * Floor-ticket highlight so the technician immediately sees a non-standard intake.
 * @returns {{ highlighted: boolean, reason: string|null }}
 */
function conditionHighlight(condition, missingParts) {
  const value = normalizeCondition(condition);
  if (value === 'not_on') {
    return { highlighted: true, reason: 'Received NOT ON — laptop does not power on' };
  }
  if (value === 'part_missing') {
    const labels = partCategoryLabels(missingParts);
    return {
      highlighted: true,
      reason: labels.length
        ? `Parts missing at GRN: ${labels.join(', ')}`
        : 'Parts missing at GRN',
    };
  }
  return { highlighted: false, reason: null };
}

module.exports = {
  LAPTOP_CONDITIONS,
  PART_CATEGORIES,
  CONDITION_VALUES,
  PART_CATEGORY_VALUES,
  DEFAULT_CONDITION,
  normalizeAllowedConditions,
  normalizeCondition,
  normalizeMissingParts,
  conditionLabel,
  partCategoryLabel,
  partCategoryLabels,
  requiresConfigVerification,
  requiresSerialIdentity,
  conditionHighlight,
};
