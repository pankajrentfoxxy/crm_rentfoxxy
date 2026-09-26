import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, EmptyState, Field, FormGrid, Input, Notice, Section, Select, Textarea,
} from '../../../components/carret';
import { INDIAN_STATES, INDIAN_STATE_OPTIONS } from '../../../constants/indianStates';
import {
  createVendor, fetchVendor, updateVendor, updateVendorPortalAccess,
} from '../../vendor-management/vendorManagementApi';
import {
  VENDOR_STATUSES, emptyVendorForm, errMsg, fileUrl, newPassword, vendorFormData, vendorFormErrors, vendorFormFromRow, vendorName,
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
  const pick = (k) => (e) => setFiles((f) => ({ ...f, [k]: e.target.files?.[0] || null }));
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
    <DeskShell title={title} breadcrumb="Procure / Vendors">
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
              {field('number', 'Phone', { inputMode: 'numeric', maxLength: 13 }, { required: true })}
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
              {field('contact_person_phone', 'Phone', { inputMode: 'numeric', maxLength: 13 })}
              {field('alternate_phone', 'Alternate phone', { inputMode: 'numeric', maxLength: 13 })}
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
              {field('msme_number', 'MSME / Udyam number')}
              <Field label="GST certificate" hint={original?.gst_certificate_url ? 'A certificate is on file — choose a file to replace it' : 'PDF or image'}>
                <Input type="file" accept=".pdf,image/*" onChange={pick('gst_certificate')} />
              </Field>
              <Field label="Licences and permits" hint={original?.licenses_url ? 'A file is on file — choose a file to replace it' : undefined}>
                <Input type="file" accept=".pdf,image/*" onChange={pick('licenses_and_permits')} />
              </Field>
              <Field label="Logo or photo">
                <Input type="file" accept="image/*" onChange={pick('image')} />
              </Field>
            </FormGrid>
            {original?.gst_certificate_url && <p className="text-ink-3" style={{ marginTop: '8px' }}><a href={fileUrl(original.gst_certificate_url)} target="_blank" rel="noreferrer">Open the GST certificate on file</a></p>}
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
                {field('account_number', 'Account number', { inputMode: 'numeric' }, { required: true })}
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
