import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, DateTime, Drawer, EmptyState, Field, FormGrid, Input, KeyValue, Money, Notice, Section, Select, Textarea,
} from '../../../../components/carret';
import { lookupGstin } from '../../../../utils/gstinLookup';
import { lookupAndResolvePincode } from '../../../../utils/pincodeLookup';
import { formatIndianMobileInput, normalizeIndianMobile } from '../../../../utils/phoneValidation';
import { matchIndianState } from '../../../../constants/indianStates';
import { errMsg, updateCustomerProfile } from './customersApi';
import {
  COMPANY_TYPES, STATE_OPTIONS, cleanGstin, cleanPan, emailProblem, gstinProblem, mobileProblem, panProblem,
  pincodeProblem, sameState, stateFromGstin, supplyState,
} from './customerProfileShared';
import { MONTH_CHOICES } from '../sellShared';

/**
 * Customer record → Profile: company, GST, PAN, contacts, billing / shipping
 * address, billing type, notes — and the drawer that edits them (PUT
 * /customer-management/customers/:id, the API the old Lead CRM page used).
 *
 * A change to the state billing uses for GST (shipping state when shipping
 * differs, else billing state) is never saved silently: the drawer says what
 * changes and asks for a tick; the server refuses it without one.
 */

const street = (c) => (typeof c?.billing_address === 'object' ? c?.billing_address?.address : c?.billing_address) || '';
const stateValue = (s) => matchIndianState(s) || s || '';

export function profileForm(c) {
  const form = {
    customer_name: c.contact_person_name || c.customer_name || c.name || '',
    company_name: c.company_name || '',
    trade_name: c.trade_name || '',
    email: c.email || '',
    customer_number: normalizeIndianMobile(c.contact_person_number || c.customer_number || c.phone || ''),
    whatsapp_number: normalizeIndianMobile(c.whatsapp_number || ''),
    designation: c.designation || '',
    gst_number: cleanGstin(c.gst_number),
    pan_number: cleanPan(c.pan_number || c.pan_card_number),
    company_type: c.company_type || '',
    industry: c.industry || '',
    billing_type: c.billing_type === 'postpaid' ? 'postpaid' : 'prepaid',
    security_deposit_months: c.security_deposit_months == null ? '' : String(c.security_deposit_months),
    billing_address: street(c),
    billing_city: c.billing_city || '',
    billing_state: stateValue(c.billing_state),
    billing_pincode: c.billing_pincode || '',
    shipping_same: c.shipping_same !== false,
    shipping_address: c.shipping_address || '',
    shipping_city: c.shipping_city || '',
    shipping_state: stateValue(c.shipping_state),
    shipping_pincode: c.shipping_pincode || '',
    finance_contact_name: c.finance_contact_name || '',
    finance_contact_email: c.finance_contact_email || '',
    finance_contact_mobile: normalizeIndianMobile(c.finance_contact_mobile || ''),
    spock_person_name: c.spock_person_name || '',
    spock_person_email: c.spock_person_email || '',
    spock_person_mobile: normalizeIndianMobile(c.spock_person_mobile || ''),
    notes: c.notes || '',
  };
  // "Same as contact person" starts ticked when the section already matches it.
  const same = (name, mobile, email) => Boolean(form.customer_name)
    && name === form.customer_name && mobile === form.customer_number && String(email).toLowerCase() === String(form.email).toLowerCase();
  form.finance_same = same(form.finance_contact_name, form.finance_contact_mobile, form.finance_contact_email);
  form.spock_same = same(form.spock_person_name, form.spock_person_mobile, form.spock_person_email);
  return form;
}

/** Copy the contact person into Finance / Spoke while their "same as" box is ticked. */
export function syncSameAsContact(x) {
  const out = { ...x };
  if (out.finance_same) {
    out.finance_contact_name = out.customer_name;
    out.finance_contact_mobile = out.customer_number;
    out.finance_contact_email = out.email;
  }
  if (out.spock_same) {
    out.spock_person_name = out.customer_name;
    out.spock_person_mobile = out.customer_number;
    out.spock_person_email = out.email;
  }
  return out;
}

