/**
 * Vendor return request (D10) — shared by the form and the record.
 * Reasons mirror backend/services/vendorReturnRequestMail.js REASONS.
 */
export const RETURN_REASONS = [
  { value: 'customer_returned', label: 'Returned by our customer' },
  { value: 'surplus', label: 'Surplus to our requirement' },
  { value: 'faulty', label: 'Not working to the expected standard' },
  { value: 'requirement_ended', label: 'Rental requirement has ended' },
  { value: 'other', label: 'Other (write the reason)' },
];

export const MAX_DAYS_AHEAD = 30;

/** Today as YYYY-MM-DD in India, whatever the browser's clock zone. */
export function todayIst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function prettyDate(ymd) {
  if (!ymd) return '—';
  return new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function prettyTime(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hhmm || '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

export const REQUEST_STATUS_LABEL = {
  requested: 'Draft — not sent',
  notified: 'Vendor told — rent stops',
  partially_picked: 'Part picked up',
  picked: 'Picked up',
  completed: 'Vendor has them',
  cancelled: 'Cancelled',
};

export const ITEM_STATUS_LABEL = {
  requested: 'Not sent yet',
  rental_stopped: 'Waiting for pickup',
  dc_created: 'On a return challan',
  handed_over: 'Left the gate',
  vendor_received: 'Vendor has it',
  cancelled: 'Taken off',
};

export const laptopLine = (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—';
export const specLine = (r) => r.configuration || [r.processor, r.ram, r.storage].filter(Boolean).join(' · ');

/** Checks the form fields the way the server does; returns an error or null. */
export function validateRequestFields(f) {
  const today = todayIst();
  if (!f.reason_code) return 'Choose why the laptops are going back';
  if (f.reason_code === 'other' && String(f.return_reason || '').trim().length < 3) return 'Write the reason';
  if (!f.rent_stop_date) return 'Choose the date rent stops';
  if (f.rent_stop_date < today) return 'Rent stop date can’t be in the past';
  if (f.rent_stop_date > addDays(today, MAX_DAYS_AHEAD)) return `Rent stop date can be at most ${MAX_DAYS_AHEAD} days ahead`;
  if (!f.pickup_date) return 'Choose the pickup date';
  if (f.pickup_date < today) return 'Pickup date can’t be in the past';
  if (!f.pickup_time) return 'Choose the pickup time';
  return null;
}
