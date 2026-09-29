import React from 'react';
import {
  Field, FormGrid, Input, Notice, Segmented, Select,
} from '../../../components/carret';
import { formatIndianMobileInput } from '../../../utils/phoneValidation';

/**
 * How a return or repair challan travels — the Carret take on
 * vendor-management/components/VrtdcTransportFields. Same props, same `fields`
 * shape and the same validator (re-exported from the old file, so the rules
 * the server checks in vrtdcTransportFromBody live in one place):
 *
 *   Courier        courier name + tracking ID (AWB)
 *   Porter         person, phone, bike / vehicle number (booking ID optional)
 *   Vendor pickup  person, phone, bike / vehicle number
 *   In-house       our delivery person, phone, bike / vehicle number — it shows
 *                  in their technician bucket once the guard scans it out
 */
export { validateVrtdcTransport } from '../../vendor-management/components/VrtdcTransportFields';

const MODES = [
  { value: 'by_courier', label: 'Courier' },
  { value: 'by_porter', label: 'Porter' },
  { value: 'by_hand', label: 'In-house' },
  { value: 'by_vendor_pickup', label: 'Vendor pickup' },
];

const techName = (t) => [t.first_name, t.last_name].filter(Boolean).join(' ') || `#${t.technician_id}`;

export default function VrtdcTransportFields({
  shipBy,
  onShipByChange,
  fields,
  onFieldsChange,
  deliveryTechnicians = [],
  disabled = false,
}) {
  const set = (k) => (e) => onFieldsChange({ ...fields, [k]: e.target.value });
  const setPhone = (k) => (e) => onFieldsChange({ ...fields, [k]: formatIndianMobileInput(e.target.value) });
  const setVehicle = (e) => onFieldsChange({ ...fields, vehicle_number: e.target.value.toUpperCase().replace(/\s+/g, '') });

  const vehicle = (
    <Field label="Bike / vehicle number" required>
      <Input className="font-mono" value={fields.vehicle_number || ''} onChange={setVehicle} disabled={disabled} maxLength={20} placeholder="HR26AB1234" />
    </Field>
  );
  const person = (nameKey, phoneKey, who) => (
    <>
      <Field label={`${who} name`} required><Input value={fields[nameKey] || ''} onChange={set(nameKey)} disabled={disabled} maxLength={120} /></Field>
      <Field label={`${who} phone`} required><Input value={fields[phoneKey] || ''} onChange={setPhone(phoneKey)} disabled={disabled} maxLength={10} inputMode="numeric" /></Field>
    </>
  );

  // Picking our delivery person fills their phone; it stays editable.
  const pickTech = (e) => {
    const id = e.target.value;
    const t = deliveryTechnicians.find((x) => String(x.technician_id) === String(id));
    onFieldsChange({ ...fields, delivery_person_id: id, delivery_person_phone: t?.phone ? formatIndianMobileInput(String(t.phone)) : '' });
  };

  return (
    <div className="c-stack">
      <div className="c-field">
        <span className="c-label">How it travels<span className="c-req" aria-hidden="true"> *</span></span>
        <div><Segmented label="How it travels" options={MODES} value={shipBy} onChange={disabled ? undefined : onShipByChange} /></div>
      </div>

      {shipBy === 'by_courier' && (
        <FormGrid cols={2}>
          <Field label="Courier name" required><Input value={fields.courier_name || ''} onChange={set('courier_name')} disabled={disabled} placeholder="Blue Dart, DTDC…" /></Field>
          <Field label="Tracking ID (AWB)" required><Input className="font-mono" value={fields.awb_number || ''} onChange={set('awb_number')} disabled={disabled} /></Field>
          <Field label="Tracking link" hint="Optional" span={2}><Input value={fields.courier_tracking_url || ''} onChange={set('courier_tracking_url')} disabled={disabled} /></Field>
        </FormGrid>
      )}

      {shipBy === 'by_porter' && (
        <FormGrid cols={2}>
          {person('porter_person_name', 'porter_person_phone', 'Porter person')}
          {vehicle}
          <Field label="Porter booking ID" hint="Optional"><Input className="font-mono" value={fields.porter_tracking_id || ''} onChange={set('porter_tracking_id')} disabled={disabled} /></Field>
        </FormGrid>
      )}

      {shipBy === 'by_vendor_pickup' && (
        <>
          <p className="text-ink-3">The vendor&apos;s own person collects from our warehouse.</p>
          <FormGrid cols={2}>
            {person('vendor_pickup_person', 'vendor_pickup_mobile', 'Pickup person')}
            {vehicle}
          </FormGrid>
        </>
      )}

      {shipBy === 'by_hand' && (
        <>
          <FormGrid cols={2}>
            <Field label="Our delivery person" required>
              <Select
                value={String(fields.delivery_person_id || '')}
                onChange={pickTech}
                disabled={disabled}
                placeholder="Choose…"
                options={deliveryTechnicians.filter((t) => t.is_active !== false).map((t) => ({ value: String(t.technician_id), label: techName(t) }))}
              />
            </Field>
            <Field label="Phone" required><Input value={fields.delivery_person_phone || ''} onChange={setPhone('delivery_person_phone')} disabled={disabled} maxLength={10} inputMode="numeric" /></Field>
            {vehicle}
          </FormGrid>
          <p className="text-ink-3">After the guard scans it out, it appears in this person&apos;s technician bucket to deliver.</p>
          {!deliveryTechnicians.length && <Notice tone="warn">No delivery people found — add them under Delivery technicians.</Notice>}
        </>
      )}
    </div>
  );
}
