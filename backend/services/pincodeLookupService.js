const axios = require('axios');

const cache = new Map();
const TIMEOUT_MS = 12000;

function sanitizePincode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function matchIndianState(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/delhi|new delhi|nct/i.test(s)) return 'Delhi';
  if (/jammu|j\s*&\s*k/i.test(s)) return 'Jammu and Kashmir';
  if (/ladakh/i.test(s)) return 'Ladakh';
  return s;
}

async function fetchPostalPincodeIn(pin) {
  try {
    const { data } = await axios.get(`http://www.postalpincode.in/api/pincode/${pin}`, {
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (data?.Status !== 'Success' || !Array.isArray(data.PostOffice) || !data.PostOffice.length) {
      return null;
    }
    const po = data.PostOffice.find((p) => p.DeliveryStatus === 'Delivery') || data.PostOffice[0];
    return {
      city: po.District || po.Name || '',
      state: matchIndianState(po.State),
    };
  } catch {
    return null;
  }
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
  cache.set(pin, result);
  return result;
}

module.exports = { lookupPincode, sanitizePincode };
