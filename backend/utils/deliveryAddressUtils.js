function tryParseJsonString(s) {
  if (typeof s !== 'string') return undefined;
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function looksLikeEncodedJson(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return t.startsWith('{')
    || t.startsWith('[')
    || t.startsWith('"')
    || t.includes('\\"');
}

function unwrapEncodedString(value) {
  let cur = value;
  for (let i = 0; i < 10 && typeof cur === 'string'; i += 1) {
    const trimmed = cur.trim();
    if (!trimmed) return trimmed;
    if (!looksLikeEncodedJson(trimmed)) return trimmed;
    let next = tryParseJsonString(trimmed);
    // Outer quotes are often stripped, leaving \"{...}\". Re-wrap as a JSON string.
    if (next === undefined) next = tryParseJsonString(`"${trimmed}"`);
    if (next === undefined) {
      const peeled = trimmed.replace(/\\"/g, '"').replace(/^"+|"+$/g, '').trim();
      next = tryParseJsonString(peeled);
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

function unwrapJsonValue(value, depth = 0) {
  if (value == null || depth > 6) return value;

  if (typeof value === 'string') {
    if (!looksLikeEncodedJson(value)) return value;
    return unwrapJsonValue(unwrapEncodedString(value), depth + 1);
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const out = { ...value };
    for (const key of ['address', 'address_line_1', 'line1', 'address_line']) {
      if (typeof out[key] === 'string' && looksLikeEncodedJson(out[key])) {
        const unwrapped = unwrapJsonValue(out[key], depth + 1);
        if (typeof unwrapped === 'object' && unwrapped !== null && !Array.isArray(unwrapped)) {
          const company = out.name;
          Object.assign(out, unwrapped);
          if (company && unwrapped.name && company !== unwrapped.name) {
            out.company = out.company || company;
          }
        } else if (typeof unwrapped === 'string' && !looksLikeEncodedJson(unwrapped)) {
          out.address = unwrapped;
        }
        break;
      }
    }
    if (!out.address || looksLikeEncodedJson(String(out.address))) {
      const street = out.address_line_1 || out.line1 || out.address_line;
      if (street && !looksLikeEncodedJson(String(street))) out.address = street;
    }
    if (out.zip_code && !out.pincode) out.pincode = out.zip_code;
    return out;
  }

  return value;
}

function normalizeDeliveryAddress(raw) {
  if (raw == null) return null;
  const unwrapped = unwrapJsonValue(raw);
  if (typeof unwrapped !== 'object' || unwrapped == null || Array.isArray(unwrapped)) {
    return typeof unwrapped === 'string' && unwrapped.trim()
      ? { address: unwrapped.trim() }
      : null;
  }
  return unwrapped;
}

function formatDeliveryAddressLine(raw) {
  const a = normalizeDeliveryAddress(raw);
  if (!a) return null;
  const street = a.address || a.address_line_1 || a.line1 || a.address_line;
  const line = [street, a.city, a.state, a.pincode || a.zip_code]
    .filter((part) => part && !looksLikeEncodedJson(String(part)))
    .join(', ');
  return line || null;
}

module.exports = {
  normalizeDeliveryAddress,
  formatDeliveryAddressLine,
};
