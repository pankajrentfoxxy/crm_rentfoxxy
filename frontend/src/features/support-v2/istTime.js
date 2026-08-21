const IST = 'Asia/Kolkata';

export function istToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function formatIst(value, opts = {}) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, ...opts }).format(d);
}

export function formatIstDateTime(value) {
  return formatIst(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function slotTimes(start = '09:30', end = '19:00', step = 30) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const out = [];
  for (let t = sh * 60 + sm; t < eh * 60 + em; t += step) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return out;
}

export function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function nextDays(n = 7, from = istToday()) {
  const [y, mo, d] = from.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo - 1, d));
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(start);
    x.setUTCDate(start.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}
