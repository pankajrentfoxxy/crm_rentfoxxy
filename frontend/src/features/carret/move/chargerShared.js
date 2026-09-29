/**
 * Dispatch charger — shared words and helpers for the new UI. A charger kit is
 * a Laptop Charger Power Adapter plus a Power cable, both warehouse stock (PRT),
 * handed over for one laptop going out on one order.
 */
export const CHARGER_STATUS = {
  pending: { label: 'Waiting for warehouse', chip: 'pending' },
  handed_over: { label: 'Handed over — attach at Dispatch QC', chip: 'sent' },
  attached: { label: 'Attached to the laptop', chip: 'approved' },
  dispatched: { label: 'Went out with the laptop', chip: 'approved' },
  returned: { label: 'Came back', chip: 'closed' },
  already_with_customer: { label: 'Customer already has one', chip: 'closed' },
};

export const chargerStatusLabel = (status) => CHARGER_STATUS[status]?.label || String(status || '').replace(/_/g, ' ');

export const laptopConfig = (r) => [
  r.laptop_processor, r.laptop_generation, r.laptop_ram, r.laptop_storage,
].filter(Boolean).join(' · ');

export const laptopName = (r) => [r.brand, r.model].filter(Boolean).join(' ');

export const kitRoleOf = (unit) => (/(cable|cord)/i.test(String(unit?.part_name || '')) ? 'cable' : 'adapter');

export const errText = (e, fallback) => e?.response?.data?.message || fallback;
