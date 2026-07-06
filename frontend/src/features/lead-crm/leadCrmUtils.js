export function leadDisplayLabel(lead) {
  const company = (lead?.companyName || lead?.company_name || '').trim();
  const name = (lead?.name || '').trim();
  if (company) return company;
  if (name && name !== 'Website Enquiry') return name;
  if (lead?.email) return lead.email.split('@')[0];
  if (lead?.phone) return lead.phone;
  return `Lead #${lead?.leadId || '?'}`;
}

export function resolveLeadConfigDisplay(lead) {
  const firstValue = (...keys) => {
    for (const key of keys) {
      const value = lead?.[key];
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
    return null;
  };

  const brand = firstValue('brand', 'companyBrand', 'company_brand');
  const model = firstValue('model', 'modelName', 'model_name', 'productName', 'product_name');
  const screen = firstValue('screen_size', 'screenSize', 'display_size');
  const processor = firstValue('processor', 'cpu');
  const generation = firstValue('generation');
  const ram = firstValue('ram');
  const storage = firstValue('storage');
  const gpu = firstValue('gpu', 'graphics');

  let title = '';
  if (brand && model) title = `${brand} - ${model}`;
  else title = brand || model || '';

  let screenLine = null;
  if (screen) {
    screenLine = /inch/i.test(screen) ? screen : `${screen}-inch`;
  }

  const specParts = [
    processor,
    generation,
    ram,
    storage,
    gpu && gpu !== 'Integrated' ? gpu : null,
  ].filter(Boolean);

  return {
    title,
    screenLine,
    specLine: specParts.join(' | '),
  };
}

export function leadConfigSummary(lead) {
  const { title, screenLine, specLine } = resolveLeadConfigDisplay(lead);
  const parts = [title, screenLine, specLine].filter(Boolean);
  return parts.join(' | ') || '—';
}

/** Ticket-style spec badges for lead listing */
export function leadConfigBadges(lead) {
  return [
    { label: 'Brand', value: lead?.brand || lead?.companyBrand },
    { label: 'CPU', value: lead?.processor },
    { label: 'Gen', value: lead?.generation },
    { label: 'RAM', value: lead?.ram },
    { label: 'Storage', value: lead?.storage },
    { label: 'Qty', value: lead?.quantityRequired },
  ].filter((b) => b.value != null && String(b.value).trim() !== '');
}

export function formatConfig(lead) {
  return leadConfigSummary(lead);
}

export function formatLeadPrimary(lead) {
  const company = (lead?.companyName || '').trim();
  if (company) return company;
  const email = (lead?.email || '').trim();
  if (email.includes('@')) return email.split('@')[1];
  return leadDisplayLabel(lead);
}

export function formatLeadContactLine(lead) {
  const name = (lead?.name || '').trim();
  const displayName = name && name !== 'Website Enquiry' ? name : null;
  const phone = (lead?.phone || lead?.whatsappNumber || '').trim();
  if (displayName && phone) return `${displayName} · ${phone}`;
  return displayName || phone || '—';
}

export function formatLeadDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatActivityDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
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
