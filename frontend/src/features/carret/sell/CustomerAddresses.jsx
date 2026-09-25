import React, { useEffect, useState } from 'react';
import { getCustomerAddresses, getCustomerDetail } from '../../sales-pipeline/salesPipelineApi';
import {
  buildBillingAddress, buildShippingOptions, emptyManualAddress,
} from '../../sales-pipeline/customerAddresses';
import { INDIAN_STATES } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';
import { Field, Input, Select, Textarea, FormGrid } from '../../../components/carret';

/**
 * A customer's detail, billing address and shipping choices, loaded once per
 * customer. Uses the same two customer-management endpoints as the old forms.
 */
export function useCustomerAddresses(customerId) {
  const [state, setState] = useState({ loading: false, customer: null, billing: null, options: [], error: null });

  useEffect(() => {
    if (!customerId) {
      setState({ loading: false, customer: null, billing: null, options: [], error: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([getCustomerDetail(customerId), getCustomerAddresses(customerId)])
      .then(([custRes, addrRes]) => {
        if (cancelled) return;
        const customer = custRes.data?.customer || custRes.data;
        const saved = addrRes.data?.addresses || customer?.saved_addresses || [];
        setState({
          loading: false,
          customer,
          billing: buildBillingAddress(customer),
          options: buildShippingOptions(customer, saved),
          error: null,
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setState({
            loading: false, customer: null, billing: null, options: [],
            error: e?.response?.data?.message || 'Could not load the customer’s addresses.',
          });
        }
      });
    return () => { cancelled = true; };
  }, [customerId]);

  return state;
}

export function AddressText({ address, empty = 'No address' }) {
  if (!address) return <span className="text-ink-3">{empty}</span>;
  const line2 = [address.city, address.state, address.zip_code || address.pincode].filter((v) => v && v !== 'N/A').join(', ');
  return (
    <div className="c-addr">
      <b>{address.name && address.name !== 'N/A' ? address.name : '—'}</b>
      {address.phone && address.phone !== 'N/A' ? ` · ${address.phone}` : ''}
      <div>{address.address && address.address !== 'N/A' ? address.address : ''}</div>
      {line2 && <div>{line2}</div>}
      {address.gst_number && address.gst_number !== 'N/A' && <div className="font-mono">GSTIN {address.gst_number}</div>}
    </div>
  );
}

/** Editable address fields with pincode → city/state autofill. */
export function AddressFields({ value, onChange, errors = {} }) {
  const v = value || emptyManualAddress();
  const set = (patch) => onChange({ ...v, ...patch });
  return (
    <FormGrid cols={3}>
      <Field label="Contact name" required error={errors.name}>
        <Input value={v.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Phone" required error={errors.phone}>
        <Input value={v.phone} inputMode="tel" onChange={(e) => set({ phone: e.target.value })} />
      </Field>
      <Field label="Pincode" required error={errors.zip_code}>
        <Input
          value={v.zip_code}
          inputMode="numeric"
          maxLength={6}
          onChange={(e) => {
            const raw = e.target.value;
            set({ zip_code: raw.replace(/\D/g, '') });
            if (raw.replace(/\D/g, '').length === 6) {
              applyPincodeAutofill(raw, (fn) => onChange(fn({ ...v, zip_code: raw.replace(/\D/g, '') })), {
                pinKey: 'zip_code', cityKey: 'city', stateKey: 'state', addressKey: 'address', fillAddressIfEmpty: false,
              });
            }
          }}
        />
      </Field>
      <Field label="Address" required error={errors.address} span={3}>
        <Textarea rows={2} value={v.address} onChange={(e) => set({ address: e.target.value })} />
      </Field>
      <Field label="City" required error={errors.city}>
        <Input value={v.city} onChange={(e) => set({ city: e.target.value })} />
      </Field>
      <Field label="State" required error={errors.state}>
        <Select value={v.state} onChange={(e) => set({ state: e.target.value })} placeholder="Choose state" options={INDIAN_STATES} />
      </Field>
    </FormGrid>
  );
}

export function validateAddress(a) {
  const errors = {};
  if (!a) return { address: 'Address is required' };
  if (!String(a.name || '').trim()) errors.name = 'Required';
  if (!String(a.phone || '').trim()) errors.phone = 'Required';
  if (!String(a.address || '').trim()) errors.address = 'Required';
  if (!String(a.city || '').trim()) errors.city = 'Required';
  if (!String(a.state || '').trim()) errors.state = 'Required';
  if (!/^\d{6}$/.test(String(a.zip_code || ''))) errors.zip_code = 'Six digits';
  return errors;
}

/**
 * Shipping choice: one of the customer's addresses, or typed in.
 * value: { key, manual } → resolved address via resolveShipping().
 */
export function ShippingPicker({ options, value, onChange, errors }) {
  const key = value?.key || 'billing';
  return (
    <div className="c-stack" style={{ gap: '12px' }}>
      <Field label="Ship to">
        <Select
          value={key}
          onChange={(e) => onChange({ ...value, key: e.target.value })}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Field>
      {key === 'manual'
        ? <AddressFields value={value?.manual} onChange={(manual) => onChange({ ...value, manual })} errors={errors} />
        : <AddressText address={options.find((o) => o.value === key)?.address} />}
    </div>
  );
}

export function resolveShipping(options, value) {
  const key = value?.key || 'billing';
  if (key === 'manual') return value?.manual ? { country: 'India', ...value.manual } : null;
  return options.find((o) => o.value === key)?.address || null;
}
