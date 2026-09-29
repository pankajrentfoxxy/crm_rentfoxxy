import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, X } from 'lucide-react';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, EmptyState, Field, FormGrid, Input, Notice, Section, Select, Textarea,
} from '../../../components/carret';
import { INDIAN_STATES, INDIAN_STATE_OPTIONS } from '../../../constants/indianStates';
import {
  createVendor, fetchVendor, updateVendor, updateVendorPortalAccess,
} from '../../vendor-management/vendorManagementApi';
import {
  VENDOR_STATUSES, emptyVendorForm, errMsg, fileUrl, newPassword, phoneError, vendorFormData, vendorFormErrors, vendorFormFromRow, vendorName,
} from './procureShared';

/**
 * Procure → Vendors → add / edit.
 *
 * A new vendor starts as PENDING: it cannot take a purchase order until
 * someone approves it on the vendor record. The GST certificate now saves (the
 * old form sent it and the server dropped it), and GSTIN / PAN / IFSC are
 * checked on both sides — but only when entered or changed, because most
 * imported vendors carry a placeholder IFSC that must not block a phone-number
 * edit.
 *
 * People who cannot see bank details see them as hidden here too, and saving
 * keeps what is stored.
 */
const BUSINESS_TYPES = ['Proprietorship', 'Partnership', 'Pvt Ltd', 'LLP', 'Other'];
const PAYMENT_TERMS = [
  { value: 'postpaid_monthly', label: 'Monthly, after the month' },
  { value: 'net15', label: 'Net 15 days' },
  { value: 'net30', label: 'Net 30 days' },
  { value: 'advance', label: 'Advance' },
];

