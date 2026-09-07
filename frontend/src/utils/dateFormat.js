const IST = 'Asia/Kolkata';

function parseDate(value) {
  if (value == null || value === '') return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function partsFromDt(dt, withTime = false) {
  const opts = {
    timeZone: IST,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  };
  if (withTime) {
    Object.assign(opts, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  }
  const parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(dt);
  const pick = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    day: pick('day'),
    month: pick('month'),
    year: pick('year'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
    dayPeriod: pick('dayPeriod'),
  };
}

/** DD-MM-YYYY in IST */
export function formatDdMmYyyy(value) {
  const dt = parseDate(value);
  if (!dt) return '—';
  const { day, month, year } = partsFromDt(dt, false);
  return `${day}-${month}-${year}`;
}

/** DD-MM-YYYY, hh:mm:ss AM/PM in IST */
export function formatDdMmYyyyDateTime(value) {
  const dt = parseDate(value);
  if (!dt) return '—';
  const { day, month, year, hour, minute, second, dayPeriod } = partsFromDt(dt, true);
  return `${day}-${month}-${year}, ${hour}:${minute}:${second} ${dayPeriod}`;
}
