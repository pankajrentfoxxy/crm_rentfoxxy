import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import {
  createVendor,
  fetchVendor,
  updateVendor,
  updateVendorPortalAccess
} from '../vendorManagementApi';
import { getBackendOrigin } from '../../../utils/api';
import { INDIAN_STATE_OPTIONS, matchIndianState, slugifyState } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';
import { GSTIN_RE, IFSC_RE } from '../vendorMgmtUi';

const STATE_OPTIONS = INDIAN_STATE_OPTIONS;

const BUSINESS_TYPES = ['Proprietorship', 'Partnership', 'Pvt Ltd', 'LLP', 'Other'];

const PROFILE_PLACEHOLDER =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="#e5e7eb"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6" fill="#d1d5db"/></svg>`
  );

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function generateVendorPassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  let out = pick(upper) + pick(lower) + pick(digits);
  for (let i = out.length; i < length; i += 1) out += pick(all);
  return out.split('').sort(() => Math.random() - 0.5).join('');
}

function mediaUrl(rel) {
  if (!rel) return '';
  if (rel.startsWith('http') || rel.startsWith('data:')) return rel;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}${rel.startsWith('/') ? rel : `/${rel}`}`;
}

function emptyVendorForm({ password } = {}) {
  return {
    status: 'approved',
    f_name: '',
    business_name: '',
    email: '',
    password: password || generateVendorPassword(),
    number: '',
    address: '',
    business_type: '',
    registration_date: todayIsoDate(),
    state: 'madhya_pradesh',
    bank_name: '',
    account_number: '',
    bank_ifsc_code: '',
    account_holder_name: '',
    gst_number: '',
    pan_number: '',
    msme_number: '',
    city: '',
    pincode: '',
    contact_person_name: '',
    contact_person_phone: '',
    alternate_phone: '',
    po_payment_terms: 'postpaid_monthly',
    credit_days: '1',
    notes: '',
    from_submit: 'admin'
  };
}

function SectionCard({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, required, error, helper, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600 block mb-1">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null}
      {helper && !error ? <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{helper}</p> : null}
    </div>
  );
}

function TextInput({ label, value, onChange, onBlur, error, required, type = 'text', ...rest }) {
  return (
    <Field label={label} required={required} error={error}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`w-full h-9 px-3 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
          error ? 'border-red-400' : 'border-gray-200'
        }`}
        {...rest}
      />
    </Field>
  );
}

function TextArea({ label, value, onChange, onBlur, error, required, rows = 2 }) {
  return (
    <Field label={label} required={required} error={error}>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
          error ? 'border-red-400' : 'border-gray-200'
        }`}
      />
    </Field>
  );
}

