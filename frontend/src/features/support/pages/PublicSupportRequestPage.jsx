import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2, CheckCircle2, AlertTriangle, Plus, X,
  Package, Wrench, MapPin,
} from 'lucide-react';
import api from '../../../utils/api';
import { INDIAN_STATES } from '../../../constants/indianStates';
import { applyPincodeAutofill, sanitizePincode } from '../../../utils/pincodeLookup';
import {
  formatIndianMobileInput,
  indianMobileError,
  normalizeIndianMobile,
} from '../../../utils/phoneValidation';

const inputClass = (invalid) =>
  `mt-1 w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 outline-none ${
    invalid
      ? 'border-rose-400 focus:ring-rose-200 focus:border-rose-500'
      : 'border-slate-300 focus:ring-indigo-500 focus:border-indigo-500'
  }`;

function FieldError({ children }) {
  if (!children) return null;
  return <span className="mt-1 block text-xs text-rose-600">{children}</span>;
}

export default function PublicSupportRequestPage() {
  const [params] = useSearchParams();
  const prefillSerial = (params.get('ttspl') || params.get('device') || params.get('serial') || '').toUpperCase();
  const [ticketType, setTicketType] = useState('complaint');
  const [form, setForm] = useState({
    customer_name: '',
    mobile_number: '',
    company_name: '',
    issue_description: '',
    device_serial: ticketType === 'complaint' ? prefillSerial : '',
    mobile_is_poc: true,
    poc_mobile: '',
    pincode: '',
    city: '',
    state: '',
    address: '',
  });
  const [devices, setDevices] = useState([]);
  const [deviceDraft, setDeviceDraft] = useState('');
  const [deviceCustomerId, setDeviceCustomerId] = useState(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [done, setDone] = useState(null);

  useEffect(() => {
    document.title = 'Support Request · Rentfoxxy';
  }, []);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((prev) => (prev[k] ? { ...prev, [k]: '' } : prev));
  };

  const isPickup = ticketType === 'pickup';

  const validateTtspl = async (raw, { expectedCustomerId } = {}) => {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) {
      return { ok: false, message: 'Enter a TTSPL / device ID' };
    }
    const params = expectedCustomerId ? { customer_id: expectedCustomerId } : undefined;
    try {
      const { data } = await api.get(`/support-public/ttspl/${encodeURIComponent(code)}`, { params });
      if (!data?.success || !data.ttspl_id) {
        return { ok: false, message: data?.message || `${code} was not found` };
      }
      return { ok: true, ttspl_id: data.ttspl_id, customer_id: data.customer_id };
    } catch (err) {
      return { ok: false, message: err.response?.data?.message || `${code} is not a valid customer laptop` };
    }
  };

  const addDevice = async (raw) => {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) {
      setFieldErrors((prev) => ({ ...prev, devices: 'Enter a TTSPL / device ID' }));
      return;
    }
    if (devices.includes(code)) {
      setDeviceDraft('');
      setFieldErrors((prev) => ({ ...prev, devices: `${code} is already added` }));
      return;
    }
    setDeviceBusy(true);
    setFieldErrors((prev) => ({ ...prev, devices: '' }));
    const result = await validateTtspl(code, { expectedCustomerId: deviceCustomerId });
    setDeviceBusy(false);
    if (!result.ok) {
      setFieldErrors((prev) => ({ ...prev, devices: result.message }));
      return;
    }
    setDevices((list) => (list.includes(result.ttspl_id) ? list : [...list, result.ttspl_id]));
    setDeviceCustomerId((id) => id || result.customer_id || null);
    setDeviceDraft('');
    setFieldErrors((prev) => ({ ...prev, devices: '' }));
  };

  const removeDevice = (code) => {
    setDevices((list) => {
      const next = list.filter((item) => item !== code);
      if (!next.length) setDeviceCustomerId(null);
      return next;
    });
  };

  useEffect(() => {
    if (!prefillSerial) return;
    let cancelled = false;
    (async () => {
      const result = await validateTtspl(prefillSerial);
      if (cancelled || !result.ok) return;
      setForm((f) => ({ ...f, device_serial: result.ttspl_id }));
      setDevices([result.ttspl_id]);
      setDeviceCustomerId(result.customer_id || null);
    })();
    return () => { cancelled = true; };
  }, [prefillSerial]);

  const onPincodeChange = async (value) => {
    const pin = sanitizePincode(value);
    set('pincode', pin);
    if (pin.length !== 6) return;
    setPinBusy(true);
    try {
      await applyPincodeAutofill(pin, setForm, {
        pinKey: 'pincode',
        cityKey: 'city',
        stateKey: 'state',
        fillAddressIfEmpty: false,
      });
      setFieldErrors((prev) => ({ ...prev, pincode: '', city: '', state: '' }));
    } finally {
      setPinBusy(false);
    }
  };

  const validate = () => {
    const next = {};
    if (!form.customer_name.trim()) next.customer_name = 'Please enter your name';
    const mobileErr = indianMobileError(form.mobile_number, { required: true, label: 'Mobile number' });
    if (mobileErr) next.mobile_number = mobileErr;

    if (isPickup) {
      if (!devices.length) next.devices = 'Add at least one TTSPL / laptop';
      if (!form.mobile_is_poc) {
        const pocErr = indianMobileError(form.poc_mobile, { required: true, label: 'POC mobile number' });
        if (pocErr) next.poc_mobile = pocErr;
      }
      if (sanitizePincode(form.pincode).length !== 6) next.pincode = 'Enter a valid 6-digit pincode';
      if (!form.city.trim()) next.city = 'City is required';
      if (!form.state.trim()) next.state = 'State is required';
      if (!form.address.trim()) next.address = 'Pickup address is required';
    } else {
      if (!String(form.device_serial || '').trim()) next.device_serial = 'TTSPL / device ID is required';
      if (String(form.issue_description || '').trim().length < 10) {
        next.issue_description = 'Please describe the issue (at least 10 characters)';
      }
    }

    setFieldErrors(next);
    const first = Object.values(next)[0];
    if (first) setError(first);
    return !first;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setBusy(true);
    try {
      if (!isPickup) {
        const serialCheck = await validateTtspl(form.device_serial);
        if (!serialCheck.ok) {
          setFieldErrors((prev) => ({ ...prev, device_serial: serialCheck.message }));
          setError(serialCheck.message);
          setBusy(false);
          return;
        }
        set('device_serial', serialCheck.ttspl_id);
      }
      const payload = {
        request_type: ticketType,
        customer_name: form.customer_name.trim(),
        mobile_number: normalizeIndianMobile(form.mobile_number),
        company_name: form.company_name.trim() || undefined,
        issue_description: form.issue_description.trim() || undefined,
      };
      if (isPickup) {
        payload.device_serials = devices;
        payload.mobile_is_poc = form.mobile_is_poc;
        payload.poc_mobile = form.mobile_is_poc ? undefined : normalizeIndianMobile(form.poc_mobile);
        payload.pickup_address = {
          name: form.customer_name.trim(),
          phone: form.mobile_is_poc
            ? normalizeIndianMobile(form.mobile_number)
            : normalizeIndianMobile(form.poc_mobile),
          address: form.address.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          pincode: sanitizePincode(form.pincode),
        };
      } else {
        payload.device_serial = form.device_serial.trim();
      }
      const { data } = await api.post('/support-public/request', payload);
      setDone(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not submit. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const subtitle = useMemo(() => (
    isPickup
      ? 'Schedule a laptop pickup — add each TTSPL and the collection address.'
      : 'Tell us what\'s wrong — we\'ll get back to you shortly.'
  ), [isPickup]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-indigo-50 px-4 py-8">
      <div className="mx-auto w-full max-w-xl">
        <div className="text-center mb-6">
          <img
            src="/rentfoxxy-logo-long.png"
            alt="Rentfoxxy"
            className="h-12 sm:h-14 w-auto mx-auto mb-3"
          />
          <h1 className="text-2xl font-bold text-slate-900">Support</h1>
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 sm:p-7">
          {done ? (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <h2 className="text-lg font-semibold text-slate-900">
                {done.request_type === 'pickup' ? 'Pickup created' : 'Request submitted'}
              </h2>
              <p className="text-sm text-slate-600">
                {done.message || 'Your request has been submitted. Our team will contact you shortly.'}
              </p>
              {done.ticket_id ? (
                <p className="text-xs text-slate-500">Ticket T-{done.ticket_id}</p>
              ) : null}
              {done.return_dc_number ? (
                <p className="text-xs text-slate-500">Return DC {done.return_dc_number}</p>
              ) : null}
              {done.request_id ? (
                <p className="text-xs text-slate-400">Reference #{done.request_id}</p>
              ) : null}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-6" noValidate>
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Ticket type *</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTicketType('complaint')}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      ticketType === 'complaint'
                        ? 'border-[#534AB7] bg-indigo-50 ring-2 ring-[#534AB7]/20'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Wrench className={`w-4 h-4 mb-1 ${ticketType === 'complaint' ? 'text-[#534AB7]' : 'text-slate-400'}`} />
                    <p className="text-sm font-semibold text-slate-900">Complaint</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Laptop issue / repair request</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTicketType('pickup')}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      ticketType === 'pickup'
                        ? 'border-[#534AB7] bg-indigo-50 ring-2 ring-[#534AB7]/20'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Package className={`w-4 h-4 mb-1 ${ticketType === 'pickup' ? 'text-[#534AB7]' : 'text-slate-400'}`} />
                    <p className="text-sm font-semibold text-slate-900">Pickup</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Collect one or more laptops</p>
                  </button>
                </div>
              </section>

              <section className="space-y-3.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact details</p>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Your name *</span>
                  <input
                    className={inputClass(fieldErrors.customer_name)}
                    value={form.customer_name}
                    onChange={(e) => set('customer_name', e.target.value)}
                    autoComplete="name"
                  />
                  <FieldError>{fieldErrors.customer_name}</FieldError>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Mobile number *</span>
                  <input
                    className={inputClass(fieldErrors.mobile_number)}
                    value={form.mobile_number}
                    onChange={(e) => set('mobile_number', formatIndianMobileInput(e.target.value))}
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="10-digit Indian mobile"
                    maxLength={10}
                  />
                  <FieldError>{fieldErrors.mobile_number}</FieldError>
                  {!fieldErrors.mobile_number ? (
                    <span className="mt-1 block text-xs text-slate-400">Enter 10 digits (e.g. 9876543210)</span>
                  ) : null}
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Company name</span>
                  <input
                    className={inputClass(false)}
                    value={form.company_name}
                    onChange={(e) => set('company_name', e.target.value)}
                    placeholder="Optional"
                    autoComplete="organization"
                  />
                </label>
              </section>

              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {isPickup ? 'Laptops for pickup' : 'Device'}
                </p>
                {isPickup ? (
                  <div>
                    <div className="flex gap-2">
                      <input
                        className={`${inputClass(fieldErrors.devices)} mt-0 font-mono uppercase`}
                        value={deviceDraft}
                        onChange={(e) => {
                          setDeviceDraft(e.target.value.toUpperCase());
                          if (fieldErrors.devices) setFieldErrors((prev) => ({ ...prev, devices: '' }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (!deviceBusy) addDevice(deviceDraft);
                          }
                        }}
                        placeholder="e.g. TTSPL1234"
                        disabled={deviceBusy}
                      />
                      <button
                        type="button"
                        onClick={() => addDevice(deviceDraft)}
                        disabled={deviceBusy}
                        className="inline-flex items-center gap-1 shrink-0 rounded-xl bg-[#534AB7] text-white px-3 py-2.5 text-sm font-semibold hover:bg-[#4539a0] disabled:opacity-50"
                      >
                        {deviceBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">Only laptops currently with a customer can be added</p>
                    <FieldError>{fieldErrors.devices}</FieldError>
                    {devices.length ? (
                      <ul className="mt-2 space-y-1.5">
                        {devices.map((code) => (
                          <li key={code} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <span className="font-mono text-sm font-semibold text-slate-800">{code}</span>
                            <button
                              type="button"
                              onClick={() => removeDevice(code)}
                              className="p-1 rounded-md text-slate-500 hover:bg-white hover:text-rose-600"
                              aria-label={`Remove ${code}`}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Device / TTSPL *</span>
                    <input
                      className={`${inputClass(fieldErrors.device_serial)} font-mono uppercase`}
                      value={form.device_serial}
                      onChange={(e) => set('device_serial', e.target.value.toUpperCase())}
                      onBlur={async () => {
                        const code = String(form.device_serial || '').trim();
                        if (!code) return;
                        const result = await validateTtspl(code);
                        if (!result.ok) {
                          setFieldErrors((prev) => ({ ...prev, device_serial: result.message }));
                          return;
                        }
                        set('device_serial', result.ttspl_id);
                      }}
                      placeholder="e.g. TTSPL1234"
                    />
                    <FieldError>{fieldErrors.device_serial}</FieldError>
                    {!fieldErrors.device_serial ? (
                      <span className="mt-1 block text-xs text-slate-400">Must match a laptop currently with a customer</span>
                    ) : null}
                  </label>
                )}
              </section>

              {isPickup ? (
                <section className="space-y-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Pickup location
                  </p>

                  <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[#534AB7]"
                      checked={form.mobile_is_poc}
                      onChange={(e) => set('mobile_is_poc', e.target.checked)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">This mobile number is the POC number</span>
                      <span className="block text-xs text-slate-500">Uncheck to enter a different person-of-contact mobile</span>
                    </span>
                  </label>

                  {!form.mobile_is_poc ? (
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600">POC mobile number *</span>
                      <input
                        className={inputClass(fieldErrors.poc_mobile)}
                        value={form.poc_mobile}
                        onChange={(e) => set('poc_mobile', formatIndianMobileInput(e.target.value))}
                        inputMode="numeric"
                        placeholder="10-digit POC mobile"
                        maxLength={10}
                      />
                      <FieldError>{fieldErrors.poc_mobile}</FieldError>
                    </label>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="block sm:col-span-1">
                      <span className="text-xs font-semibold text-slate-600">Pincode *</span>
                      <input
                        className={inputClass(fieldErrors.pincode)}
                        value={form.pincode}
                        onChange={(e) => onPincodeChange(e.target.value)}
                        inputMode="numeric"
                        placeholder="6 digits"
                        maxLength={6}
                      />
                      <FieldError>{fieldErrors.pincode}</FieldError>
                      {pinBusy ? <span className="mt-1 block text-xs text-indigo-600">Looking up city &amp; state…</span> : null}
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600">City *</span>
                      <input
                        className={inputClass(fieldErrors.city)}
                        value={form.city}
                        onChange={(e) => set('city', e.target.value)}
                        placeholder="Auto from pincode"
                      />
                      <FieldError>{fieldErrors.city}</FieldError>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600">State *</span>
                      <select
                        className={inputClass(fieldErrors.state)}
                        value={form.state}
                        onChange={(e) => set('state', e.target.value)}
                      >
                        <option value="">Select state</option>
                        {INDIAN_STATES.map((state) => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                        {form.state && !INDIAN_STATES.includes(form.state) ? (
                          <option value={form.state}>{form.state}</option>
                        ) : null}
                      </select>
                      <FieldError>{fieldErrors.state}</FieldError>
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Pickup address *</span>
                    <textarea
                      className={`${inputClass(fieldErrors.address)} min-h-[88px]`}
                      value={form.address}
                      onChange={(e) => set('address', e.target.value)}
                      placeholder="Building, street, landmark"
                    />
                    <FieldError>{fieldErrors.address}</FieldError>
                  </label>
                </section>
              ) : null}

              <section>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">
                    {isPickup ? 'Remarks' : 'Issue description *'}
                  </span>
                  <textarea
                    className={`${inputClass(fieldErrors.issue_description)} min-h-[110px]`}
                    value={form.issue_description}
                    onChange={(e) => set('issue_description', e.target.value)}
                    placeholder={isPickup ? 'Any extra note for the pickup team (optional)' : 'What is the problem?'}
                  />
                  <FieldError>{fieldErrors.issue_description}</FieldError>
                </label>
              </section>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#534AB7] hover:bg-[#4539a0] text-white text-sm font-semibold px-4 py-3 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {busy ? 'Submitting…' : isPickup ? 'Create pickup' : 'Submit request'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-4">No login required · Powered by Rentfoxxy</p>
      </div>
    </div>
  );
}
