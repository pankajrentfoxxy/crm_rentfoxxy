import { matchIndianState, resolveStateSelectValue } from '../constants/indianStates';
import api from './api';

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const cache = new Map();
const LOOKUP_TIMEOUT_MS = 25000;
const DEBOUNCE_MS = 450;

export function sanitizeGstin(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15);
}

export function isValidGstin(value) {
  return GSTIN_RE.test(sanitizeGstin(value));
}

export async function lookupGstin(rawGstin) {
  const gstin = sanitizeGstin(rawGstin);
  if (!isValidGstin(gstin)) return null;
  if (cache.has(gstin)) return cache.get(gstin);

  const { data } = await api.get(`/utils/gstin/${gstin}`, { timeout: LOOKUP_TIMEOUT_MS });
  if (!data?.success || !data.data) return null;

  const info = {
    ...data.data,
    state: matchIndianState(data.data.state) || data.data.state || '',
    stateSelect: resolveStateSelectValue(data.data.state || ''),
  };
  cache.set(gstin, info);
  return info;
}

/**
 * Debounced GSTIN autofill.
 * fieldMap example (lead):
 *   { gstKey, companyKey, brandKey, cityKey, stateKey, pinKey, panKey, companyTypeKey, addressKey }
 */
export function createGstinAutofillHandler(setForm, fieldMap = {}, opts = {}) {
  let timer = null;
  let seq = 0;
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;

  const apply = async (rawValue) => {
    const gstin = sanitizeGstin(rawValue);
    const my = ++seq;
    setForm((f) => ({ ...f, [fieldMap.gstKey || 'gst_number']: gstin }));

    if (gstin.length < 15) {
      onStatus?.(null);
      return;
    }
    if (!isValidGstin(gstin)) {
      onStatus?.({ type: 'error', message: 'Invalid GSTIN format' });
      return;
    }

    onStatus?.({ type: 'loading', message: 'Looking up GSTIN…' });
    try {
      const info = await lookupGstin(gstin);
      if (my !== seq) return;
      if (!info) {
        onStatus?.({ type: 'error', message: 'No GST details found' });
        return;
      }
      setForm((f) => {
        const next = { ...f, [fieldMap.gstKey || 'gst_number']: gstin };
        if (fieldMap.companyKey && info.company_name) next[fieldMap.companyKey] = info.company_name;
        if (fieldMap.brandKey && info.trade_name) next[fieldMap.brandKey] = info.trade_name;
        if (fieldMap.cityKey && info.city) next[fieldMap.cityKey] = info.city;
        if (fieldMap.stateKey && (info.stateSelect || info.state)) {
          next[fieldMap.stateKey] = info.stateSelect || info.state;
        }
        if (fieldMap.pinKey && info.pincode) next[fieldMap.pinKey] = info.pincode;
        if (fieldMap.panKey && info.pan_number) next[fieldMap.panKey] = info.pan_number;
        if (fieldMap.companyTypeKey && info.company_type) next[fieldMap.companyTypeKey] = info.company_type;
        if (fieldMap.addressKey && info.address) next[fieldMap.addressKey] = info.address;
        return next;
      });
      onStatus?.({ type: 'success', message: info.company_name || 'GST details filled' });
    } catch (err) {
      if (my !== seq) return;
      onStatus?.({
        type: 'error',
        message: err.response?.data?.message || err.message || 'GSTIN lookup failed',
      });
    }
  };

  return (rawValue) => {
    if (timer) clearTimeout(timer);
    const gstin = sanitizeGstin(rawValue);
    setForm((f) => ({ ...f, [fieldMap.gstKey || 'gst_number']: gstin }));
    if (gstin.length < 15) {
      onStatus?.(null);
      return;
    }
    timer = setTimeout(() => apply(rawValue), DEBOUNCE_MS);
  };
}
