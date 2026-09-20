/**
 * Canonical asset status vocabulary (Part 1 §6.2, Decision 3).
 *
 * This file and frontend/src/config/statuses.js are the same list, deliberately
 * duplicated rather than imported across the backend/frontend boundary — there
 * is no shared package. If you change one, change the other;
 * frontend/scripts/check-statuses.js asserts they agree. That check lives on
 * the frontend side because Part 1 may not add a backend file beyond this one.
 *
 * Part 1 writes NO migration and NO CHECK constraint. This is the target
 * vocabulary that Part 2.3 migrates the columns to, phase by phase. Until then
 * the database still holds strays, which is why statusFamily() must never throw.
 *
 * Twelve values. The four chromatic lifecycle families plus closed are what the
 * design system colours by — you cannot build a state palette for twenty values,
 * five of which nothing writes.
 */

/** idle | earning | moving | offcycle | closed */
const FAMILY = {
  IDLE: 'idle',
  EARNING: 'earning',
  MOVING: 'moving',
  OFFCYCLE: 'offcycle',
  CLOSED: 'closed',
};

const ASSET_STATUS = {
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
};

/**
 * The canonical list, in lifecycle order rather than alphabetical — the order a
 * laptop actually moves through, which is also the order lists and filters
 * should present.
 */
const ASSET_STATUSES = [
  { value: ASSET_STATUS.IN_STOCK,       family: FAMILY.IDLE,     label: 'In stock',       means: 'On the shelf, QC-passed, attachable' },
  { value: ASSET_STATUS.RESERVED,       family: FAMILY.MOVING,   label: 'Reserved',       means: 'Attached to a sales order' },
  { value: ASSET_STATUS.DISPATCH_READY, family: FAMILY.MOVING,   label: 'Dispatch ready', means: 'On a challan, not yet through the gate' },
  { value: ASSET_STATUS.AT_GATE,        family: FAMILY.MOVING,   label: 'At gate',        means: "In the guard's custody, either direction" },
  { value: ASSET_STATUS.IN_TRANSIT,     family: FAMILY.MOVING,   label: 'In transit',     means: 'Scanned out, not yet delivered' },
  { value: ASSET_STATUS.RENTED,         family: FAMILY.EARNING,  label: 'Rented',         means: 'With a customer, rent accruing' },
  { value: ASSET_STATUS.ON_DEMO,        family: FAMILY.EARNING,  label: 'On demo',        means: 'With a customer on demo' },
  { value: ASSET_STATUS.SOLD,           family: FAMILY.CLOSED,   label: 'Sold',           means: 'Title transferred' },
  { value: ASSET_STATUS.RETURNED,       family: FAMILY.OFFCYCLE, label: 'Returned',       means: 'Back in the building, awaiting QC' },
  { value: ASSET_STATUS.IN_REPAIR,      family: FAMILY.OFFCYCLE, label: 'In repair',      means: 'Out for repair or on the bench' },
  { value: ASSET_STATUS.QC_FAILED,      family: FAMILY.OFFCYCLE, label: 'QC failed',      means: 'Failed QC, needs a decision' },
  { value: ASSET_STATUS.SCRAPPED,       family: FAMILY.CLOSED,   label: 'Scrapped',       means: 'Terminal' },
];

const ASSET_STATUS_VALUES = ASSET_STATUSES.map((s) => s.value);

const FAMILY_BY_STATUS = ASSET_STATUSES.reduce((acc, s) => {
  acc[s.value] = s.family;
  return acc;
}, {});

const STATUS_META = ASSET_STATUSES.reduce((acc, s) => {
  acc[s.value] = s;
  return acc;
}, {});

const isCanonicalAssetStatus = (status) =>
  Object.prototype.hasOwnProperty.call(FAMILY_BY_STATUS, String(status || '').toLowerCase());

/**
 * The single display map (Part 1 §6.4). Returns `closed` for anything it does
 * not recognise and warns outside production — silence is how twenty statuses
 * accumulated in the first place. It never throws: the database still holds
 * strays until Part 2.3 runs, and a render must not crash on one.
 */
function statusFamily(status) {
  const key = String(status || '').toLowerCase();
  const family = FAMILY_BY_STATUS[key];
  if (family) return family;
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[statuses] non-canonical asset status "${status}" — falling back to "${FAMILY.CLOSED}".`);
  }
  return FAMILY.CLOSED;
}

module.exports = {
  FAMILY,
  ASSET_STATUS,
  ASSET_STATUSES,
  ASSET_STATUS_VALUES,
  FAMILY_BY_STATUS,
  STATUS_META,
  isCanonicalAssetStatus,
  statusFamily,
};
