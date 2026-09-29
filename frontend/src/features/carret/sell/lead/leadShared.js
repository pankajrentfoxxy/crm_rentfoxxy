/**
 * Lead pipeline, as the user chose (26 Sep 2026): the existing status and stage
 * values, grouped for the board. Rejected / Gone need a lost reason (the stage).
 */
export const COLUMNS = [
  { key: 'new', label: 'New', statuses: ['Pending'] },
  { key: 'callback', label: 'Call back / on hold', statuses: ['Call Back', 'Hold'] },
  { key: 'interested', label: 'Interested', statuses: ['Cold', 'Warm'] },
  { key: 'proposal', label: 'Proposal / demo', statuses: ['Hot', 'Demo'] },
  { key: 'deal', label: 'Deal', statuses: ['Deal', 'Repeat'] },
  { key: 'closed', label: 'Lost', statuses: ['Rejected', 'Gone'] },
];
export const columnOf = (status) => COLUMNS.find((c) => c.statuses.includes(status))?.key || 'new';
export const OPEN_STATUSES = ['Pending', 'Call Back', 'Hold', 'Cold', 'Warm', 'Hot', 'Demo'];
export const CLOSED_STATUSES = ['Rejected', 'Gone'];

/** What each status means, in words sales use. */
export const STATUS_HINT = {
  Pending: 'New — not spoken to yet',
  'Call Back': 'Asked us to call back',
  Hold: 'Their plan is on hold',
  Cold: 'Interested — early',
  Warm: 'Interested — price talks',
  Hot: 'Agreement stage',
  Demo: 'On a demo (customer created)',
  Deal: 'Won (customer created)',
  Repeat: 'Repeat customer',
  Rejected: 'Lost — see reason',
  Gone: 'Lost — went elsewhere / cancelled',
};

/**
 * One colour per pipeline group, from the theme tokens (so dark mode works and
 * there is no hex in the app): New neutral, Call back amber, Interested blue,
 * Proposal / demo orange, Deal green, Lost red.
 */
export const GROUP_TONE = {
  new: { fg: 'var(--lc-closed)', bg: 'var(--lc-closed-soft)' },
  callback: { fg: 'var(--lc-moving)', bg: 'var(--lc-moving-soft)' },
  interested: { fg: 'var(--lc-idle)', bg: 'var(--lc-idle-soft)' },
  proposal: { fg: 'var(--alert-serious)', bg: 'var(--lc-offcycle-soft)' },
  deal: { fg: 'var(--lc-earning)', bg: 'var(--lc-earning-soft)' },
  closed: { fg: 'var(--alert-crit)', bg: 'var(--alert-crit-soft)' },
};
export const toneOf = (status) => GROUP_TONE[columnOf(status)] || GROUP_TONE.new;
/** A status's colour as a CSS value. */
export const STATUS_TONE = Object.fromEntries(COLUMNS.flatMap((c) => c.statuses.map((st) => [st, GROUP_TONE[c.key].fg])));

export const SOURCES = ['Google', 'Apollo', 'Email', 'Website', 'Reference', 'LinkedIn', 'Cold Call', 'WhatsApp', 'Just Dial', 'IndiaMART', 'Team', 'Walk-in', 'Other'];
export const INQUIRY = [{ value: 'rental', label: 'Rental' }, { value: 'sales', label: 'Purchase' }, { value: 'both', label: 'Both' }];
export const BRANDS = ['Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer'];
export const PROCESSORS = ['Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9', 'AMD Ryzen 5', 'AMD Ryzen 7', 'Apple M1', 'Apple M2', 'Apple M3'];
export const GENERATIONS = ['8th Gen', '10th Gen', '11th Gen', '12th Gen', '13th Gen', '14th Gen'];
export const RAMS = ['8 GB', '16 GB', '32 GB'];
export const STORAGES = ['256 GB SSD', '512 GB SSD', '1 TB SSD'];
export const OUTCOMES = [
  { value: 'spoke', label: 'Spoke to them' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'call_back', label: 'Asked to call back' },
  { value: 'meeting_done', label: 'Meeting / demo done' },
  { value: 'not_interested', label: 'Not interested' },
];

export const leadErr = (e, fallback = 'That did not work.') => e?.response?.data?.message || e?.message || fallback;
export const need = (l) => {
  const qty = l.quantityRequired ?? l.quantity_required;
  const months = l.rentalDuration ?? l.rental_duration;
  const cfg = [l.brand, l.processor, l.generation, l.ram, l.storage].filter(Boolean).join(' · ');
  return [qty ? `${qty} laptops` : null, months ? `${months} months` : null, cfg || null].filter(Boolean).join(' · ');
};
export const istDate = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');
export const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const addDaysIst = (n) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);