/** Field errors. GSTIN / PAN / email are checked when they differ from what is on file (legacy values never block). */
export function profileErrors(f, original) {
  const e = {};
  const req = (k) => { if (!String(f[k] || '').trim()) e[k] = 'Required'; };
  ['customer_name', 'company_name', 'billing_address', 'billing_city', 'billing_state', 'spock_person_name'].forEach(req);
  const changed = (k) => String(f[k] || '') !== String(original[k] || '');
  if (changed('email') || !f.email) e.email = emailProblem(f.email, { required: true }) || undefined;
  if (changed('gst_number')) e.gst_number = gstinProblem(f.gst_number) || undefined;
  if (changed('pan_number')) e.pan_number = panProblem(f.pan_number) || undefined;
  e.customer_number = mobileProblem(f.customer_number, { required: true }) || undefined;
  e.whatsapp_number = mobileProblem(f.whatsapp_number) || undefined;
  e.billing_pincode = pincodeProblem(f.billing_pincode, { required: true }) || undefined;
  e.finance_contact_email = emailProblem(f.finance_contact_email) || undefined;
  e.finance_contact_mobile = mobileProblem(f.finance_contact_mobile) || undefined;
  e.spock_person_email = emailProblem(f.spock_person_email, { required: true }) || undefined;
  e.spock_person_mobile = mobileProblem(f.spock_person_mobile, { required: true }) || undefined;
  if (!f.shipping_same) {
    ['shipping_address', 'shipping_city', 'shipping_state'].forEach(req);
    e.shipping_pincode = pincodeProblem(f.shipping_pincode, { required: true }) || undefined;
  }
  Object.keys(e).forEach((k) => { if (!e[k]) delete e[k]; });
  return e;
}

function stateOptions(current) {
  if (current && !STATE_OPTIONS.some((o) => o.value === current)) return [{ value: current, label: current }, ...STATE_OPTIONS];
  return STATE_OPTIONS;
}

