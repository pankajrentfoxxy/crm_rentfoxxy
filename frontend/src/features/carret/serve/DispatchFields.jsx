import React from 'react';
import { Field, FormGrid, Input, Select, Textarea } from '../../../components/carret';

/**
 * How a support pickup / Service DC travels, and to or from where — the same
 * fields the old ticket screen sends (PickupSetupForm). `value` is
 * { dispatch_mode, technician_user_id, courier_name, awb_number,
 *   porter_tracking_id, porter_order_id, address: {name, phone, address, city, state, pincode} }.
 */
export const MODES = [
  { value: 'technician', label: 'Our technician' },
  { value: 'courier', label: 'Courier' },
  { value: 'porter', label: 'Porter' },
];

export function emptyDispatch(address = {}) {
  return {
    dispatch_mode: '', technician_user_id: '', courier_name: '', awb_number: '', porter_tracking_id: '', porter_order_id: '',
    address: { name: '', phone: '', address: '', city: '', state: '', pincode: '', ...address },
  };
}

/**
 * Checks the fields the route needs. `strict` = assign/change (courier needs
 * name + AWB, porter a booking id); create only needs the technician.
 */
export function dispatchError(v, { optional = false, strict = false, needAddress = true } = {}) {
  if (needAddress && !String(v.address?.address || '').trim()) return 'Enter the address';
  if (!v.dispatch_mode) return optional ? null : 'Choose how it travels';
  if (v.dispatch_mode === 'technician' && !v.technician_user_id) return 'Choose the technician';
  if (strict && v.dispatch_mode === 'courier' && (!v.courier_name.trim() || !v.awb_number.trim())) return 'Courier name and AWB are needed';
  if (strict && v.dispatch_mode === 'porter' && !v.porter_tracking_id.trim() && !v.porter_order_id.trim()) return 'Enter the Porter booking / order id';
  return null;
}

/** Body fields for the API (ids as numbers). */
export function dispatchBody(v) {
  return {
    dispatch_mode: v.dispatch_mode || undefined,
    technician_user_id: v.dispatch_mode === 'technician' && v.technician_user_id ? Number(v.technician_user_id) : undefined,
    courier_name: v.dispatch_mode === 'courier' ? v.courier_name.trim() || undefined : undefined,
    awb_number: v.dispatch_mode === 'courier' ? v.awb_number.trim() || undefined : undefined,
    porter_tracking_id: v.dispatch_mode === 'porter' ? v.porter_tracking_id.trim() || undefined : undefined,
    porter_order_id: v.dispatch_mode === 'porter' ? v.porter_order_id.trim() || undefined : undefined,
  };
}

export default function DispatchFields({ value, onChange, technicians = [], showAddress = true, addressLabel = 'Address', optional = false }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const setA = (k) => (e) => onChange({ ...value, address: { ...value.address, [k]: e.target.value } });
  const techs = technicians.filter((t) => t.assignee_kind === 'technician')
    .sort((a, b) => (a.open_item_count - b.open_item_count) || String(a.name).localeCompare(b.name));
  return (
    <FormGrid cols={2}>
      <Field label="How it travels" required={!optional} span={2}>
        <Select value={value.dispatch_mode} onChange={set('dispatch_mode')} placeholder={optional ? 'Decide later' : 'Choose…'} options={MODES} />
      </Field>
      {value.dispatch_mode === 'technician' && (
        <Field label="Technician" required span={2} hint="Least busy first">
          <Select
            value={String(value.technician_user_id || '')}
            onChange={set('technician_user_id')}
            placeholder="Choose…"
            options={techs.map((t) => ({ value: String(t.user_id), label: `${t.name} — ${t.open_item_count} open` }))}
          />
        </Field>
      )}
      {value.dispatch_mode === 'courier' && (
        <>
          <Field label="Courier"><Input value={value.courier_name} onChange={set('courier_name')} /></Field>
          <Field label="AWB / tracking"><Input value={value.awb_number} onChange={set('awb_number')} /></Field>
        </>
      )}
      {value.dispatch_mode === 'porter' && (
        <>
          <Field label="Porter tracking id"><Input value={value.porter_tracking_id} onChange={set('porter_tracking_id')} /></Field>
          <Field label="Porter order id"><Input value={value.porter_order_id} onChange={set('porter_order_id')} /></Field>
        </>
      )}
      {showAddress && (
        <>
          <Field label="Contact name"><Input value={value.address.name} onChange={setA('name')} /></Field>
          <Field label="Contact phone"><Input value={value.address.phone} onChange={(e) => onChange({ ...value, address: { ...value.address, phone: e.target.value.replace(/\D/g, '').slice(0, 10) } })} inputMode="numeric" /></Field>
          <Field label={addressLabel} required span={2}><Textarea rows={2} value={value.address.address} onChange={setA('address')} /></Field>
          <Field label="City"><Input value={value.address.city} onChange={setA('city')} /></Field>
          <Field label="State"><Input value={value.address.state} onChange={setA('state')} /></Field>
          <Field label="Pincode"><Input value={value.address.pincode} onChange={(e) => onChange({ ...value, address: { ...value.address, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) } })} inputMode="numeric" /></Field>
        </>
      )}
    </FormGrid>
  );
}