export default function VendorFormModal({ open, mode, vendorId, onClose, onSaved }) {
  const isEdit = mode === 'edit' && vendorId != null;

  const [form, setForm] = useState(() => emptyVendorForm());
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [portalEnabled, setPortalEnabled] = useState(true);
  const [portalLastLogin, setPortalLastLogin] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);

  const savedProfileUrlRef = useRef(PROFILE_PLACEHOLDER);
  const [profilePreview, setProfilePreview] = useState(PROFILE_PLACEHOLDER);

  const title = useMemo(() => (isEdit ? 'Edit Vendor' : 'Add Vendor'), [isEdit]);

  const resetCreateForm = useCallback(() => {
    setForm(emptyVendorForm({ password: generateVendorPassword() }));
    setFiles({});
    setFieldErrors({});
    setTouched({});
    setProfilePreview(PROFILE_PLACEHOLDER);
  }, []);

  useEffect(() => {
    if (!open) {
      setFieldErrors({});
      setTouched({});
      return;
    }
    if (!isEdit) {
      resetCreateForm();
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      setFieldErrors({});
      try {
        const { data } = await fetchVendor(vendorId);
        const v = data.data;
        if (!data.success || !v) throw new Error('Not found');
        if (cancelled) return;

        let st = slugifyState(v.state || '');
        if (!STATE_OPTIONS.some((o) => o.value === st)) {
          const matched = matchIndianState(v.state);
          st = matched ? slugifyState(matched) : st;
        }

        setForm({
          status: v.status || 'approved',
          f_name: v.f_name || '',
          business_name: v.business_name || '',
          email: v.email || '',
          password: '',
          number: String(v.phone || '').replace(/\D/g, '').slice(0, 10),
          address: v.address || '',
          business_type: v.business_type || '',
          registration_date: v.registration_date?.slice?.(0, 10) || todayIsoDate(),
          state: st,
          bank_name: v.bank_name || '',
          account_number: String(v.account_number || '').replace(/\D/g, ''),
          bank_ifsc_code: (v.bank_ifsc_code || '').toUpperCase(),
          account_holder_name: v.account_holder_name || '',
          gst_number: String(v.gst_number || '').toUpperCase(),
          pan_number: v.pan_number || '',
          msme_number: v.msme_number || '',
          city: v.city || '',
          pincode: v.pincode || '',
          contact_person_name: v.contact_person_name || '',
          contact_person_phone: v.contact_person_phone || '',
          alternate_phone: v.alternate_phone || '',
          po_payment_terms: v.po_payment_terms || 'postpaid_monthly',
          credit_days: String(v.credit_days ?? '1'),
          notes: v.notes || '',
          from_submit: 'admin'
        });
        setPortalEnabled(v.vendor_portal_enabled !== false);
        setPortalLastLogin(v.vendor_portal_last_login || null);
        setFiles({});
        const profileSrc = v.image_url ? mediaUrl(v.image_url) : PROFILE_PLACEHOLDER;
        savedProfileUrlRef.current = profileSrc;
        setProfilePreview(profileSrc);
      } catch (e) {
        if (!cancelled) {
          toast.error(e.response?.data?.message || e.message || 'Unable to load vendor');
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open, isEdit, vendorId, onClose, resetCreateForm]);

  function onChange(field, val) {
    setForm((f) => ({ ...f, [field]: val }));
    setFieldErrors((er) => {
      const n = { ...er };
      delete n[field];
      return n;
    });
  }

  function touch(field) {
    setTouched((t) => ({ ...t, [field]: true }));
    validateField(field, form);
  }

  function validateField(field, body = form) {
    const e = {};
    const rq = (k, msg) => {
      if (!String(body[k] ?? '').trim()) e[k] = msg || 'Required';
    };

    if (field === 'business_name') rq('business_name');
    if (field === 'gst_number') {
      const g = String(body.gst_number || '').trim().toUpperCase();
      if (!g) e.gst_number = 'GSTIN is required';
      else if (!GSTIN_RE.test(g)) e.gst_number = 'Enter a valid 15-character GSTIN';
    }
    if (field === 'state') rq('state', 'Select a state');
    if (field === 'address') rq('address');
    if (field === 'email') {
      rq('email');
      if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) e.email = 'Invalid email';
    }
    if (field === 'number') {
      if (!/^\d{10}$/.test(String(body.number || ''))) e.number = 'Enter a valid 10-digit phone';
    }
    if (field === 'bank_ifsc_code') {
      const ifsc = String(body.bank_ifsc_code || '').trim().toUpperCase();
      if (!ifsc) e.bank_ifsc_code = 'IFSC is required';
      else if (!IFSC_RE.test(ifsc)) e.bank_ifsc_code = 'IFSC must be 11 characters (e.g. SBIN0001234)';
    }
    if (['bank_name', 'account_number', 'account_holder_name'].includes(field)) rq(field);

    if (Object.keys(e).length) {
      setFieldErrors((prev) => ({ ...prev, ...e }));
    }
    return e;
  }

  function clientValidate(body) {
    const e = {};
    const rq = (k, msg) => {
      if (!String(body[k] ?? '').trim()) e[k] = msg || 'Required';
    };

    rq('business_name');
    rq('address');
    rq('email');
    rq('state', 'Select a state');
    rq('bank_name');
    rq('account_holder_name');
    rq('account_number');
    rq('bank_ifsc_code');

    const g = String(body.gst_number || '').trim().toUpperCase();
    if (!g) e.gst_number = 'GSTIN is required';
    else if (!GSTIN_RE.test(g)) e.gst_number = 'Enter a valid 15-character GSTIN';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email || '').trim())) e.email = 'Invalid email';
    if (!/^\d{10}$/.test(String(body.number || ''))) e.number = 'Enter a valid 10-digit phone';

    const ifsc = String(body.bank_ifsc_code || '').trim().toUpperCase();
    if (!IFSC_RE.test(ifsc)) e.bank_ifsc_code = 'IFSC must be 11 characters';

    if (!isEdit) {
      const p = String(body.password || '');
      if (p.length < 8) e.password = 'Password must be at least 8 characters';
    }

    return e;
  }

  function mapServerErrors(err) {
    const list = err.response?.data?.errors;
    if (!Array.isArray(list)) return {};
    const out = {};
    list.forEach((item) => {
      let p = item.param || item.path;
      if (typeof p === 'string' && p.startsWith('body.')) p = p.slice(5);
      if (p) out[p] = item.msg;
    });
    return out;
  }

  async function submit(e) {
    e.preventDefault();
    const submitBody = {
      ...form,
      f_name: form.contact_person_name?.trim() || form.business_name?.trim() || form.f_name,
      status: !isEdit ? 'approved' : form.status,
      registration_date: !isEdit ? todayIsoDate() : form.registration_date,
      gst_number: String(form.gst_number || '').toUpperCase(),
      bank_ifsc_code: String(form.bank_ifsc_code || '').toUpperCase(),
      l_name: ''
    };

    const vErr = clientValidate(submitBody);
    if (Object.keys(vErr).length) {
      setFieldErrors(vErr);
      toast.error('Please fix the highlighted fields.');
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(submitBody).forEach(([k, val]) => {
        if (isEdit && k === 'password' && !val) return;
        fd.append(k, val ?? '');
      });
      if (!isEdit) {
        fd.set('registration_date', todayIsoDate());
        fd.set('status', 'approved');
      }
      if (files.image) fd.append('image', files.image);
      if (files.licenses) fd.append('licenses_and_permits', files.licenses);
      if (files.gst_cert) fd.append('gst_certificate', files.gst_cert);

      if (isEdit) {
        const { data } = await updateVendor(vendorId, fd);
        if (!data.success) throw new Error(data.message);
        toast.success(data.message || 'Vendor updated');
      } else {
        const { data } = await createVendor(fd);
        if (!data.success) throw new Error(data.message);
        toast.success(data.message || 'Vendor added');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      const mapped = mapServerErrors(err);
      if (Object.keys(mapped).length) setFieldErrors(mapped);
      toast.error(err.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function togglePortal() {
    if (!isEdit) return;
    setPortalBusy(true);
    try {
      const { data } = await updateVendorPortalAccess(vendorId, { portal_enabled: !portalEnabled });
      if (!data.success) throw new Error(data.message);
      setPortalEnabled(!portalEnabled);
      toast.success('Portal access updated');
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Update failed');
    } finally {
      setPortalBusy(false);
    }
  }

  async function resetPortalPassword() {
    if (!isEdit) return;
    setPortalBusy(true);
    try {
      const { data } = await updateVendorPortalAccess(vendorId, { reset_password: true });
      if (!data.success) throw new Error(data.message);
      if (data.new_password) {
        await navigator.clipboard.writeText(data.new_password);
        toast.success('New password copied to clipboard');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Reset failed');
    } finally {
      setPortalBusy(false);
    }
  }

  function onProfileFile(f) {
    setFiles((x) => {
      const next = { ...x };
      if (!f) delete next.image;
      else next.image = f;
      return next;
    });
    if (!f) {
      setProfilePreview(savedProfileUrlRef.current);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setProfilePreview(ev.target?.result || PROFILE_PLACEHOLDER);
    reader.readAsDataURL(f);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close drawer"
        onClick={onClose}
      />
      <div className="relative w-full max-w-full sm:max-w-[560px] h-full bg-gray-50 shadow-2xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-white shrink-0">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading && isEdit ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 animate-pulse">Loading…</div>
        ) : (
          <form onSubmit={submit} className="flex-1 overflow-y-auto p-4 space-y-4">
            <SectionCard title="Business Details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextInput
                  label="Business Name"
                  required
                  value={form.business_name}
                  onChange={(v) => onChange('business_name', v)}
                  onBlur={() => touch('business_name')}
                  error={touched.business_name ? fieldErrors.business_name : undefined}
                />
                <Field label="Business Type">
                  <select
                    className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                    value={form.business_type}
                    onChange={(e) => onChange('business_type', e.target.value)}
                  >
                    <option value="">Select type</option>
                    {BUSINESS_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <TextInput
                  label="GSTIN"
                  required
                  value={form.gst_number}
                  onChange={(v) => onChange('gst_number', v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 15))}
                  onBlur={() => touch('gst_number')}
                  error={touched.gst_number ? fieldErrors.gst_number : undefined}
                  className="font-mono"
                />
                <TextInput label="PAN Number" value={form.pan_number} onChange={(v) => onChange('pan_number', v)} />
                <TextInput label="MSME Number" value={form.msme_number} onChange={(v) => onChange('msme_number', v)} />
                <Field label="State" required error={touched.state ? fieldErrors.state : undefined}>
                  <select
                    required
                    className={`w-full h-9 px-3 border rounded-lg text-sm bg-white ${fieldErrors.state && touched.state ? 'border-red-400' : 'border-gray-200'}`}
                    value={form.state}
                    onChange={(e) => onChange('state', e.target.value)}
                    onBlur={() => touch('state')}
                  >
                    <option value="">Select state</option>
                    {STATE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </Field>
                <TextInput label="City" value={form.city} onChange={(v) => onChange('city', v)} />
                <TextInput
                  label="Pincode"
                  value={form.pincode}
                  onChange={(v) => applyPincodeAutofill(v, setForm, {
                    pinKey: 'pincode', cityKey: 'city', stateKey: 'state', useStateSlug: true,
                  })}
                  onBlur={() => applyPincodeAutofill(form.pincode, setForm, {
                    pinKey: 'pincode', cityKey: 'city', stateKey: 'state', useStateSlug: true,
                  })}
                />
              </div>
              <TextArea
                label="Address"
                required
                value={form.address}
                onChange={(v) => onChange('address', v)}
                onBlur={() => touch('address')}
                error={touched.address ? fieldErrors.address : undefined}
              />
            </SectionCard>

            <SectionCard title="Contact Details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextInput
                  label="Primary Email"
                  required
                  type="email"
                  value={form.email}
                  onChange={(v) => onChange('email', v)}
                  onBlur={() => touch('email')}
                  error={touched.email ? fieldErrors.email : undefined}
                />
                <TextInput
                  label="Primary Phone"
                  required
                  value={form.number}
                  onChange={(v) => onChange('number', v.replace(/\D/g, '').slice(0, 10))}
                  onBlur={() => touch('number')}
                  error={touched.number ? fieldErrors.number : undefined}
                  inputMode="numeric"
                />
                <TextInput
                  label="Contact Person Name"
                  value={form.contact_person_name}
                  onChange={(v) => onChange('contact_person_name', v)}
                />
                <TextInput
                  label="Contact Person Phone"
                  value={form.contact_person_phone}
                  onChange={(v) => onChange('contact_person_phone', v.replace(/\D/g, '').slice(0, 10))}
                />
                <TextInput
                  label="Alternate Phone"
                  value={form.alternate_phone}
                  onChange={(v) => onChange('alternate_phone', v)}
                />
              </div>
            </SectionCard>

            <SectionCard title="PO & Payment Settings">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="PO Payment Terms"
                  required
                  helper="Postpaid Monthly = bill generated on last day of month, paid on 1st of next month. Net 30/15 = paid within days of invoice."
                >
                  <select
                    className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                    value={form.po_payment_terms}
                    onChange={(e) => onChange('po_payment_terms', e.target.value)}
                  >
                    <option value="postpaid_monthly">Postpaid Monthly</option>
                    <option value="net30">Net 30</option>
                    <option value="net15">Net 15</option>
                    <option value="advance">Advance</option>
                  </select>
                </Field>
                <Field label="Credit Days" helper="Grace period in days before payment is considered overdue.">
                  <input
                    type="number"
                    min={0}
                    className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm"
                    value={form.credit_days}
                    onChange={(e) => onChange('credit_days', e.target.value)}
                  />
                </Field>
              </div>
              <TextArea label="Notes" value={form.notes} onChange={(v) => onChange('notes', v)} rows={3} />
            </SectionCard>

            <SectionCard title="Bank Details">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextInput
                  label="Bank Name"
                  required
                  value={form.bank_name}
                  onChange={(v) => onChange('bank_name', v)}
                  onBlur={() => touch('bank_name')}
                  error={touched.bank_name ? fieldErrors.bank_name : undefined}
                />
                <TextInput
                  label="Account Number"
                  required
                  value={form.account_number}
                  onChange={(v) => onChange('account_number', v.replace(/\D/g, ''))}
                  onBlur={() => touch('account_number')}
                  error={touched.account_number ? fieldErrors.account_number : undefined}
                />
                <TextInput
                  label="IFSC Code"
                  required
                  value={form.bank_ifsc_code}
                  onChange={(v) => onChange('bank_ifsc_code', v.toUpperCase().slice(0, 11))}
                  onBlur={() => touch('bank_ifsc_code')}
                  error={touched.bank_ifsc_code ? fieldErrors.bank_ifsc_code : undefined}
                  className="font-mono"
                />
                <TextInput
                  label="Account Holder Name"
                  required
                  value={form.account_holder_name}
                  onChange={(v) => onChange('account_holder_name', v)}
                  onBlur={() => touch('account_holder_name')}
                  error={touched.account_holder_name ? fieldErrors.account_holder_name : undefined}
                />
              </div>
            </SectionCard>

            <SectionCard title="Documents & Logo">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <img
                    src={profilePreview}
                    alt="Logo preview"
                    className="w-24 h-24 rounded-lg border border-gray-200 object-cover bg-gray-50"
                    onError={(e) => { e.currentTarget.src = PROFILE_PLACEHOLDER; }}
                  />
                  <div className="flex-1 space-y-3 w-full">
                    <Field label="Logo">
                      <input
                        type="file"
                        accept="image/*"
                        className="w-full text-sm text-gray-600 file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium"
                        onChange={(e) => onProfileFile(e.target.files?.[0] || null)}
                      />
                    </Field>
                    <Field label="GST Certificate">
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        className="w-full text-sm text-gray-600 file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium"
                        onChange={(e) => setFiles((x) => ({ ...x, gst_cert: e.target.files?.[0] || undefined }))}
                      />
                    </Field>
                    <Field label="Business License">
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,image/*"
                        className="w-full text-sm text-gray-600 file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium"
                        onChange={(e) => setFiles((x) => ({ ...x, licenses: e.target.files?.[0] || undefined }))}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </SectionCard>

            {isEdit ? (
              <SectionCard title="Portal Access">
                <div className="space-y-3 text-sm">
                  <label className="inline-flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={portalEnabled}
                      disabled={portalBusy}
                      onChange={togglePortal}
                      className="rounded border-gray-300 text-blue-600 w-4 h-4"
                    />
                    <span className="text-gray-800 font-medium">
                      {portalEnabled ? 'Portal enabled' : 'Portal disabled'}
                    </span>
                  </label>
                  <p className="text-xs text-gray-500">
                    Last login:{' '}
                    {portalLastLogin ? new Date(portalLastLogin).toLocaleString() : 'Never logged in'}
                  </p>
                  <button
                    type="button"
                    disabled={portalBusy}
                    onClick={resetPortalPassword}
                    className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    Reset password
                  </button>
                </div>
              </SectionCard>
            ) : null}

            {!isEdit ? (
              <input type="hidden" value={form.password} readOnly />
            ) : null}
          </form>
        )}

        <div className="sticky bottom-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 bg-white shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || loading}
            onClick={submit}
            className="h-9 px-6 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
