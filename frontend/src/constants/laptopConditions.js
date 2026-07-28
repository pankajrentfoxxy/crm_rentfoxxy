/**
 * Laptop intake condition — mirrors backend/constants/laptopConditions.js.
 * Used by PO creation (which conditions a line accepts) and GRN receive
 * (which condition each unit actually arrived in).
 */

export const LAPTOP_CONDITIONS = [
  { value: 'on', label: 'On' },
  { value: 'not_on', label: 'Not On' },
  { value: 'part_missing', label: 'Part Missing' },
];

export const PART_CATEGORIES = [
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

export const DEFAULT_CONDITION = 'on';

const CONDITION_VALUES = LAPTOP_CONDITIONS.map((c) => c.value);

export function normalizeAllowedConditions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = list
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter((v, i, arr) => CONDITION_VALUES.includes(v) && arr.indexOf(v) === i);
  return out.length ? out : [DEFAULT_CONDITION];
}

export function conditionLabel(value) {
  return LAPTOP_CONDITIONS.find((c) => c.value === value)?.label || 'On';
}

export function partCategoryLabel(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return PART_CATEGORIES.find((c) => c.value === key)?.label || key;
}

export function partCategoryLabels(values) {
  if (!Array.isArray(values)) return [];
  return values.map(partCategoryLabel).filter(Boolean);
}

/** Only powered-on laptops can run the hardware capture script. */
export function requiresConfigCapture(condition) {
  return (condition || DEFAULT_CONDITION) === 'on';
}

/** Tailwind classes for the condition badge, keyed by severity. */
export function conditionBadgeClass(value) {
  if (value === 'not_on') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (value === 'part_missing') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}