export default function VendorFormPage() {
  const { vendorId } = useParams();
  const isEdit = Boolean(vendorId);
  const navigate = useNavigate();

  const [form, setForm] = useState(emptyVendorForm);
  const [original, setOriginal] = useState(null);
  const [files, setFiles] = useState({});
  const [errors, setErrors] = useState({});
  const [invite, setInvite] = useState(true);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    fetchVendor(vendorId)
      .then(({ data }) => { setOriginal(data.data); setForm(vendorFormFromRow(data.data)); setLoading(false); })
      .catch((e) => { setLoadError(errMsg(e, 'Could not load the vendor.')); setLoading(false); });
  }, [isEdit, vendorId]);

  const bankHidden = String(original?.account_number || '').toLowerCase() === 'hidden';
  const set = (k) => (e) => {
    const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => { const n = { ...er }; delete n[k]; return n; });
  };
  const pick = (k) => (file) => setFiles((f) => ({ ...f, [k]: file || null }));
  // Phone fields take digits only, at most 10 — typing or pasting anything
  // else is dropped instead of being accepted and failing on save.
  const setDigits = (k) => (e) => set(k)(String(e.target.value || '').replace(/\D/g, '').slice(0, 10));
  // Checked as soon as the field is left, not only on Save.
  const checkPhone = (k, required) => () => {
    const msg = phoneError(form[k], { required });
    setErrors((er) => { const n = { ...er }; if (msg) n[k] = msg; else delete n[k]; return n; });
  };
  const phoneProps = (k, required = false) => ({
    inputMode: 'numeric', maxLength: 10, minLength: 10, onChange: setDigits(k), onBlur: checkPhone(k, required), placeholder: '10-digit mobile',
  });
  const phoneHint = (k) => {
    const n = String(form[k] || '').length;
    return n > 0 && n < 10 ? `${n} of 10 digits` : undefined;
  };
  const field = (k, label, props = {}, extra = {}) => (
    <Field label={label} error={errors[k]} required={extra.required} hint={extra.hint} span={extra.span}>
      <Input value={form[k] ?? ''} onChange={set(k)} {...props} />
    </Field>
  );

  const stateOptions = useMemo(() => INDIAN_STATE_OPTIONS.map((o) => ({ value: o.value, label: o.label })), []);

  const save = async (e) => {
    e.preventDefault();
    const found = vendorFormErrors(form, { isEdit, original: original && vendorFormFromRow(original) });
    if (Object.keys(found).length) {
      setErrors(found);
      toast.error('Some fields need fixing — they are marked in red.');
      return;
    }
    setSaving(true);
    try {
      const fd = vendorFormData(form, files);
      if (isEdit) {
        await updateVendor(vendorId, fd);
        toast.success('Vendor saved');
        navigate(`/carret/procure/vendors/${vendorId}`);
      } else {
        const { data } = await createVendor(fd);
        const id = data?.data?.vendor_id;
        if (invite && id) {
          try {
            const { data: p } = await updateVendorPortalAccess(id, { portal_enabled: true, reset_password: true, send_invite: true });
            toast[p?.invite_sent ? 'success' : 'error'](p?.invite_sent ? 'Vendor added and portal login emailed' : 'Vendor added, but the login email did not go — send it from the vendor record');
          } catch {
            toast.error('Vendor added, but the login email did not go — send it from the vendor record');
          }
        } else {
          toast.success('Vendor added');
        }
        navigate(id ? `/carret/procure/vendors/${id}` : '/carret/procure/vendors');
      }
    } catch (err) {
      const list = err?.response?.data?.errors;
      if (Array.isArray(list)) {
        const mapped = {};
        list.forEach((it) => { const p = String(it.path || it.param || '').replace(/^body\./, ''); if (p) mapped[p === 'f_name' ? 'contact_person_name' : p] = it.msg; });
        setErrors((er) => ({ ...er, ...mapped }));
      }
      toast.error(errMsg(err, 'Could not save the vendor.'));
    } finally {
      setSaving(false);
    }
  };

  const title = isEdit ? `Edit ${original ? vendorName(original) : 'vendor'}` : 'Add vendor';
  const back = () => navigate(isEdit ? `/carret/procure/vendors/${vendorId}` : '/carret/procure/vendors');

  return (
    <DeskShell title={title} breadcrumb="Procurement / Vendors">
      {loading && <EmptyState title="Loading…" />}
      {loadError && <EmptyState title="Could not load this vendor" body={loadError} action={<Button onClick={() => navigate('/carret/procure/vendors')}>Back to vendors</Button>} />}
      {!loading && !loadError && (
        <form className="c-stack" onSubmit={save} noValidate>
          {!isEdit && (
            <Notice tone="info" title="New vendors start as pending">
              Once saved, a manager approves the vendor from its record. Purchase orders can only be raised for approved vendors.
            </Notice>
          )}

          <Section title="Business">
            <FormGrid cols={3}>
              {field('business_name', 'Business name', { autoFocus: !isEdit }, { required: true, span: 2 })}
              <Field label="Business type" error={errors.business_type} required>
                <Select value={form.business_type} onChange={set('business_type')} placeholder="Pick one" options={BUSINESS_TYPES} />
              </Field>
              {field('email', 'Email', { type: 'email' }, { required: true, hint: 'Also the vendor portal login' })}
              {field('number', 'Phone', phoneProps('number', true), { required: true, hint: phoneHint('number') })}
              {isEdit ? (
                <Field label="Status">
                  <Select value={form.status} onChange={set('status')} options={VENDOR_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
                </Field>
              ) : <div />}
            </FormGrid>
          </Section>

          <Section title="Contact person">
            <FormGrid cols={3}>
              {field('contact_person_name', 'Name')}
              {field('contact_person_phone', 'Phone', phoneProps('contact_person_phone'), { hint: phoneHint('contact_person_phone') })}
              {field('alternate_phone', 'Alternate phone', phoneProps('alternate_phone'), { hint: phoneHint('alternate_phone') })}
            </FormGrid>
          </Section>

          <Section title="Address">
            <FormGrid cols={3}>
              <Field label="Address" error={errors.address} required span={3}>
                <Textarea rows={2} value={form.address} onChange={set('address')} />
              </Field>
              {field('city', 'City')}
              <Field label="State" error={errors.state} required hint="Decides CGST+SGST or IGST on purchase orders">
                <Select value={form.state} onChange={set('state')} placeholder="Pick the state" options={stateOptions} />
              </Field>
              {field('pincode', 'PIN code', { inputMode: 'numeric', maxLength: 6 })}
            </FormGrid>
            <div style={{ marginTop: '12px' }}>
              <Checkbox label="Ships from the same address" checked={form.shipping_same} onChange={set('shipping_same')} />
            </div>
            {!form.shipping_same && (
              <FormGrid cols={3} className="mt-3">
                <Field label="Shipping address" span={3}>
                  <Textarea rows={2} value={form.shipping_address} onChange={set('shipping_address')} />
                </Field>
                {field('shipping_city', 'City')}
                <Field label="State">
                  <Select value={form.shipping_state} onChange={set('shipping_state')} placeholder="Pick the state" options={INDIAN_STATES} />
                </Field>
                {field('shipping_pincode', 'PIN code', { inputMode: 'numeric', maxLength: 6 })}
              </FormGrid>
            )}
          </Section>

          <Section title="Tax and documents">
            <FormGrid cols={3}>
              {field('gst_number', 'GSTIN', { style: { textTransform: 'uppercase' }, maxLength: 15 }, { hint: 'Leave empty if the vendor is not GST-registered' })}
              {field('pan_number', 'PAN', { style: { textTransform: 'uppercase' }, maxLength: 10, disabled: bankHidden })}
              {field('msme_number', 'MSME / Udyam number', { style: { textTransform: 'uppercase' }, maxLength: 19, placeholder: 'UDYAM-UP-01-0012345' }, { hint: 'Leave empty if the vendor is not MSME-registered' })}
              <DocUpload label="GST certificate" accept=".pdf,image/*" file={files.gst_certificate} onFile={pick('gst_certificate')} onFileUrl={original?.gst_certificate_url} />
              <DocUpload label="Licences and permits" accept=".pdf,image/*" file={files.licenses_and_permits} onFile={pick('licenses_and_permits')} onFileUrl={original?.licenses_url} />
              <DocUpload label="Logo or photo" accept="image/*" file={files.image} onFile={pick('image')} onFileUrl={original?.image_url} />
            </FormGrid>
          </Section>

          <Section title="Bank — where we pay the vendor">
            {bankHidden ? (
              <Notice tone="info" title="Bank details are hidden for your role">
                Only procurement and accounts see them. Saving this form keeps what is stored.
              </Notice>
            ) : (
              <FormGrid cols={2}>
                {field('bank_name', 'Bank', {}, { required: true })}
                {field('account_holder_name', 'Account holder', {}, { required: true })}
                {field('account_number', 'Account number', {
                  inputMode: 'numeric', maxLength: 18,
                  onChange: (e) => set('account_number')(String(e.target.value || '').replace(/\D/g, '').slice(0, 18)),
                }, { required: true, hint: '9 to 18 digits' })}
                {field('bank_ifsc_code', 'IFSC', { style: { textTransform: 'uppercase' }, maxLength: 11 }, { required: true })}
              </FormGrid>
            )}
          </Section>

          <Section title="Terms">
            <FormGrid cols={3}>
              <Field label="Payment terms">
                <Select value={form.po_payment_terms} onChange={set('po_payment_terms')} options={PAYMENT_TERMS} />
              </Field>
              {field('credit_days', 'Credit days', { type: 'number', min: 0, max: 365 })}
              <div />
              <Field label="Notes" span={3}>
                <Textarea rows={3} value={form.notes} onChange={set('notes')} />
              </Field>
            </FormGrid>
          </Section>

          {!isEdit && (
            <Section title="Vendor portal">
              <FormGrid cols={2}>
                <Field label="Portal password" error={errors.password} hint="Generated for you. The vendor can change it after signing in.">
                  <div className="flex" style={{ gap: '8px' }}>
                    <Input value={form.password} onChange={set('password')} className="font-mono" />
                    <Button type="button" variant="quiet" onClick={() => set('password')(newPassword())}>New</Button>
                  </div>
                </Field>
                <div style={{ alignSelf: 'end' }}>
                  <Checkbox label="Email the portal login to the vendor after saving" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
                </div>
              </FormGrid>
            </Section>
          )}

          <div className="flex items-center justify-end" style={{ gap: '8px' }}>
            <Button type="button" variant="quiet" onClick={back}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : (isEdit ? 'Save vendor' : 'Add vendor')}</Button>
          </div>
        </form>
      )}
    </DeskShell>
  );
}

