/** Mirrors backend/services/vendorRepairMail.js ISSUE_TYPES (claude/carret-vendor-repair.md). */
export const REPAIR_ISSUE_TYPES = [
  { value: 'no_power', label: 'Not powering on / dead' },
  { value: 'motherboard', label: 'Motherboard / chip-level fault' },
  { value: 'display', label: 'Display / screen' },
  { value: 'keyboard', label: 'Keyboard' },
  { value: 'touchpad', label: 'Touchpad' },
  { value: 'battery', label: 'Battery' },
  { value: 'charging', label: 'Charging port / adapter' },
  { value: 'storage', label: 'Storage (SSD / HDD)' },
  { value: 'ram', label: 'RAM / memory' },
  { value: 'overheating', label: 'Overheating / fan' },
  { value: 'hinge_body', label: 'Hinge / body damage' },
  { value: 'ports', label: 'Ports (USB / HDMI / LAN)' },
  { value: 'audio_camera', label: 'Audio / camera / mic' },
  { value: 'wifi', label: 'Wi-Fi / Bluetooth' },
  { value: 'bios_os', label: 'BIOS / OS / software lock' },
  { value: 'other', label: 'Other' },
];

export const issueTypeLabel = (v) => REPAIR_ISSUE_TYPES.find((x) => x.value === v)?.label || v || '—';

export function todayIst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function addDaysYmd(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
