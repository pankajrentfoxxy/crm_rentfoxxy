const axios = require('axios');

const cache = new Map();
const TIMEOUT_MS = 15000;

const POSTAL_URLS = (pin) => [
  `https://api.postalpincode.in/pincode/${pin}`,
  `http://www.postalpincode.in/api/pincode/${pin}`,
];

function sanitizePincode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function normalizePostalPayload(raw) {
  if (Array.isArray(raw) && raw.length) return raw[0];
  return raw;
}

function matchIndianState(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/delhi|new delhi|nct/i.test(s)) return 'Delhi';
  if (/jammu|j\s*&\s*k/i.test(s)) return 'Jammu and Kashmir';
  if (/ladakh/i.test(s)) return 'Ladakh';
  return s;
}

function parsePostalPayload(raw) {
  const data = normalizePostalPayload(raw);
  if (!data || data.Status !== 'Success' || !Array.isArray(data.PostOffice) || !data.PostOffice.length) {
    return null;
  }
  const po = data.PostOffice.find((p) => p.DeliveryStatus === 'Delivery') || data.PostOffice[0];
  return {
    city: po.District || po.Name || '',
    state: matchIndianState(po.State),
  };
}

async function fetchPostalPincodeIn(pin) {
  for (const url of POSTAL_URLS(pin)) {
    try {
      const { data } = await axios.get(url, {
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
      });
      const parsed = parsePostalPayload(data);
      if (parsed) return parsed;
    } catch {
      // try next URL
    }
  }
  return null;
}

async function fetchZippopotam(pin) {
  try {
    const { data } = await axios.get(`https://api.zippopotam.us/in/${pin}`, {
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (!Array.isArray(data?.places) || !data.places.length) return null;
    const place = data.places[0];
    return {
      city: place['place name'] || '',
      state: matchIndianState(place.state),
    };
  } catch {
    return null;
  }
}

async function lookupPincode(pincode) {
  const pin = sanitizePincode(pincode);
  if (pin.length !== 6) return null;
  if (cache.has(pin)) return cache.get(pin);

  const result = (await fetchPostalPincodeIn(pin)) || (await fetchZippopotam(pin));
  if (result) cache.set(pin, result);
  return result;
}

module.exports = { lookupPincode, sanitizePincode, parsePostalPayload, normalizePostalPayload };
