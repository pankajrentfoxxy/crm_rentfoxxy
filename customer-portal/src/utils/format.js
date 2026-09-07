import { format, parseISO } from 'date-fns';

export function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function toDate(value) {
  if (!value) return null;
  const d = typeof value === 'string' ? parseISO(value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value, fallback = '—') {
  const d = toDate(value);
  return d ? format(d, 'dd MMM yyyy') : fallback;
}

export function fmtDateTime(value, fallback = '—') {
  const d = toDate(value);
  return d ? format(d, 'dd MMM yyyy, h:mm a') : fallback;
}

/** `in_transit` -> `In Transit` */
export function humanize(value, fallback = '—') {
  if (value == null || value === '') return fallback;
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Today's date as `yyyy-MM-dd`, for date inputs. */
export function today() {
  return format(new Date(), 'yyyy-MM-dd');
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function looksLikeJson(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return t.startsWith('{') || t.startsWith('[') || t.startsWith('"') || t.includes('\\"');
}

function unwrapEncoded(value) {
  let cur = value;
  for (let i = 0; i < 10 && typeof cur === 'string'; i += 1) {
    const trimmed = cur.trim();
    if (!trimmed || !looksLikeJson(trimmed)) return trimmed;
    let next = tryParseJson(trimmed);
    if (next === undefined) next = tryParseJson(`"${trimmed}"`);
    if (next === undefined) {
      const peeled = trimmed.replace(/\\"/g, '"').replace(/^"+|"+$/g, '').trim();
      next = tryParseJson(peeled);
      if (next === undefined && peeled !== trimmed) {
        cur = peeled;
        continue;
      }
    }
    if (next === undefined || next === cur) break;
    cur = next;
  }
  return cur;
}

/** Flatten double/triple-encoded shipping JSON into a plain address object. */
export function parseAddress(raw) {
  if (raw == null || raw === '') return null;
  let cur = typeof raw === 'string' ? unwrapEncoded(raw) : { ...raw };
  if (typeof cur === 'string') {
    const again = unwrapEncoded(cur);
    if (typeof again === 'object' && again) cur = again;
    else return again && String(again).trim() ? { address: String(again).trim() } : null;
  }
  if (typeof cur !== 'object' || Array.isArray(cur)) return null;
  if (typeof cur.address === 'string' && looksLikeJson(cur.address)) {
    const inner = unwrapEncoded(cur.address);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const company = cur.name;
      cur = { ...cur, ...inner };
      if (company && inner.name && company !== inner.name) cur.company = cur.company || company;
    } else if (typeof inner === 'string' && !looksLikeJson(inner)) {
      cur.address = inner;
    }
  }
  if (cur.zip_code && !cur.pincode) cur.pincode = cur.zip_code;
  return cur;
}

/** Readable multi-line delivery address for portal pages. */
export function formatAddress(raw) {
  const a = parseAddress(raw);
  if (!a) return null;
  const street = a.address && !looksLikeJson(String(a.address))
    ? a.address
    : (a.address_line_1 || a.line1 || a.address_line);
  const locality = [a.city, a.state, a.pincode || a.zip_code].filter(Boolean).join(', ');
  const company = a.company && a.company !== a.name ? a.company : null;
  const lines = [
    a.name,
    company,
    street,
    locality,
    a.country,
    a.phone ? `Ph: ${a.phone}` : null,
  ].filter((part) => part && !looksLikeJson(String(part)));
  return lines.length ? lines.join('\n') : null;
}
