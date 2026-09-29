import React from 'react';
import {
  Field, FormGrid, Input, Notice, Segmented, Select,
} from '../../../components/carret';
import { formatIndianMobileInput } from '../../../utils/phoneValidation';

/**
 * How a scrap or part-repair challan leaves — the Carret take on
 * floor-pipeline/components/VrdcDispatchFields. Same props, same `fields`
 * shape and the same validator (re-exported from the old file so the rules stay
 * in one place). `party` only changes the words for the collect-it-yourself
 * mode: "vendor" (default) or "buyer" on a scrap challan.
 */
export { validateVrdcDispatch, shipByToDispatchMode } from '../../floor-pipeline/components/VrdcDispatchFields';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default function VrdcDispatchFields({
  shipBy,
  onShipByChange,
  fields,
  onFieldsChange,
  deliveryTechnicians = [],
  disabled = false,
  party = 'vendor',
}) {
  const set = (k) => (e) => onFieldsChange({ ...fields, [k]: e.target.value });
  const setVehicle = (e) => onFieldsChange({ ...fields, vehicle_number: e.target.value.toUpperCase().replace(/\s+/g, '') });
  const modes = [
    { value: 'by_hand', label: 'In-house' },
    { value: 'by_courier', label: 'Courier' },
    { value: 'by_porter', label: 'Porter' },
    { value: 'by_vendor_pickup', label: `${cap(party)} pickup` },
  ];
  const vehicle = (
    <Field label="Vehicle number" required>
      <Input className="font-mono" value={fields.vehicle_number || ''} onChange={setVehicle} disabled={disabled} maxLength={20} />
    </Field>
  );

  return (
    <div className="c-stack">
      <div className="c-field">
        <span className="c-label">Send by<span className="c-req" aria-hidden="true"> *</span></span>
        <div><Segmented label="Send by" options={modes} value={shipBy} onChange={disabled ? undefined : onShipByChange} /></div>
      </div>

      {shipBy === 'by_courier' && (
        <FormGrid cols={3}>
          <Field label="Courier" required><Input value={fields.courier_name || ''} onChange={set('courier_name')} disabled={disabled} /></Field>
          <Field label="AWB number"><Input className="font-mono" value={fields.awb_number || ''} onChange={set('awb_number')} disabled={disabled} /></Field>
          <Field label="Tracking link" hint="Optional"><Input value={fields.courier_tracking_url || ''} onChange={set('courier_tracking_url')} disabled={disabled} /></Field>
        </FormGrid>
      )}

      {shipBy === 'by_porter' && (
        <FormGrid cols={3}>
          <Field label="Porter booking / tracking ID" required><Input className="font-mono" value={fields.porter_tracking_id || ''} onChange={set('porter_tracking_id')} disabled={disabled} /></Field>
          <Field label="Porter order ID" hint="Optional"><Input value={fields.porter_order_id || ''} onChange={set('porter_order_id')} disabled={disabled} /></Field>
          <Field label="Booking link" hint="Optional"><Input value={fields.porter_booking_url || ''} onChange={set('porter_booking_url')} disabled={disabled} /></Field>
        </FormGrid>
      )}

      {shipBy === 'by_hand' && (
        <>
          <FormGrid cols={2}>
            <Field label="Delivery person" required>
              <Select
                value={String(fields.delivery_person_id || '')}
                onChange={set('delivery_person_id')}
                disabled={disabled}
                placeholder="Choose…"
                options={deliveryTechnicians.filter((t) => t.is_active !== false).map((t) => ({
                  value: String(t.technician_id),
                  label: `${[t.first_name, t.last_name].filter(Boolean).join(' ')}${t.phone ? ` — ${t.phone}` : ''}`,
                }))}
              />
            </Field>
            {vehicle}
          </FormGrid>
          {!deliveryTechnicians.length && <Notice tone="warn">No delivery people found — add them under Delivery technicians.</Notice>}
        </>
      )}

      {shipBy === 'by_vendor_pickup' && (
        <>
          <p className="text-ink-3">The {party} sends their own person to collect from the warehouse.</p>
          <FormGrid cols={3}>
            <Field label="Collector name" required><Input value={fields.vendor_pickup_person || ''} onChange={set('vendor_pickup_person')} disabled={disabled} /></Field>
            <Field label="Collector mobile" required>
              <Input
                value={fields.vendor_pickup_mobile || ''}
                onChange={(e) => onFieldsChange({ ...fields, vendor_pickup_mobile: formatIndianMobileInput(e.target.value) })}
                disabled={disabled}
                maxLength={10}
                inputMode="numeric"
              />
            </Field>
            {vehicle}
          </FormGrid>
        </>
      )}
    </div>
  );
}
