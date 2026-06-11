import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Briefcase, CreditCard, RefreshCw, Store, Upload, User, X } from 'lucide-react';
import { createVendor, fetchVendor, updateVendor } from '../vendorManagementApi';
import { getBackendOrigin } from '../../../utils/api';

/** Laravel vendor-add.blade.php – Str::slug($state, '_') */
const INDIAN_STATE_NAMES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal'
];

const STATE_OPTIONS = INDIAN_STATE_NAMES.map((name) => ({
  label: name,
  value: name.toLowerCase().replace(/\s+/g, '_')
}));

const PROFILE_PLACEHOLDER =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 24 24" fill="#e2e8f0"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6" fill="#cbd5e1"/></svg>`
  );

const LICENSE_ACCEPT = '.jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.pdf,.doc,.docx,image/jpeg,image/png,image/gif,application/pdf';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Strong enough for Laravel min:8 parity */
function generateVendorPassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  let out = pick(upper) + pick(lower) + pick(digits);
  for (let i = out.length; i < length; i += 1) out += pick(all);
  /* shuffle-ish */
  return out
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
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
    brand_code: '',
    business_registration_number: '',
    tax_identification_number: '',
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

/**
 * Parity with Laravel `vendor-add.blade.php` (admin add vendor) inside a modal.
 * Edit mode retains CRM extras: status, optional password, logo/banner, explicit registration date.
 */
