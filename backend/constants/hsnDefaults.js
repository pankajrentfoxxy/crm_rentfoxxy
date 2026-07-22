/**
 * Default HSN/SAC by transaction type — single source of truth for SO / DC / RDC / VRDC.
 *
 * 997315 — SAC: rental/leasing of computers (service)
 * 847130 — HSN: laptops (goods / sale)
 * 847330 — HSN: parts / damage / repair
 */

const HSN_DEFAULTS = Object.freeze({
  rental: '997315',
  sale: '847130',
  repair: '847330',
});

const HSN_OVERRIDE_ROLES = Object.freeze(['admin', 'super_admin']);

/** @param {'rental'|'sale'|'repair'|string} transactionType */
function resolveDefaultHsn(transactionType) {
  return HSN_DEFAULTS[transactionType] || HSN_DEFAULTS.sale;
}

/** Map quotation_type → transaction type. rental + demo → rental; sales/sale → sale. */
function txnTypeFromQuotation(quotationType) {
  const qt = String(quotationType || '').toLowerCase();
  return qt === 'sales' || qt === 'sale' ? 'sale' : 'rental';
}

function canOverrideHsn(role) {
  return HSN_OVERRIDE_ROLES.includes(String(role || '').toLowerCase());
}

/** Validate / normalize an HSN/SAC override. Returns null if blank. Throws if invalid. */
function normalizeHsnCode(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (!/^\d{4,8}$/.test(s)) {
    throw new Error('HSN/SAC code must be 4–8 digits');
  }
  return s;
}

/**
 * HSN to persist on create/update. Never blank.
 * Non-admin overrides are ignored (default applied).
 */
function resolveHsnForPersist({
  transactionType,
  quotationType,
  override,
  role,
} = {}) {
  const txn = transactionType
    || (quotationType != null ? txnTypeFromQuotation(quotationType) : 'sale');
  const fallback = resolveDefaultHsn(txn);
  const normalized = normalizeHsnCode(override);
  if (!normalized) return fallback;
  if (!canOverrideHsn(role)) return fallback;
  return normalized;
}

/**
 * Display / PDF HSN — stored value, or render-time default from transaction type.
 */
function resolveHsnForDisplay(stored, { transactionType, quotationType } = {}) {
  const s = String(stored == null ? '' : stored).trim();
  if (s) return s;
  const txn = transactionType
    || (quotationType != null ? txnTypeFromQuotation(quotationType) : 'sale');
  return resolveDefaultHsn(txn);
}

/**
 * Infer transaction type from entity_code when quotation_type is missing.
 * gorefurbo → sale; otherwise rental.
 */
function txnTypeFromEntity(entityCode) {
  return String(entityCode || '').toLowerCase() === 'gorefurbo' ? 'sale' : 'rental';
}

module.exports = {
  HSN_DEFAULTS,
  HSN_OVERRIDE_ROLES,
  resolveDefaultHsn,
  txnTypeFromQuotation,
  txnTypeFromEntity,
  canOverrideHsn,
  normalizeHsnCode,
  resolveHsnForPersist,
  resolveHsnForDisplay,
};
