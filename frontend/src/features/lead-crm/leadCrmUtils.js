export function leadDisplayLabel(lead) {
  const company = (lead?.companyName || lead?.company_name || '').trim();
  const name = (lead?.name || '').trim();
  if (company) return company;
  if (name && name !== 'Website Enquiry') return name;
  if (lead?.email) return lead.email.split('@')[0];
  if (lead?.phone) return lead.phone;
  return `Lead #${lead?.leadId || '?'}`;
}

export function formatConfig(lead) {
  const parts = [lead?.processor, lead?.generation, lead?.ram, lead?.storage]
    .filter(Boolean)
    .map((p) => String(p).replace(/Intel Core /i, '').replace(/ Gen/i, 'th'));
  if (!parts.length) return '—';
  return parts.join(' | ');
}

export function formatInquiry(type) {
  if (!type) return 'Rental';
  const t = String(type).toLowerCase();
  if (t === 'both') return 'Both';
  if (t === 'sales') return 'Sales';
  return 'Rental';
}

export function relativeTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function followUpTone(followUpDate) {
  if (!followUpDate) return 'neutral';
  const d = new Date(followUpDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fd = new Date(d);
  fd.setHours(0, 0, 0, 0);
  if (fd < today) return 'overdue';
  if (fd.getTime() === today.getTime()) return 'today';
  return 'future';
}

export function formatFollowUpDateTime(date, time) {
  if (!date) return '—';
  const d = new Date(date);
  let out = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (time) {
    const [h, m] = String(time).split(':');
    const t = new Date();
    t.setHours(parseInt(h, 10) || 0, parseInt(m, 10) || 0);
    out += ` ${t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return out;
}

export function formatCurrency(value) {
  if (value == null || value === '') return '—';
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

export function startOfMonth(year, month) {
  return new Date(year, month, 1);
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
