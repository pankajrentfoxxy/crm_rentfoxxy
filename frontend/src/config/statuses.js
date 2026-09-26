/**
 * Canonical asset status vocabulary (Part 1 §6.2, Decision 3).
 *
 * The same list as backend/constants/statuses.js, deliberately duplicated
 * rather than imported across the boundary — there is no shared package. If you
 * change one, change the other; backend/test/statuses.test.js asserts they agree
 * by parsing this file.
 *
 * Twelve values, five families. The families are what the design system colours
 * by: four chromatic (--lc-idle / earning / moving / offcycle) plus a
 * deliberately neutral closed.
 */

/** idle | earning | moving | offcycle | closed */
export const FAMILY = {
  IDLE: 'idle',
  EARNING: 'earning',
  MOVING: 'moving',
  OFFCYCLE: 'offcycle',
  CLOSED: 'closed',
};

export const ASSET_STATUS = {
  IN_STOCK: 'in_stock',
  RESERVED: 'reserved',
  DISPATCH_READY: 'dispatch_ready',
  AT_GATE: 'at_gate',
  IN_TRANSIT: 'in_transit',
  RENTED: 'rented',
  ON_DEMO: 'on_demo',
  SOLD: 'sold',
  RETURNED: 'returned',
  IN_REPAIR: 'in_repair',
  QC_FAILED: 'qc_failed',
  SCRAPPED: 'scrapped',
  RETURNED_TO_VENDOR: 'returned_to_vendor',
};

/**
 * `glyph` is not decoration. The dark-mode family pairs sit in the 6–8 CVD
 * floor band, which is only legal with a secondary encoding — so every chip
 * ships a glyph AND a word, and neither is optional.
 */
export const ASSET_STATUSES = [
  { value: ASSET_STATUS.IN_STOCK,       family: FAMILY.IDLE,     label: 'In stock',       glyph: '▣', means: 'On the shelf, QC-passed, attachable' },
  { value: ASSET_STATUS.RESERVED,       family: FAMILY.MOVING,   label: 'Reserved',       glyph: '◆', means: 'Attached to a sales order' },
  { value: ASSET_STATUS.DISPATCH_READY, family: FAMILY.MOVING,   label: 'Dispatch ready', glyph: '▶', means: 'On a challan, not yet through the gate' },
  { value: ASSET_STATUS.AT_GATE,        family: FAMILY.MOVING,   label: 'At gate',        glyph: '⌷', means: "In the guard's custody, either direction" },
  { value: ASSET_STATUS.IN_TRANSIT,     family: FAMILY.MOVING,   label: 'In transit',     glyph: '➔', means: 'Scanned out, not yet delivered' },
  { value: ASSET_STATUS.RENTED,         family: FAMILY.EARNING,  label: 'Rented',         glyph: '●', means: 'With a customer, rent accruing' },
  { value: ASSET_STATUS.ON_DEMO,        family: FAMILY.EARNING,  label: 'On demo',        glyph: '◐', means: 'With a customer on demo' },
  { value: ASSET_STATUS.SOLD,           family: FAMILY.CLOSED,   label: 'Sold',           glyph: '✓', means: 'Title transferred' },
  { value: ASSET_STATUS.RETURNED,       family: FAMILY.OFFCYCLE, label: 'Returned',       glyph: '↩', means: 'Back in the building, awaiting QC' },
  { value: ASSET_STATUS.IN_REPAIR,      family: FAMILY.OFFCYCLE, label: 'In repair',      glyph: '✶', means: 'Out for repair or on the bench' },
  { value: ASSET_STATUS.QC_FAILED,      family: FAMILY.OFFCYCLE, label: 'QC failed',      glyph: '✕', means: 'Failed QC, needs a decision' },
  { value: ASSET_STATUS.SCRAPPED,       family: FAMILY.CLOSED,   label: 'Scrapped',       glyph: '⊘', means: 'Terminal' },
  { value: ASSET_STATUS.RETURNED_TO_VENDOR, family: FAMILY.CLOSED, label: 'Returned to vendor', glyph: '⇤', means: 'Back with the vendor it came from' },
];

export const ASSET_STATUS_VALUES = ASSET_STATUSES.map((s) => s.value);

export const STATUS_META = ASSET_STATUSES.reduce((acc, s) => {
  acc[s.value] = s;
  return acc;
}, {});

export const isCanonicalAssetStatus = (status) =>
  Object.prototype.hasOwnProperty.call(STATUS_META, String(status || '').toLowerCase());

/**
 * The one display map (Part 1 §6.4), used by StatusChip, every chart series and
 * every row stripe. Unknown status returns `closed` and warns in development.
 * It never throws — the columns still hold strays until Part 2.3 migrates them,
 * and a stray must render visibly rather than crash or disappear.
 */
export function statusFamily(status) {
  const key = String(status || '').toLowerCase();
  const meta = STATUS_META[key];
  if (meta) return meta.family;
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`[statuses] non-canonical asset status "${status}" — falling back to "${FAMILY.CLOSED}".`);
  }
  return FAMILY.CLOSED;
}

/** Label for a status, falling back to the raw string so a stray stays visible. */
export function statusLabel(status) {
  const key = String(status || '').toLowerCase();
  return STATUS_META[key]?.label || String(status || '—');
}

export function statusGlyph(status) {
  const key = String(status || '').toLowerCase();
  return STATUS_META[key]?.glyph || '?';
}
