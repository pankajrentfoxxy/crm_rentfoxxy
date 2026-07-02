export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Ladakh',
];

export function slugifyState(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

export function matchIndianState(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const slug = slugifyState(raw);
  for (const state of INDIAN_STATES) {
    if (slugifyState(state) === slug || state.toLowerCase() === raw.toLowerCase()) return state;
  }
  if (/delhi|nct/i.test(raw)) return 'Delhi';
  if (/jammu|j\s*&\s*k/i.test(raw)) return 'Jammu and Kashmir';
  if (/ladakh/i.test(raw)) return 'Ladakh';
  return null;
}

export function resolveStateSelectValue(stored) {
  if (!stored) return '';
  return matchIndianState(stored) || stored;
}

export const INDIAN_STATE_OPTIONS = INDIAN_STATES.map((name) => ({
  label: name,
  value: slugifyState(name),
}));
