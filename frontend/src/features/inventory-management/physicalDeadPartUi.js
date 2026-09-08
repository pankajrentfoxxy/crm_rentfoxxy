import { getBackendOrigin } from '../../utils/api';

export function physicalUploadUrl(p) {
  if (!p) return null;
  if (String(p).startsWith('http') || String(p).startsWith('data:')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${String(p).replace(/^\/?uploads\//, '')}`;
}

export function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN');
}

export function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function statusChip(status) {
  if (status === 'out' || status === 'dispatched') return 'bg-slate-100 text-slate-700';
  if (status === 'pending' || status === 'dispatch_ready') return 'bg-blue-50 text-blue-800';
  if (status === 'cancelled') return 'bg-red-50 text-red-700';
  if (status === 'draft') return 'bg-amber-50 text-amber-800';
  return 'bg-amber-50 text-amber-800';
}

export function outwardStatusLabel(status) {
  return String(status || 'draft').replace(/_/g, ' ').toUpperCase();
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function physicalPhotoList(row, ...keys) {
  if (!row) return [];
  const names = keys.length ? keys : ['inward_photos', 'inward_photo_paths', 'inward_photo_path'];
  const out = [];
  for (const key of names) {
    const val = row[key];
    if (Array.isArray(val)) out.push(...val);
    else if (val) out.push(val);
  }
  return [...new Set(out.filter(Boolean))];
}

export function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}
