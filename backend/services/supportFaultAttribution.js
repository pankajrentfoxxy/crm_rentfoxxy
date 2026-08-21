'use strict';

const ATTR = {
  COMPANY_FAULT: { liability: 'COMPANY', chargeable: false, needsApproval: false },
  WEAR_AND_TEAR: { liability: 'COMPANY', chargeable: false, needsApproval: false },
  CUSTOMER_DAMAGE: { liability: 'CUSTOMER_CHARGEABLE', chargeable: true, needsApproval: true },
  CUSTOMER_BREAKAGE: { liability: 'CUSTOMER_CHARGEABLE', chargeable: true, needsApproval: true },
  VENDOR_WARRANTY: { liability: 'VENDOR_WARRANTY', chargeable: false, needsApproval: false },
  UNKNOWN: { liability: 'COMPANY', chargeable: false, needsApproval: true },
};

function resolveAttribution(raw) {
  const key = String(raw || '').toUpperCase();
  return ATTR[key] ? { code: key, ...ATTR[key] } : null;
}

module.exports = { ATTR, resolveAttribution };
