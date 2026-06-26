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

function unwrapJsonValue(value, depth = 0) {
  if (value == null || depth > 6) return value;

  if (typeof value === 'string') {
    if (!looksLikeEncodedJson(value)) return value;
    const parsed = tryParseJsonString(value);
    if (parsed !== undefined) return unwrapJsonValue(parsed, depth + 1);
    const unescaped = value.replace(/\\"/g, '"').replace(/^"+|"+$/g, '').trim();
    if (unescaped !== value) {
      const parsed2 = tryParseJsonString(unescaped);
      if (parsed2 !== undefined) return unwrapJsonValue(parsed2, depth + 1);
    }
    return value;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const out = { ...value };
    if (typeof out.address === 'string' && looksLikeEncodedJson(out.address)) {
      const unwrapped = unwrapJsonValue(out.address, depth + 1);
      if (typeof unwrapped === 'object' && unwrapped !== null && !Array.isArray(unwrapped)) {
        Object.assign(out, unwrapped);
      } else if (typeof unwrapped === 'string' && !looksLikeEncodedJson(unwrapped)) {
        out.address = unwrapped;
      }
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
  const line = [a.address, a.city, a.state, a.pincode || a.zip_code]
    .filter((part) => part && !looksLikeEncodedJson(String(part)))
    .join(', ');
  return line || null;
}

module.exports = {
  normalizeDeliveryAddress,
  formatDeliveryAddressLine,
};
