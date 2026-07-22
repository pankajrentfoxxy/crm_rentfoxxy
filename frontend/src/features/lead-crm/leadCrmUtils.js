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

export function followUpCalendarYmd(followUpDate) {
  if (!followUpDate) return null;
  if (typeof followUpDate === 'string') {
    const m = followUpDate.match(/^(\d{4}-\d{2}-\d{2})/);
    // Prefer explicit calendar date when string starts with YYYY-MM-DD (date inputs / noon IST storage)
    if (m && !/T/.test(followUpDate.slice(0, 11))) return m[1];
  }
  const d = new Date(followUpDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function followUpTone(followUpDate, followUpTime) {
  if (!followUpDate) return 'neutral';
  const ymd = followUpCalendarYmd(followUpDate);
  if (!ymd) return 'neutral';
  const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (ymd < todayYmd) return 'overdue';
  if (ymd > todayYmd) return 'future';
  // Today: if time is set and already passed, treat as overdue for display tone
  if (followUpTime) {
    const due = followUpDueAt(followUpDate, followUpTime);
    if (due && due.getTime() < Date.now()) return 'overdue';
  }
  return 'today';
}

/** Absolute due Date from follow_up_date + follow_up_time (IST). */
export function followUpDueAt(followUpDate, followUpTime) {
  const ymd = followUpCalendarYmd(followUpDate);
  if (!ymd) return null;
  const timeStr = followUpTime ? String(followUpTime).slice(0, 5) : '12:00';
  const m = timeStr.match(/^(\d{1,2}):(\d{2})/);
  const hh = m ? String(parseInt(m[1], 10)).padStart(2, '0') : '12';
  const mm = m ? m[2] : '00';
  const due = new Date(`${ymd}T${hh}:${mm}:00+05:30`);
  return Number.isNaN(due.getTime()) ? null : due;
}

export function formatFollowUpDateTime(date, time) {
  if (!date) return '—';
  const ymd = followUpCalendarYmd(date);
  const d = ymd ? new Date(`${ymd}T12:00:00+05:30`) : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  let out = d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  if (time) {
    const [h, m] = String(time).split(':');
    const t = new Date(`${ymd || '2000-01-01'}T${String(h).padStart(2, '0')}:${String(m || '00').padStart(2, '0')}:00+05:30`);
    out += ` ${t.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    })}`;
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

export function filterAssignableUsers(users = [], excludedNames = []) {
  const blocked = new Set(excludedNames.map((name) => String(name).toLowerCase()));
  return users.filter((user) => !blocked.has(String(user?.name || '').toLowerCase()));
}
