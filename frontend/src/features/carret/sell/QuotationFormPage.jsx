import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Field, Input, Select, FormGrid, Section, Notice, Segmented, Money, Checkbox, Textarea,
} from '../../../components/carret';
import { ENTITIES } from '../../../config/entities';
import { getQuotationMeta, createQuotation, sendQuotationEmail } from '../../sales-pipeline/salesPipelineApi';
import {
  filterCustomersForQuotation, isCustomerEligibleForQuotation, customerTypeMismatchMessage,
} from '../../../utils/customerType';
import { INDIAN_STATES, slugifyState, matchIndianState } from '../../../constants/indianStates';
import LineItemsEditor, {
  emptyLine, linesToPayload, linesTotal, firstMissing, fieldLabel,
} from './LineItemsEditor';
import {
  useCustomerAddresses, ShippingPicker, resolveShipping, AddressText, AddressFields, validateAddress,
} from './CustomerAddresses';

/**
 * Sell → New quotation.
 *
 * Same endpoint and payload as the old drawer (POST /sales-management/quotations),
 * so a quotation raised here is indistinguishable from one raised there.
 *
 * Validity date, terms and header remarks are stored since migration 327 and
 * print on the quotation PDF (the old drawer asked for them and the server used
 * to drop them). Per-line remarks are on each line.
 */
const TYPES = [
  { value: 'rental', label: 'Rental', entity: ENTITIES.rental },
  { value: 'sale', label: 'Sale', entity: ENTITIES.sale },
];

const blankParty = {
  customer_id: '', contact_name: '', company_name: '', customer_mobile: '', email: '', GST_number: '',
};