export default function VendorFormModal({ open, mode, vendorId, onClose, onSaved }) {
  const isEdit = mode === 'edit' && vendorId != null;

  const [form, setForm] = useState(() => emptyVendorForm());
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  /** When clearing profile file in edit, restore server image */
  const savedProfileUrlRef = useRef(PROFILE_PLACEHOLDER);
  /** Re-fetch vendor on “Reset” while editing */
  const [editNonce, setEditNonce] = useState(0);

  const [profilePreview, setProfilePreview] = useState(PROFILE_PLACEHOLDER);
  const [licensePreview, setLicensePreview] = useState(null);

  const title = useMemo(
    () => (isEdit ? `Edit vendor #${vendorId}` : 'Add new vendor'),
    [isEdit, vendorId]
  );

  const resetCreateForm = useCallback(() => {
    const pwd = generateVendorPassword();
    setForm(emptyVendorForm({ password: pwd }));
    setFiles({});
    setFieldErrors({});
    setProfilePreview(PROFILE_PLACEHOLDER);
    setLicensePreview(null);
  }, []);

  useEffect(() => {
    if (!open) {
      setFieldErrors({});
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

        let st = String(v.state || '').trim().toLowerCase().replace(/\s+/g, '_');
        if (!STATE_OPTIONS.some((o) => o.value === st)) {
          st = 'madhya_pradesh';
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
          bank_ifsc_code: v.bank_ifsc_code || '',
          account_holder_name: v.account_holder_name || '',
          gst_number: String(v.gst_number || ''),
          brand_code: v.brand_code || '',
          business_registration_number: v.business_registration_number || '',
          tax_identification_number: v.tax_identification_number || '',
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
        setFiles({});
        const profileSrc = v.image_url ? mediaUrl(v.image_url) : PROFILE_PLACEHOLDER;
        savedProfileUrlRef.current = profileSrc;
        setProfilePreview(profileSrc);
        setLicensePreview(null);
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
    return () => {
      cancelled = true;
    };
  }, [open, isEdit, vendorId, onClose, resetCreateForm, editNonce]);

  function onChange(field, val) {
    setForm((f) => ({ ...f, [field]: val }));
    setFieldErrors((er) => {
      const n = { ...er };
      delete n[field];
      return n;
    });
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

  function clientValidate(body) {
    const e = {};
    const rq = (k, msg) => {
      if (!String(body[k] ?? '').trim()) e[k] = msg || 'This field is required.';
    };

    rq('f_name', 'Name is required.');
    rq('business_name', 'Business name is required.');
    rq('number');
    rq('address');
    rq('email');
    rq('state', 'Please select a state.');
    rq('business_type');

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (body.email && !emailRe.test(String(body.email).trim())) {
      e.email = 'Enter a valid email address.';
    }
    if (!/^\d{10}$/.test(String(body.number || ''))) {
      e.number = 'Enter a valid 10-digit mobile number.';
    }

    rq('bank_name');
    rq('account_holder_name');
    rq('account_number');
    rq('bank_ifsc_code');

    if (!isEdit) {
      const p = String(body.password || '');
      if (!p || p.length < 8) e.password = 'Password must be at least 8 characters.';
    } else if (body.password && String(body.password).length > 0 && String(body.password).length < 8) {
      e.password = 'Password must be at least 8 characters when set.';
    }

    rq('registration_date', 'Registration date is required.');

    return e;
  }

  function handleEditReset() {
    setFiles({});
    setLicensePreview(null);
    setFieldErrors({});
    setEditNonce((n) => n + 1);
    toast.success('Form reloaded');
  }

  function handleRegeneratePassword() {
    const pwd = generateVendorPassword();
    onChange('password', pwd);
    toast.success('New password generated');
  }

  function handleReset() {
    if (isEdit) {
      handleEditReset();
      return;
    }
    resetCreateForm();
    toast.success('Form reset');
  }

  async function submit(e) {
    e.preventDefault();
    const submitBody = {
      ...form,
      status: !isEdit ? 'approved' : form.status,
      registration_date: !isEdit ? todayIsoDate() : form.registration_date,
      gst_number: String(form.gst_number || ''),
      /* CRM column last_name unused on Laravel vendor-add UI */
      l_name: ''
    };

    const vErr = clientValidate(submitBody);
    if (Object.keys(vErr).length) {
      setFieldErrors(vErr);
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setFieldErrors({});
    setSaving(true);

    try {
      const fd = new FormData();
      Object.entries(submitBody).forEach(([k, val]) => {
        if (isEdit && k === 'password' && !val) return;
        fd.append(k, val ?? '');
      });

      /* Hidden parity with Blade add form */
      if (!isEdit) {
        fd.set('registration_date', todayIsoDate());
        fd.set('status', 'approved');
      }

      if (files.image) fd.append('image', files.image);
      if (files.licenses) fd.append('licenses_and_permits', files.licenses);
      if (isEdit) {
        if (files.logo) fd.append('logo', files.logo);
        if (files.banner) fd.append('banner', files.banner);
      }

      if (isEdit) {
        const { data } = await updateVendor(vendorId, fd);
        if (!data.success) throw new Error(data.message);
        toast.success(data.message || 'Vendor updated successfully');
      } else {
        const { data } = await createVendor(fd);
        if (!data.success) throw new Error(data.message);
        toast.success(data.message || 'Vendor added successfully');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      const mapped = mapServerErrors(err);
      if (Object.keys(mapped).length) setFieldErrors(mapped);
      const joined = Array.isArray(err.response?.data?.errors)
        ? err.response.data.errors.map((x) => x.msg).join(', ')
        : err.response?.data?.message || err.message || 'Save failed';
      toast.error(joined);
    } finally {
      setSaving(false);
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

  function onLicensesFile(f) {
    setFiles((x) => ({ ...x, licenses: f || undefined }));
    if (!f) {
      setLicensePreview(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const fileType = f.type || '';
      if (fileType.includes('image')) {
        setLicensePreview({ kind: 'image', src: reader.result, name: f.name });
      } else if (fileType.includes('pdf') || fileType.includes('word') || /\.(pdf|doc|docx)$/i.test(f.name)) {
        setLicensePreview({
          kind: 'link',
          src: reader.result,
          name: f.name
        });
      } else {
        setLicensePreview({ kind: 'name', name: f.name });
      }
    };
    reader.readAsDataURL(f);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-slate-100 rounded-2xl shadow-xl w-full max-w-4xl max-h-[94vh] overflow-hidden flex flex-col"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-white shrink-0">
          <h2 id="vendor-modal-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Store className="w-5 h-5 text-orange-600" />
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading && isEdit ? (
          <div className="p-16 text-center text-slate-500 animate-pulse bg-white rounded-b-2xl">Loading vendor…</div>
        ) : (
          <form onSubmit={submit} className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
            {/* —— Vendor registration (Blade section 1) —— */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
                <User className="w-5 h-5 text-orange-600" />
                Vendor registration
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Name *"
                  placeholder="Enter vendor name"
                  value={form.f_name}
                  on={(v) => onChange('f_name', v.replace(/[^A-Za-z\s]/g, ''))}
                  error={fieldErrors.f_name}
                  required
                />
                <Input
                  label="Business name *"
                  placeholder="Enter vendor business name"
                  value={form.business_name}
                  on={(v) => onChange('business_name', v.replace(/[^A-Za-z\s]/g, ''))}
                  error={fieldErrors.business_name}
                  required
                />
                <Input
                  label="Mobile no. *"
                  placeholder="Enter vendor mobile no"
                  value={form.number}
                  on={(v) => onChange('number', v.replace(/\D/g, '').slice(0, 10))}
                  error={fieldErrors.number}
                  required
                  maxLength={10}
                  inputMode="numeric"
                />
                <Select
                  label="Select State *"
                  value={form.state}
                  on={(v) => onChange('state', v)}
                  error={fieldErrors.state}
                  required
                  hideCapitalizeLabel
                >
                  <option value="">Select a State</option>
                  {STATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Physical address *"
                  placeholder="Enter vendor physical address"
                  value={form.address}
                  on={(v) => onChange('address', v)}
                  error={fieldErrors.address}
                  required
                />
                <Input
                  label="Email address *"
                  type="email"
                  placeholder="Enter vendor email address"
                  value={form.email}
                  on={(v) => onChange('email', v)}
                  error={fieldErrors.email}
                  required
                />
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Password {!isEdit && '*'}</label>
                  {!isEdit ? (
                    <div className="flex gap-2">
                      <input
                        readOnly
                        className={`flex-1 border rounded-lg px-3 py-2 text-sm font-mono bg-slate-50 ${
                          fieldErrors.password ? 'border-red-400' : 'border-slate-200'
                        }`}
                        value={form.password}
                        required
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={handleRegeneratePassword}
                        title="Generate new password"
                        className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-semibold"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Regenerate
                      </button>
                    </div>
                  ) : (
                    <input
                      type="password"
                      placeholder="Leave blank to keep current password"
                      className={`w-full border rounded-lg px-3 py-2 text-sm ${fieldErrors.password ? 'border-red-400' : 'border-slate-200'}`}
                      value={form.password}
                      onChange={(e) => onChange('password', e.target.value)}
                      autoComplete="new-password"
                    />
                  )}
                  {fieldErrors.password && <p className="text-xs text-red-600 mt-0.5">{fieldErrors.password}</p>}
                  <p className="text-[11px] text-slate-500 mt-1">
                    {isEdit ? 'Minimum 8 characters when changing.' : 'Auto-generated (readonly), like Laravel admin add.'}
                  </p>
                </div>
              </div>
            </section>

            {/* —— Business information —— */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
                <Briefcase className="w-5 h-5 text-orange-600" />
                Business information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Business type *"
                  placeholder="Enter vendor business type"
                  value={form.business_type}
                  on={(v) => onChange('business_type', v)}
                  error={fieldErrors.business_type}
                  required
                  className="md:col-span-1"
                />
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">GST number</label>
                  <input
                    className={`w-full border rounded-lg px-3 py-2 text-sm uppercase ${
                      fieldErrors.gst_number ? 'border-red-400' : 'border-slate-200'
                    }`}
                    value={form.gst_number}
                    onChange={(ev) =>
                      onChange('gst_number', ev.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
                    }
                    placeholder="Enter GST number"
                  />
                  {fieldErrors.gst_number && <p className="text-xs text-red-600 mt-0.5">{fieldErrors.gst_number}</p>}
                </div>
                {/* Blade: registration_date hidden = today */}
                {!isEdit ? (
                  <div className="text-sm text-slate-600 pt-7">
                    Registration date:&nbsp;
                    <span className="font-semibold text-slate-900">{todayIsoDate()}</span>
                  </div>
                ) : (
                  <Input
                    label="Registration date *"
                    type="date"
                    value={form.registration_date}
                    on={(v) => onChange('registration_date', v)}
                    error={fieldErrors.registration_date}
                    required
                  />
                )}
                <Input
                  label="Business brand code"
                  placeholder="Business brand code"
                  value={form.brand_code}
                  on={(v) => onChange('brand_code', v)}
                  error={fieldErrors.brand_code}
                />
                <Input
                  label="Business registration number"
                  placeholder="Business registration number"
                  value={form.business_registration_number}
                  on={(v) => onChange('business_registration_number', v)}
                  error={fieldErrors.business_registration_number}
                  className="md:col-span-3 lg:col-span-1"
                />
                <Input
                  label="Tax identification number"
                  placeholder="Tax identification number"
                  value={form.tax_identification_number}
                  on={(v) => onChange('tax_identification_number', v)}
                  error={fieldErrors.tax_identification_number}
                  className="md:col-span-3 lg:col-span-1"
                />
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Business licenses and permits
                </label>
                <input
                  type="file"
                  accept={LICENSE_ACCEPT}
                  onChange={(ev) => onLicensesFile(ev.target.files?.[0] || null)}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-orange-50 file:text-orange-800 file:font-semibold"
                />
                {licensePreview && (
                  <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    {licensePreview.kind === 'image' && (
                      <img alt="License preview" className="max-h-40 rounded" src={licensePreview.src} />
                    )}
                    {licensePreview.kind === 'link' && (
                      <a
                        href={licensePreview.src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-orange-600 font-semibold hover:underline"
                      >
                        Preview file ({licensePreview.name})
                      </a>
                    )}
                    {licensePreview.kind === 'name' && (
                      <p className="text-sm text-slate-700">{licensePreview.name}</p>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3 mb-4">
                Contact &amp; PO settings
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input label="PAN number" value={form.pan_number} on={(v) => onChange('pan_number', v)} />
                <Input label="MSME number" value={form.msme_number} on={(v) => onChange('msme_number', v)} />
                <Input label="City" value={form.city} on={(v) => onChange('city', v)} />
                <Input label="Pincode" value={form.pincode} on={(v) => onChange('pincode', v.replace(/\D/g, '').slice(0, 10))} />
                <Input label="Contact person" value={form.contact_person_name} on={(v) => onChange('contact_person_name', v)} />
                <Input label="Contact phone" value={form.contact_person_phone} on={(v) => onChange('contact_person_phone', v)} />
                <Input label="Alternate phone" value={form.alternate_phone} on={(v) => onChange('alternate_phone', v)} />
                <Select label="PO payment terms" value={form.po_payment_terms} on={(v) => onChange('po_payment_terms', v)}>
                  <option value="postpaid_monthly">Postpaid monthly</option>
                  <option value="net30">Net 30</option>
                  <option value="net15">Net 15</option>
                  <option value="advance">Advance</option>
                </Select>
                <Input label="Credit days" type="number" value={form.credit_days} on={(v) => onChange('credit_days', v)} />
                <Input label="Notes" value={form.notes} on={(v) => onChange('notes', v)} className="md:col-span-3" />
              </div>
            </section>

            {/* —— Bank details —— */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
                <CreditCard className="w-5 h-5 text-orange-600" />
                Bank details
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Bank name *"
                  placeholder="Bank name"
                  value={form.bank_name}
                  on={(v) => onChange('bank_name', v.replace(/[^a-zA-Z\s]/g, ''))}
                  error={fieldErrors.bank_name}
                  required
                />
                <Input
                  label="Bank account holder name *"
                  placeholder="Bank account holder name"
                  value={form.account_holder_name}
                  on={(v) => onChange('account_holder_name', v)}
                  error={fieldErrors.account_holder_name}
                  required
                />
                <Input
                  label="Bank account number *"
                  placeholder="Bank account number"
                  value={form.account_number}
                  on={(v) => onChange('account_number', v.replace(/\D/g, ''))}
                  error={fieldErrors.account_number}
                  required
                  inputMode="numeric"
                />
                <Input
                  label="Bank IFSC code *"
                  placeholder="Bank IFSC code"
                  value={form.bank_ifsc_code}
                  on={(v) => onChange('bank_ifsc_code', v)}
                  error={fieldErrors.bank_ifsc_code}
                  required
                />
              </div>
            </section>

            {/* —— Profile (Blade ratio 1:1) —— */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
                <Upload className="w-5 h-5 text-orange-600" />
                Profile
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <img
                    className="mx-auto w-36 h-36 object-cover rounded-lg border border-slate-200 shadow-sm"
                    src={profilePreview || PROFILE_PLACEHOLDER}
                    alt="Profile preview"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = PROFILE_PLACEHOLDER;
                    }}
                  />
                  <label className="mt-4 block">
                    <span className="text-xs font-semibold text-slate-700 flex gap-2 items-center">
                      Profile{' '}
                      <span className="text-[11px] font-normal text-sky-600">
                        ({isEdit ? 'Optional — replaces current' : 'Optional'})
                      </span>{' '}
                      <span className="text-[11px] text-sky-600">ratio 1:1</span>
                    </span>
                    <input
                      type="file"
                      accept=".jpg,.png,.jpeg,.gif,.bmp,.tif,.tiff,image/jpeg,image/png,image/gif"
                      className="mt-2 block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-orange-50 file:text-orange-800 file:font-semibold"
                      onChange={(ev) => onProfileFile(ev.target.files?.[0] || null)}
                    />
                  </label>
                </div>

                {/* CRM edit: shop images not on Laravel add page */}
                {isEdit && (
                  <div className="space-y-4 border border-dashed border-slate-200 rounded-xl p-4 bg-slate-50/80">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Shop (CRM only — Laravel add form did not collect these)
                    </p>
                    <FileMini
                      label="Shop logo"
                      hint="Leave empty to keep current"
                      on={(f) => setFiles((x) => ({ ...x, logo: f || undefined }))}
                      accept=".jpg,.png,.jpeg,.gif,.bmp,.tif,.tiff,image/*"
                    />
                    <FileMini
                      label="Shop banner"
                      hint="Leave empty to keep current"
                      on={(f) => setFiles((x) => ({ ...x, banner: f || undefined }))}
                      accept=".jpg,.png,.jpeg,.gif,.bmp,.tif,.tiff,image/*"
                    />
                  </div>
                )}
              </div>
            </section>

            {isEdit && (
              <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">Admin — status</h3>
                <Select label="Vendor status *" value={form.status} on={(v) => onChange('status', v)} error={fieldErrors.status}>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="suspended">Suspended</option>
                </Select>
              </section>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-8 py-2.5 rounded-lg bg-orange-600 text-white text-sm font-bold hover:bg-orange-700 disabled:opacity-60 shadow-sm"
              >
                {saving ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Input({ label, value, on, type = 'text', required, error, maxLength, inputMode, placeholder, className = '' }) {
  return (
    <div className={className}>
      <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
      <input
        required={required}
        type={type}
        maxLength={maxLength}
        inputMode={inputMode}
        placeholder={placeholder}
        className={`w-full border rounded-lg px-3 py-2 text-sm ${error ? 'border-red-400' : 'border-slate-200'}`}
        value={value}
        onChange={(e) => on(e.target.value)}
      />
      {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
    </div>
  );
}

function Select({ label, value, on, children, error, required, hideCapitalizeLabel }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
      <select
        required={required}
        className={`w-full border rounded-lg px-3 py-2 text-sm ${hideCapitalizeLabel ? '' : 'capitalize'} ${
          error ? 'border-red-400' : 'border-slate-200'
        }`}
        value={value}
        onChange={(e) => on(e.target.value)}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
    </div>
  );
}

function FileMini({ label, hint, accept, on }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600">{label}</label>
      <input type="file" accept={accept} onChange={(e) => on(e.target.files?.[0])} className="mt-1 block w-full text-xs" />
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
