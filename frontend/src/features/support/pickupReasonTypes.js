export const PICKUP_REASON_OPTIONS = [
  { value: 'employee_left', label: 'Employee Left' },
  { value: 'faulty_laptop', label: 'Faulty Laptop' },
  { value: 'service_issue', label: 'Service Issue' },
  { value: 'not_in_use', label: 'Not in Use' },
  { value: 'other', label: 'Other Reason' },
];

export const GENERIC_PICKUP_DESCRIPTION = 'Public pickup request';

export function parseRequestExtra(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function pickupReasonLabel(extra) {
  const ex = parseRequestExtra(extra);
  if (!ex.pickup_reason_type) return null;
  if (ex.pickup_reason_type === 'other') {
    return ex.pickup_reason_other || ex.pickup_reason_label || 'Other Reason';
  }
  return ex.pickup_reason_label || null;
}

/** Dropdown label, e.g. "Employee Left" or "Other Reason". */
export function pickupReasonTypeLabel(extra) {
  const ex = parseRequestExtra(extra);
  if (!ex.pickup_reason_type) return null;
  return ex.pickup_reason_label || null;
}

/** Primary reason text: custom text for "Other", otherwise the selected reason label. */
export function pickupReasonDetail(extra, issueDescription, requestType) {
  const ex = parseRequestExtra(extra);
  if (ex.pickup_reason_type) {
    if (ex.pickup_reason_type === 'other') {
      return ex.pickup_reason_other || null;
    }
    return ex.pickup_reason_label || null;
  }
  if (requestType === 'pickup') {
    const desc = String(issueDescription || '').trim();
    if (desc && desc !== GENERIC_PICKUP_DESCRIPTION) return desc;
  }
  return null;
}

/** Optional extra remarks appended on the public form. */
export function pickupReasonRemarks(extra, issueDescription) {
  const ex = parseRequestExtra(extra);
  if (!ex.pickup_reason_type) return null;
  const label = ex.pickup_reason_type === 'other'
    ? (ex.pickup_reason_other || ex.pickup_reason_label)
    : ex.pickup_reason_label;
  const desc = String(issueDescription || '').trim();
  if (!desc || !label) return null;
  const prefix = `${label} — `;
  if (desc.startsWith(prefix)) return desc.slice(prefix.length).trim() || null;
  if (desc === label) return null;
  return desc;
}