/** Read-only profile on the record. */
export function ProfileTab({ c, canEdit, onEdit }) {
  if (!c) return <EmptyState title="Loading…" />;
  const bill = [street(c), c.billing_city, c.billing_state, c.billing_pincode].filter(Boolean).join(', ');
  const ship = c.shipping_same === false
    ? [c.shipping_address, c.shipping_city, c.shipping_state, c.shipping_pincode].filter(Boolean).join(', ')
    : 'Same as billing';
  const gstState = stateFromGstin(c.gst_number);
  const pos = supplyState(c.shipping_same === false ? c.shipping_state : null, c.billing_state);
  return (
    <div className="c-stack">
      {gstState && pos && !sameState(gstState, pos) && (
        <Notice tone="warn" title="GSTIN and billing state differ">
          The GSTIN is registered in {gstState}; invoices are billed to {pos}. Check which is right before the next invoice.
        </Notice>
      )}
      <Section title="Company" actions={canEdit && <Button onClick={onEdit}>Edit profile…</Button>}>
        <KeyValue
          cols={3}
          items={[
            { label: 'Company', value: c.company_name },
            { label: 'Trade name', value: c.trade_name },
            { label: 'Company type', value: c.company_type },
            { label: 'GSTIN', value: c.gst_number ? <span className="font-mono">{c.gst_number}</span> : '' },
            { label: 'PAN', value: c.pan_number ? <span className="font-mono">{c.pan_number}</span> : '' },
            { label: 'Industry', value: c.industry },
            { label: 'Billing', value: c.billing_type === 'postpaid' ? 'Postpaid — last month billed on the 1st' : 'Prepaid — this month billed on the 1st' },
            { label: 'GST billed to (place of supply)', value: pos || 'Not set — CGST + SGST by default' },
            { label: 'Security held', value: <Money value={c.total_security_amount} /> },
            { label: 'Security on new orders', value: c.security_deposit_months == null ? 'Not set — None' : (MONTH_CHOICES.find((o) => o.value === String(c.security_deposit_months))?.label || '—') },
          ]}
        />
      </Section>
      <Section title="Addresses on the profile">
        <KeyValue cols={2} items={[{ label: 'Billing address', value: bill }, { label: 'Shipping address', value: ship }]} />
      </Section>
      <Section title="People">
        <KeyValue
          cols={3}
          items={[
            { label: 'Contact person', value: c.contact_person_name || c.customer_name },
            { label: 'Phone', value: c.customer_number || c.phone },
            { label: 'Email', value: c.email },
            { label: 'WhatsApp', value: c.whatsapp_number },
            { label: 'Designation', value: c.designation },
            { label: 'Finance contact', value: [c.finance_contact_name, c.finance_contact_mobile, c.finance_contact_email].filter(Boolean).join(' · ') },
            { label: 'Spoke person', value: [c.spock_person_name, c.spock_person_mobile, c.spock_person_email].filter(Boolean).join(' · ') },
          ]}
        />
      </Section>
      <Section title="Origin and notes">
        <KeyValue
          cols={3}
          items={[
            { label: 'From lead', value: c.source_lead_id ? <Link to={`/carret/sell/leads/${c.source_lead_id}`}>Lead #{c.source_lead_id}</Link> : 'Added directly' },
            { label: 'Stage at conversion', value: c.source_lead_stage },
            { label: 'Customer since', value: <DateTime value={c.onboarded_at || c.created_at} /> },
            { label: 'KYC', value: c.kyc_verified ? <>Verified <DateTime value={c.kyc_verified_at} /></> : (c.kyc_status || 'Pending') },
          ]}
        />
        {c.notes && <p className="text-ink-2" style={{ marginTop: '12px', whiteSpace: 'pre-wrap' }}>{c.notes}</p>}
      </Section>
    </div>
  );
}

/** Edit drawer. */
export function ProfileDrawer({ open, customer, onClose, onSaved }) {
  const original = useMemo(() => (customer ? profileForm(customer) : null), [customer]);
  const [f, setF] = useState(original);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gst, setGst] = useState(null); // { status, info?, message? }
  const [confirmState, setConfirmState] = useState(false);
  const [serverWarn, setServerWarn] = useState(null);

  useEffect(() => {
    if (open && original) { setF(original); setTouched(false); setGst(null); setConfirmState(false); setServerWarn(null); }
  }, [open, original]);

  if (!open || !f) return null;
  const errors = profileErrors(f, original);
  const shown = touched ? errors : {};
  const set = (k) => (e) => setF((x) => syncSameAsContact({ ...x, [k]: e.target.value }));
  const setMobile = (k) => (e) => setF((x) => syncSameAsContact({ ...x, [k]: formatIndianMobileInput(e.target.value) }));
  const setSame = (k) => (e) => setF((x) => syncSameAsContact({ ...x, [k]: e.target.checked }));

  const pin = (prefix) => async (e) => {
    const v = String(e.target.value || '').replace(/\D/g, '').slice(0, 6);
    setF((x) => ({ ...x, [`${prefix}_pincode`]: v }));
    if (v.length !== 6) return;
    const { info } = await lookupAndResolvePincode(v);
    if (!info) return;
    // A city is filled only when empty; a state is never replaced silently.
    setF((x) => ({
      ...x,
      [`${prefix}_city`]: x[`${prefix}_city`] || info.city || '',
      [`${prefix}_state`]: x[`${prefix}_state`] || matchIndianState(info.state) || info.state || '',
    }));
    const st = matchIndianState(info.state) || info.state;
    if (st && f[`${prefix}_state`] && !sameState(st, f[`${prefix}_state`])) {
      toast(`Pincode ${v} is in ${st}; the state is still ${f[`${prefix}_state`]}. Change it if that is wrong.`);
    }
  };

  const fetchGst = async () => {
    setGst({ status: 'loading' });
    try {
      const info = await lookupGstin(f.gst_number);
      setGst(info ? { status: 'found', info } : { status: 'error', message: 'No GST details found for this GSTIN.' });
    } catch (e) { setGst({ status: 'error', message: errMsg(e, 'GSTIN lookup failed.') }); }
  };
  const useGst = () => {
    const i = gst.info;
    setF((x) => ({
      ...x,
      company_name: i.trade_name || i.company_name || x.company_name,
      trade_name: i.trade_name || x.trade_name,
      pan_number: cleanPan(i.pan_number) || x.pan_number,
      company_type: i.company_type || x.company_type,
      billing_address: i.address || x.billing_address,
      billing_city: i.city || x.billing_city,
      billing_state: i.stateSelect || matchIndianState(i.state) || i.state || x.billing_state,
      billing_pincode: i.pincode || x.billing_pincode,
    }));
    setGst(null);
  };

  const fromPos = supplyState(original.shipping_same ? null : original.shipping_state, original.billing_state);
  const toPos = supplyState(f.shipping_same ? null : f.shipping_state, f.billing_state);
  const posChanges = !sameState(fromPos, toPos) || Boolean(serverWarn);
  const gstState = stateFromGstin(f.gst_number);
  const panFromGst = f.gst_number.length === 15 ? f.gst_number.slice(2, 12) : '';

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length) { toast.error('Fix the marked fields first.'); return; }
    if (posChanges && !confirmState) { toast.error('Tick the GST state change to save it.'); return; }
    setBusy(true);
    try {
      const { finance_same: _fs, spock_same: _ss, ...fields } = f;
      const body = {
        ...fields,
        security_deposit_months: fields.security_deposit_months === '' ? null : Number(fields.security_deposit_months),
        customer_number: normalizeIndianMobile(f.customer_number),
        contact_person_name: f.customer_name,
        contact_person_number: normalizeIndianMobile(f.customer_number),
        whatsapp_number: f.whatsapp_number ? normalizeIndianMobile(f.whatsapp_number) : '',
        shipping_address: f.shipping_same ? '' : f.shipping_address,
        shipping_city: f.shipping_same ? '' : f.shipping_city,
        shipping_state: f.shipping_same ? '' : f.shipping_state,
        shipping_pincode: f.shipping_same ? '' : f.shipping_pincode,
        ...(confirmState ? { confirm_supply_state_change: true } : {}),
      };
      await updateCustomerProfile(customer.customer_id, body);
      toast.success('Profile saved');
      onSaved?.();
      onClose();
    } catch (e) {
      const d = e?.response?.data;
      if (e?.response?.status === 409 && d?.code === 'SUPPLY_STATE_CHANGE') {
        setServerWarn(d.message);
        setConfirmState(false);
      } else toast.error(errMsg(e));
    } finally { setBusy(false); }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit profile"
      width="44rem"
      footer={(
        <div className="flex items-center justify-end" style={{ gap: '8px' }}>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save profile'}</Button>
        </div>
      )}
    >
      <div className="c-stack">
        <Section title="Company">
          <FormGrid cols={2}>
            <Field label="GSTIN" error={shown.gst_number} hint={f.gst_number && f.gst_number.length < 15 ? `${f.gst_number.length} of 15 characters` : 'Leave empty if not GST-registered'}>
              <Input className="font-mono" maxLength={15} value={f.gst_number} onChange={(e) => { setF((x) => ({ ...x, gst_number: cleanGstin(e.target.value) })); setGst(null); }} />
            </Field>
            <Field label="From the GST register">
              <Button disabled={Boolean(gstinProblem(f.gst_number)) || !f.gst_number || gst?.status === 'loading'} onClick={fetchGst}>
                {gst?.status === 'loading' ? 'Looking up…' : 'Look up GSTIN'}
              </Button>
            </Field>
            {gst?.status === 'error' && <div style={{ gridColumn: '1 / -1' }}><Notice tone="warn">{gst.message}</Notice></div>}
            {gst?.status === 'found' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <Notice tone="info" title={gst.info.trade_name || gst.info.company_name} action={<Button onClick={useGst}>Use these details</Button>}>
                  {[gst.info.address, gst.info.city, gst.info.state, gst.info.pincode].filter(Boolean).join(', ')}
                  {gst.info.state && f.billing_state && !sameState(gst.info.state, f.billing_state) ? ` — this changes the billing state from ${f.billing_state} to ${gst.info.state}.` : ''}
                </Notice>
              </div>
            )}
            <Field label="Company" required error={shown.company_name}><Input value={f.company_name} onChange={set('company_name')} /></Field>
            <Field label="Trade name"><Input value={f.trade_name} onChange={set('trade_name')} /></Field>
            <Field label="PAN" error={shown.pan_number} hint={panFromGst && f.pan_number && f.pan_number !== panFromGst ? `The GSTIN carries PAN ${panFromGst}` : undefined}>
              <Input className="font-mono" maxLength={10} value={f.pan_number} onChange={(e) => setF((x) => ({ ...x, pan_number: cleanPan(e.target.value) }))} />
            </Field>
            <Field label="Company type"><Select value={f.company_type} onChange={set('company_type')} placeholder="—" options={COMPANY_TYPES.includes(f.company_type) || !f.company_type ? COMPANY_TYPES : [f.company_type, ...COMPANY_TYPES]} /></Field>
            <Field label="Industry"><Input value={f.industry} onChange={set('industry')} /></Field>
            <Field label="Billing">
              <Select value={f.billing_type} onChange={set('billing_type')} options={[{ value: 'prepaid', label: 'Prepaid — bill this month on the 1st' }, { value: 'postpaid', label: 'Postpaid — bill last month on the 1st' }]} />
            </Field>
            <Field label="Security deposit on new orders" hint="Rental and demo orders start from this. Orders already raised keep their deposit.">
              <Select value={f.security_deposit_months} onChange={set('security_deposit_months')} placeholder="Not set" options={MONTH_CHOICES} />
            </Field>
          </FormGrid>
        </Section>

        <Section title="Billing address">
          <FormGrid cols={3}>
            <Field label="Address" required error={shown.billing_address} span={3}><Textarea rows={2} value={f.billing_address} onChange={set('billing_address')} /></Field>
            <Field label="Pincode" required error={shown.billing_pincode}><Input inputMode="numeric" maxLength={6} value={f.billing_pincode} onChange={pin('billing')} /></Field>
            <Field label="City" required error={shown.billing_city}><Input value={f.billing_city} onChange={set('billing_city')} /></Field>
            <Field label="State" required error={shown.billing_state}><Select value={f.billing_state} onChange={set('billing_state')} placeholder="Select state" options={stateOptions(f.billing_state)} /></Field>
          </FormGrid>
          <div style={{ marginTop: '12px' }}>
            <Checkbox label="Ship to the billing address" checked={f.shipping_same} onChange={(e) => setF((x) => ({ ...x, shipping_same: e.target.checked }))} />
          </div>
        </Section>

        {!f.shipping_same && (
          <Section title="Shipping address">
            <FormGrid cols={3}>
              <Field label="Address" required error={shown.shipping_address} span={3}><Textarea rows={2} value={f.shipping_address} onChange={set('shipping_address')} /></Field>
              <Field label="Pincode" required error={shown.shipping_pincode}><Input inputMode="numeric" maxLength={6} value={f.shipping_pincode} onChange={pin('shipping')} /></Field>
              <Field label="City" required error={shown.shipping_city}><Input value={f.shipping_city} onChange={set('shipping_city')} /></Field>
              <Field label="State" required error={shown.shipping_state}><Select value={f.shipping_state} onChange={set('shipping_state')} placeholder="Select state" options={stateOptions(f.shipping_state)} /></Field>
            </FormGrid>
            <p className="text-ink-3" style={{ marginTop: '8px' }}>When shipping differs from billing, invoices are billed to the shipping state for GST.</p>
          </Section>
        )}

        {gstState && toPos && !sameState(gstState, toPos) && (
          <Notice tone="warn" title="GSTIN and billing state differ">The GSTIN is registered in {gstState}; invoices would be billed to {toPos}.</Notice>
        )}
        {posChanges && (
          <Notice tone="serious" title="The GST state for billing changes">
            <div className="c-stack">
              <span>{serverWarn || `Invoices are billed to ${fromPos || 'an unknown state'} today. After this change they are billed to ${toPos || 'an unknown state'} — ${!toPos ? 'CGST + SGST by default' : 'CGST + SGST if Haryana, IGST otherwise'}. Invoices already raised do not change.`}</span>
              <Checkbox label={`Bill future invoices to ${toPos || 'no state'}`} checked={confirmState} onChange={(e) => setConfirmState(e.target.checked)} />
            </div>
          </Notice>
        )}

        <Section title="Contact person">
          <FormGrid cols={2}>
            <Field label="Name" required error={shown.customer_name}><Input value={f.customer_name} onChange={set('customer_name')} /></Field>
            <Field label="Designation"><Input value={f.designation} onChange={set('designation')} /></Field>
            <Field label="Mobile" required error={shown.customer_number}><Input inputMode="numeric" maxLength={10} value={f.customer_number} onChange={setMobile('customer_number')} /></Field>
            <Field label="WhatsApp" error={shown.whatsapp_number}><Input inputMode="numeric" maxLength={10} value={f.whatsapp_number} onChange={setMobile('whatsapp_number')} /></Field>
            <Field label="Email" required error={shown.email} span={2} hint={customer.portal_enabled && f.email !== original.email ? 'The portal sign-in moves to this email.' : undefined}>
              <Input type="email" value={f.email} onChange={set('email')} />
            </Field>
          </FormGrid>
        </Section>

        <Section title="Finance contact">
          <div style={{ marginBottom: '12px' }}>
            <Checkbox label="Same as contact person" checked={Boolean(f.finance_same)} onChange={setSame('finance_same')} />
          </div>
          <FormGrid cols={3}>
            <Field label="Name"><Input readOnly={Boolean(f.finance_same)} value={f.finance_contact_name} onChange={set('finance_contact_name')} /></Field>
            <Field label="Mobile" error={shown.finance_contact_mobile}><Input inputMode="numeric" maxLength={10} readOnly={Boolean(f.finance_same)} value={f.finance_contact_mobile} onChange={setMobile('finance_contact_mobile')} /></Field>
            <Field label="Email" error={shown.finance_contact_email}><Input type="email" readOnly={Boolean(f.finance_same)} value={f.finance_contact_email} onChange={set('finance_contact_email')} /></Field>
          </FormGrid>
        </Section>

        <Section title="Spoke person">
          <div style={{ marginBottom: '12px' }}>
            <Checkbox label="Same as contact person" checked={Boolean(f.spock_same)} onChange={setSame('spock_same')} />
          </div>
          <FormGrid cols={3}>
            <Field label="Name" required error={shown.spock_person_name}><Input readOnly={Boolean(f.spock_same)} value={f.spock_person_name} onChange={set('spock_person_name')} /></Field>
            <Field label="Mobile" required error={shown.spock_person_mobile}><Input inputMode="numeric" maxLength={10} readOnly={Boolean(f.spock_same)} value={f.spock_person_mobile} onChange={setMobile('spock_person_mobile')} /></Field>
            <Field label="Email" required error={shown.spock_person_email}><Input type="email" readOnly={Boolean(f.spock_same)} value={f.spock_person_email} onChange={set('spock_person_email')} /></Field>
          </FormGrid>
        </Section>

        <Field label="Notes"><Textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Drawer>
  );
}
