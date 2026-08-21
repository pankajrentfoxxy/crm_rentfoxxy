export const EMPTY_TICKET_DRAFT = {
  step: 0,
  ticket_class: 'INCIDENT',
  channel: 'PHONE',
  customer_id: null,
  customer: null,
  site_id: null,
  site_key: '',
  site_pincode: '',
  site_label: '',
  site_source: null,
  site_dc_number: '',
  site_override_reason: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  contact_is_vip: false,
  contact_source: null,
  subject: '',
  selectedSerials: [],
  unknownAsset: false,
  lines: [],
  sameIssue: false,
  assignment_group_id: null,
  assigned_to: null,
  preferred_slot_start: '',
  preferred_slot_end: '',
  internal_note: '',
  link: null,
  contextSites: [],
  photos_deferred: false,
};

const DOWNSTREAM = {
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  contact_is_vip: false,
  contact_source: null,
  site_id: null,
  site_key: '',
  site_pincode: '',
  site_label: '',
  site_source: null,
  site_dc_number: '',
  site_override_reason: '',
  selectedSerials: [],
  unknownAsset: false,
  lines: [],
  sameIssue: false,
  link: null,
  assignment_group_id: null,
  assigned_to: null,
  internal_note: '',
  photos_deferred: false,
};

export function customerHasDraftWork(state) {
  return (state.lines || []).length > 0
    || (state.selectedSerials || []).length > 0
    || Boolean(state.contact_source === 'MANUAL' && state.contact_phone);
}

export function applyCustomer(state, customer) {
  if (!customer) return { ...state, customer_id: null, customer: null, ...DOWNSTREAM };
  if (Number(state.customer_id) === Number(customer.customer_id)) {
    return { ...state, customer };
  }
  return {
    ...state,
    ...DOWNSTREAM,
    step: 0,
    customer_id: customer.customer_id,
    customer,
    contact_name: customer.name || customer.company_name || '',
    contact_phone: customer.phone || '',
    contact_email: customer.email || '',
    contact_source: 'CUSTOMER',
  };
}

export function applySiteFromAsset(state, asset, extras = {}) {
  return {
    ...state,
    site_key: asset.site_key || extras.site_key || '',
    site_pincode: asset.delivery_pincode || asset.pincode || extras.site_pincode || '',
    site_label: extras.site_label || [asset.delivery_address, asset.delivery_pincode || asset.pincode].filter(Boolean).join(' — '),
    site_dc_number: asset.dc_number || extras.site_dc_number || '',
    site_id: extras.site_id || state.site_id,
    site_source: extras.site_source || (asset.dc_number ? 'DERIVED_FROM_ASSET' : 'CRM_ADDRESS'),
    site_override_reason: extras.site_override_reason || '',
  };
}

export function sameSite(asset, siteKey, pincode) {
  if (siteKey && asset.site_key && asset.site_key === siteKey) return true;
  const a = String(asset.delivery_pincode || asset.pincode || '').replace(/\D/g, '').slice(0, 6);
  const b = String(pincode || '').replace(/\D/g, '').slice(0, 6);
  return Boolean(a && b && a === b);
}
