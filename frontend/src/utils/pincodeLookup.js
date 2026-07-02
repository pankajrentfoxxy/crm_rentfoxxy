import { matchIndianState, slugifyState } from '../constants/indianStates';
import api from './api';

const cache = new Map();
const LOOKUP_TIMEOUT_MS = 15000;

export function sanitizePincode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function normalizePostalPayload(raw) {
  if (Array.isArray(raw) && raw.length) return raw[0];
  return raw;
}

function parsePostalPayload(raw) {
  const data = normalizePostalPayload(raw);
  if (!data || data.Status !== 'Success' || !Array.isArray(data.PostOffice) || !data.PostOffice.length) {
    return null;
  }
  const po = data.PostOffice.find((p) => p.DeliveryStatus === 'Delivery') || data.PostOffice[0];
  return {
    city: po.District || po.Name || '',
    state: po.State || '',
  };
}

function toResult(city, state) {
  const stateName = matchIndianState(state) || state || '';
  return {
    city: city || '',
    state: stateName,
    stateSlug: slugifyState(stateName),
  };
}

async function lookupViaBackend(pin) {
  const { data } = await api.get(`/utils/pincode/${pin}`, { timeout: LOOKUP_TIMEOUT_MS });
  if (!data?.success) return null;
  return toResult(data.city, data.state);
}

async function lookupViaPostalPincodeIn(pin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: controller.signal });
    if (!res.ok) return null;
    const raw = await res.json();
    const parsed = parsePostalPayload(raw);
    if (!parsed) return null;
    return toResult(parsed.city, parsed.state);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookupViaZippopotam(pin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.zippopotam.us/in/${pin}`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.places) || !data.places.length) return null;
    const place = data.places[0];
    return toResult(place['place name'], place.state);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupPincode(pincode) {
  const pin = sanitizePincode(pincode);
  if (pin.length !== 6) return null;
  if (cache.has(pin)) return cache.get(pin);

  const sources = [lookupViaBackend, lookupViaPostalPincodeIn, lookupViaZippopotam];
  let result = null;
  for (const source of sources) {
    try {
      result = await source(pin);
      if (result) break;
    } catch {
      // try next source
    }
  }
  if (result) cache.set(pin, result);
  return result;
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

/** Apply pincode + optional city/state in one updater call. */
export async function applyPincodeAutofill(rawValue, setForm, fields) {
  const { pin, info } = await lookupAndResolvePincode(rawValue);
  setForm((f) => ({
    ...f,
    [fields.pinKey]: pin,
    ...(info ? {
      [fields.cityKey]: info.city || f[fields.cityKey],
      [fields.stateKey]: fields.useStateSlug
        ? (info.stateSlug || f[fields.stateKey])
        : (info.state || f[fields.stateKey]),
    } : {}),
  }));
  return { pin, info };
}

export function pincodeInputProps(setForm, fields) {
  const run = (value) => applyPincodeAutofill(value, setForm, fields);
  return {
    valueKey: fields.pinKey,
    onChange: (e) => { run(e.target.value); },
    onBlur: (e) => { run(e.target.value); },
  };
}
