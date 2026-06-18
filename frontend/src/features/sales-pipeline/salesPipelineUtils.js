export const PRIMARY = '#2563EB';

export const FALLBACK_BRANDS = [
  'Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer',
  'MSI', 'Samsung', 'Toshiba', 'Other',
];
export const FALLBACK_MODELS = {
  Dell: ['Latitude 3410', 'Latitude 3510', 'Latitude 5410', 'Latitude 5510',
    'Inspiron 14', 'Inspiron 15', 'Vostro 3400', 'Vostro 3500', 'XPS 13', 'Other'],
  HP: ['ProBook 440', 'ProBook 450', 'EliteBook 840', 'Pavilion 14',
    'Pavilion 15', 'Laptop 15s', '250 G8', '255 G8', 'Other'],
  Lenovo: ['ThinkPad E14', 'ThinkPad E15', 'ThinkPad T14', 'IdeaPad 3',
    'IdeaPad 5', 'V14', 'V15', 'Legion 5', 'Other'],
  Apple: ['MacBook Air M1', 'MacBook Air M2', 'MacBook Pro 13',
    'MacBook Pro 14', 'MacBook Pro 16', 'Other'],
  Asus: ['VivoBook 14', 'VivoBook 15', 'ZenBook 14', 'ExpertBook B1', 'Other'],
  Acer: ['Aspire 5', 'Aspire 7', 'Swift 3', 'TravelMate P2', 'Other'],
  Other: ['Other'],
};
export const FALLBACK_PROCESSORS = [
  'Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9',
  'AMD Ryzen 3', 'AMD Ryzen 5', 'AMD Ryzen 7',
  'Apple M1', 'Apple M2', 'Apple M3',
];
export const FALLBACK_GENERATIONS = [
  '6th Gen', '7th Gen', '8th Gen', '9th Gen', '10th Gen',
  '11th Gen', '12th Gen', '13th Gen', '14th Gen',
];
export const FALLBACK_RAM = ['4 GB', '8 GB', '12 GB', '16 GB', '24 GB', '32 GB', '64 GB'];
export const FALLBACK_STORAGE = [
  '128 GB SSD', '256 GB SSD', '512 GB SSD', '1 TB SSD',
  '256 GB HDD', '512 GB HDD', '1 TB HDD', '2 TB HDD',
];
export const FALLBACK_GPU = [
  'Integrated', 'NVIDIA GTX 1650', 'NVIDIA RTX 3050',
  'NVIDIA RTX 3060', 'NVIDIA RTX 4060', 'AMD Radeon RX', 'Other Dedicated',
];
export const FALLBACK_SCREEN_SIZES = ['11.6"', '13.3"', '14"', '15.6"', '16"', '17.3"'];

export const QUOTE_STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-gray-100 text-gray-700',
  sent: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

export const TYPE_STYLES = {
  rental: 'bg-blue-100 text-blue-800',
  demo: 'bg-blue-100 text-blue-800',
  sale: 'bg-emerald-100 text-emerald-800',
};

export const DC_STATUS_STYLES = {
  pending: 'bg-gray-100 text-gray-700',
  in_transit: 'bg-amber-100 text-amber-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

export const DISPATCH_MODE_STYLES = {
  courier: 'bg-blue-100 text-blue-800',
  porter: 'bg-purple-100 text-purple-800',
  inhouse: 'bg-teal-100 text-teal-800',
};

export function formatCurrency(n) {
  const v = Number(n) || 0;
  return `₹ ${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function lineTotal(line) {
  return (Number(line.rate) || 0) * (Number(line.quantity) || 0);
}

export function sumLines(lines) {
  return (lines || []).reduce((s, l) => s + lineTotal(l), 0);
}

export function formatConfig(line) {
  return [
    line.brand,
    line.model_name || line.model,
    line.processor,
    line.generation,
    line.ram,
    line.storage,
    line.gpu,
    line.screen_size,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function typeLabel(t) {
  if (t === 'sale') return 'Sales';
  if (t === 'rental' || t === 'demo') return 'Rental';
  return t || '—';
}

export function statusLabel(s) {
  if (!s) return '—';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseSerials(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [p];
  } catch {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

export function countLaptops(lines) {
  return (lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
}