export default function QuotationFormPage() {
  const navigate = useNavigate();
  const { state: navState } = useLocation();
  const prefill = navState?.prefill || {};

  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState('');
  const [type, setType] = useState(prefill.quotation_type === 'sale' ? 'sale' : 'rental');
  const [party, setParty] = useState({
    ...blankParty,
    customer_id: prefill.customer_id ? String(prefill.customer_id) : '',
    contact_name: prefill.contact_name || '',
    company_name: prefill.company_name || prefill.customer_name || '',
    customer_mobile: prefill.phone || '',
    email: prefill.email || '',
  });
  const [lines, setLines] = useState(() => (
    prefill.line_items?.length
      ? prefill.line_items.map((l) => ({ ...emptyLine(), ...l, model_name: l.model_name || l.model || '' }))
      : [emptyLine()]
  ));
  const [securityType, setSecurityType] = useState('none');
  const [shipping, setShipping] = useState('');
  const [shipChoice, setShipChoice] = useState({ key: 'billing', manual: null });
  const [prospectShip, setProspectShip] = useState({ on: false, address: null });
  const [supplyState, setSupplyState] = useState(slugifyState('Haryana'));
  const [supplyTouched, setSupplyTouched] = useState(false);
  const [send, setSend] = useState({ to: prefill.email || '', cc: '' });
  const [validity, setValidity] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [terms, setTerms] = useState('');
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getQuotationMeta({ quotation_type: type })
      .then(({ data }) => { setMeta(data); setMetaError(''); })
      .catch((e) => setMetaError(e?.response?.data?.message || 'Could not load customers.'));
  }, [type]);

  const customers = useMemo(
    () => filterCustomersForQuotation(meta?.customers || [], type),
    [meta, type]
  );
  const addr = useCustomerAddresses(party.customer_id);
  const shippingAddress = party.customer_id
    ? resolveShipping(addr.options, shipChoice)
    : (prospectShip.on ? prospectShip.address : null);

  // Place of supply follows the shipping state until someone picks it by hand.
  useEffect(() => {
    if (supplyTouched) return;
    const s = matchIndianState(shippingAddress?.state || addr.billing?.state);
    if (s) setSupplyState(slugifyState(s));
  }, [shippingAddress?.state, addr.billing?.state, supplyTouched]);

  const isSale = type === 'sale';
  const book = TYPES.find((t) => t.value === type).entity;
  const subtotal = linesTotal(lines);
  const security = !isSale && securityType === 'one_month_rental' ? subtotal : 0;
  const shippingCharge = Number(shipping) || 0;
  const firstPayment = subtotal + security + shippingCharge;

  const onType = (t) => {
    setType(t);
    const c = (meta?.customers || []).find((x) => String(x.customer_id) === String(party.customer_id));
    if (c && !isCustomerEligibleForQuotation(c.customer_type, t)) {
      toast(customerTypeMismatchMessage(c.customer_type, t));
      setParty(blankParty);
    }
    if (t === 'sale') setSecurityType('none');
  };

  const onCustomer = (id) => {
    const c = customers.find((x) => String(x.customer_id) === String(id));
    setShipChoice({ key: 'billing', manual: null });
    if (!c) { setParty(blankParty); return; }
    setParty({
      customer_id: String(c.customer_id),
      contact_name: c.name || c.contact_name || '',
      company_name: c.company_name || c.name || '',
      customer_mobile: c.phone || c.customer_mobile || '',
      email: c.email || '',
      GST_number: c.gst_no || c.gst_number || '',
    });
    setSend((s) => ({ ...s, to: s.to || c.email || '' }));
  };

  const validate = (andSend) => {
    const e = {};
    if (!party.contact_name.trim()) e.contact_name = 'Required';
    if (!party.company_name.trim()) e.company_name = 'Required';
    if (!party.customer_mobile.trim()) e.customer_mobile = 'Required';
    const miss = firstMissing(lines, ['brand']);
    if (miss) e.line = miss;
    if (party.customer_id && shipChoice.key === 'manual') {
      const ae = validateAddress(shipChoice.manual);
      if (Object.keys(ae).length) e.ship = ae;
    }
    if (!party.customer_id && prospectShip.on) {
      const ae = validateAddress(prospectShip.address);
      if (Object.keys(ae).length) e.prospectShip = ae;
    }
    if (andSend && !/^\S+@\S+\.\S+$/.test(send.to.trim())) e.sendTo = 'A valid email is needed to send';
    setErrors(e);
    if (Object.keys(e).length) {
      const first = e.line ? `Line ${e.line.index + 1}: ${fieldLabel(e.line.field)} is missing` : 'Some required fields are empty';
      toast.error(first);
      return false;
    }
    return true;
  };

  const submit = async (andSend) => {
    if (!validate(andSend)) return;
    setSaving(true);
    try {
      const { data } = await createQuotation({
        ...party,
        customer_id: party.customer_id || null,
        customer_name: party.company_name.trim(),
        contact_name: party.contact_name.trim(),
        company_name: party.company_name.trim(),
        customer_mobile: party.customer_mobile.trim(),
        email: send.to || party.email,
        GST_number: party.GST_number || null,
        quotation_type: type,
        branch: book.code,
        supply_state: supplyState,
        security_type: isSale ? 'none' : securityType,
        security_amount: security,
        shiping_charges: shippingCharge,
        source_lead_id: prefill.lead_id || null,
        validity_date: validity || null,
        terms: terms.trim() || null,
        quotation_remarks: remarks.trim() || null,
        customer_billing_address: party.customer_id ? addr.billing : null,
        customer_shipping_address: shippingAddress,
        ...linesToPayload(lines),
      });
      const qn = data?.quotation_number;
      if (andSend && qn) {
        try {
          await sendQuotationEmail(qn, { email: send.to.trim(), cc: send.cc });
          toast.success(`${qn} saved and emailed to ${send.to.trim()}`);
        } catch (err) {
          toast.error(`${qn} was saved, but the email failed: ${err?.response?.data?.message || err.message}`);
        }
      } else {
        toast.success(`${qn} saved as a draft`);
      }
      navigate(`/carret/sell/quotations/${encodeURIComponent(qn)}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save the quotation.');
    } finally {
      setSaving(false);
    }
  };

  const setP = (k) => (e) => setParty((p) => ({ ...p, [k]: e.target.value }));

  return (
    <DeskShell
      title="New quotation"
      breadcrumb="Sell / Quotations"
      subtitle={meta?.quotation_number
        ? `Will be numbered about ${meta.quotation_number} — the final number is taken when you save.`
        : 'The number is assigned when you save.'}
    >
      <div className="c-split">
        <div className="c-stack">
          {metaError && <Notice tone="crit" title="Could not load the form">{metaError}</Notice>}
          {prefill.lead_id && (
            <Notice tone="info" title={`From lead ${prefill.lead_name || `#${prefill.lead_id}`}`}>
              The quotation will be linked to this lead.
            </Notice>
          )}

          <Section title="Type">
            <div className="flex flex-wrap items-center" style={{ gap: '12px' }}>
              <Segmented label="Quotation type" value={type} onChange={onType} options={TYPES} />
              <span className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
                Billed by <b className="text-ink">{book.label}</b> · numbered {isSale ? 'GEST-' : 'EST-'}
              </span>
            </div>
          </Section>

          <Section title="Customer">
            <FormGrid cols={3}>
              <Field label="Existing customer" hint="Leave empty for a prospect who is not a customer yet." span={3}>
                <Select
                  value={party.customer_id}
                  onChange={(e) => onCustomer(e.target.value)}
                  placeholder={meta ? `Prospect — not a customer yet (${customers.length} eligible customers)` : 'Loading customers…'}
                  options={customers.map((c) => ({
                    value: String(c.customer_id),
                    label: `${c.company_name || c.name}${c.gst_no ? ` · ${c.gst_no}` : ''}`,
                  }))}
                />
              </Field>
              <Field label="Contact person" required error={errors.contact_name}>
                <Input value={party.contact_name} onChange={setP('contact_name')} />
              </Field>
              <Field label="Company" required error={errors.company_name}>
                <Input value={party.company_name} onChange={setP('company_name')} />
              </Field>
              <Field label="Phone" required error={errors.customer_mobile}>
                <Input value={party.customer_mobile} inputMode="tel" onChange={setP('customer_mobile')} />
              </Field>
              <Field label="Email">
                <Input type="email" value={party.email} onChange={setP('email')} />
              </Field>
              <Field label="GSTIN">
                <Input value={party.GST_number} onChange={setP('GST_number')} className="font-mono" />
              </Field>
              <Field label="Place of supply" hint="Follows the shipping state unless you change it.">
                <Select
                  value={supplyState}
                  onChange={(e) => { setSupplyState(e.target.value); setSupplyTouched(true); }}
                  options={INDIAN_STATES.map((s) => ({ value: slugifyState(s), label: s }))}
                />
              </Field>
            </FormGrid>
          </Section>

          <Section title="Laptops">
            <LineItemsEditor
              lines={lines}
              onChange={setLines}
              quotationType={type}
              required={['brand']}
              errors={errors.line}
            />
          </Section>

          <Section title="Addresses">
            {party.customer_id ? (
              <div className="c-form-grid" style={{ '--c-cols': 2 }}>
                <div>
                  <div className="c-label" style={{ marginBottom: '6px' }}>Bill to</div>
                  {addr.loading ? <span className="text-ink-3">Loading…</span> : <AddressText address={addr.billing} />}
                  {addr.error && <Notice tone="warn">{addr.error}</Notice>}
                </div>
                <ShippingPicker options={addr.options} value={shipChoice} onChange={setShipChoice} errors={errors.ship} />
              </div>
            ) : (
              <div className="c-stack" style={{ gap: '12px' }}>
                <Checkbox
                  label="Add a shipping address for this prospect"
                  checked={prospectShip.on}
                  onChange={(e) => setProspectShip((p) => ({ ...p, on: e.target.checked }))}
                />
                {prospectShip.on && (
                  <AddressFields
                    value={prospectShip.address}
                    onChange={(address) => setProspectShip((p) => ({ ...p, address }))}
                    errors={errors.prospectShip}
                  />
                )}
              </div>
            )}
          </Section>

          <Section title="Charges">
            <FormGrid cols={3}>
              {!isSale && (
                <Field label="Security deposit">
                  <Select
                    value={securityType}
                    onChange={(e) => setSecurityType(e.target.value)}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'one_month_rental', label: 'One month’s rent' },
                    ]}
                  />
                </Field>
              )}
              <Field label="Shipping charges (₹)">
                <Input type="number" min="0" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} />
              </Field>
            </FormGrid>
          </Section>

          <Section title="Terms">
            <FormGrid cols={3}>
              <Field label="Valid until" hint="Printed on the quotation.">
                <Input type="date" value={validity} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setValidity(e.target.value)} />
              </Field>
              <Field label="Terms for this quotation" span={2} hint="One per line. Printed above the standard terms, which always appear.">
                <Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. Delivery within 5 working days of the order" />
              </Field>
              <Field label="Remarks" span={3} hint="Printed in the quotation’s remarks.">
                <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
            </FormGrid>
          </Section>

          <Section title="Send to customer">
            <FormGrid cols={2}>
              <Field label="Email to" error={errors.sendTo} hint="Only needed for Save & send.">
                <Input type="email" value={send.to} onChange={(e) => setSend((s) => ({ ...s, to: e.target.value }))} />
              </Field>
              <Field label="CC" hint="Comma-separated.">
                <Input value={send.cc} onChange={(e) => setSend((s) => ({ ...s, cc: e.target.value }))} />
              </Field>
            </FormGrid>
          </Section>
        </div>

        <aside className="c-stack" style={{ position: 'sticky', top: '76px' }}>
          <Section title="Summary">
            <div className="c-totals">
              <div><span>{lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0)} laptops · {isSale ? 'price' : 'monthly rent'}</span><span><Money value={subtotal} /></span></div>
              {!isSale && <div><span>Security deposit</span><span><Money value={security} /></span></div>}
              <div><span>Shipping</span><span><Money value={shippingCharge} /></span></div>
              <div className="is-grand"><span>{isSale ? 'Total' : 'First payment'}</span><span><Money value={firstPayment} /></span></div>
            </div>
            <p className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)', margin: '10px 0 0' }}>
              GST is worked out on the sales order from the place of supply.
            </p>
          </Section>
          <div className="c-stack" style={{ gap: '8px' }}>
            <Button variant="primary" onClick={() => submit(true)} disabled={saving}>{saving ? 'Saving…' : 'Save & send'}</Button>
            <Button onClick={() => submit(false)} disabled={saving}>Save as draft</Button>
            <Button variant="quiet" onClick={() => navigate('/carret/sell/quotations')} disabled={saving}>Cancel</Button>
          </div>
        </aside>
      </div>
    </DeskShell>
  );
}