const MAX_DOC_MB = 50; // the server's UPLOAD_MAX_FILE_MB default

/**
 * One document on the vendor form: pick a file, see it (eye) before saving,
 * or take it off (×) and pick another. A file already on the vendor can be
 * opened; choosing a new one replaces it on save.
 */
function DocUpload({ label, accept, file, onFile, onFileUrl }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_DOC_MB * 1024 * 1024) {
      toast.error(`${f.name} is larger than ${MAX_DOC_MB} MB`);
      e.target.value = '';
      return;
    }
    onFile(f);
  };
  const remove = () => {
    onFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };
  const iconBtn = { minWidth: 'var(--d-tap)', minHeight: 'var(--d-tap)' };

  return (
    <Field
      label={label}
      hint={file ? `${(file.size / 1024).toFixed(0)} KB — saved with the vendor` : onFileUrl ? 'A file is on record — choose a new one to replace it' : 'PDF or image, up to 50 MB'}
    >
      <div className="c-stack" style={{ gap: '6px' }}>
        <Input ref={inputRef} type="file" accept={accept} onChange={choose} style={file ? { display: 'none' } : undefined} />
        {file && (
          <div className="flex items-center border border-rule" style={{ gap: '6px', padding: '4px 8px', borderRadius: 'var(--d-radius)' }}>
            {file.type.startsWith('image/') && preview && (
              <img src={preview} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} />
            )}
            <span className="font-ui min-w-0" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>{file.name}</span>
            <Button type="button" variant="quiet" style={iconBtn} aria-label={`Preview ${file.name}`} title="Preview" onClick={() => preview && window.open(preview, '_blank', 'noopener')}>
              <Eye size={16} aria-hidden="true" />
            </Button>
            <Button type="button" variant="quiet" style={iconBtn} aria-label={`Remove ${file.name}`} title="Remove" onClick={remove}>
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        )}
        {!file && onFileUrl && (
          <a href={fileUrl(onFileUrl)} target="_blank" rel="noreferrer" className="font-ui inline-flex items-center" style={{ gap: '4px', fontSize: 'var(--d-sm)' }}>
            <Eye size={14} aria-hidden="true" /> View the file on record
          </a>
        )}
      </div>
    </Field>
  );
}
