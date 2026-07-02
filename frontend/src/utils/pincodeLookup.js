import { matchIndianState, slugifyState } from '../constants/indianStates';

const cache = new Map();
const LOOKUP_TIMEOUT_MS = 8000;

export function sanitizePincode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

export async function lookupPincode(pincode) {
  const pin = sanitizePincode(pincode);
  if (pin.length !== 6) return null;
  if (cache.has(pin)) return cache.get(pin);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      cache.set(pin, null);
      return null;
    }
    const data = await res.json();
    if (data.Status !== 'Success' || !Array.isArray(data.PostOffice) || !data.PostOffice.length) {
      cache.set(pin, null);
      return null;
    }
    const po = data.PostOffice[0];
    const stateName = matchIndianState(po.State) || po.State || '';
    const result = {
      city: po.District || po.Name || '',
      state: stateName,
      stateSlug: slugifyState(stateName),
    };
    cache.set(pin, result);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupAndResolvePincode(pincode) {
  const pin = sanitizePincode(pincode);
  if (pin.length !== 6) return { pin, info: null };
  try {
    const info = await lookupPincode(pin);
    return { pin, info };
  } catch {
    return { pin, info: null };
  }
}
