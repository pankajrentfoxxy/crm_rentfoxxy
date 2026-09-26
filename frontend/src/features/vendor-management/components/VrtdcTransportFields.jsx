import React from 'react';
import { formatIndianMobileInput, indianMobileError } from '../../../utils/phoneValidation';

/**
 * How a return challan (VRTDC) travels — the rules the server checks in
 * vendorReturnToVendorService.vrtdcTransportFromBody. Same props as
 * VrdcDispatchFields (the repair challan keeps that one and its own rules).
 *
 *   Courier        courier name + tracking ID (AWB)
 *   Porter         person, phone, bike / vehicle number (booking ID optional)
 *   Vendor pickup  person, phone, bike / vehicle number
 *   In-house       our delivery person, phone, bike / vehicle number — it shows
 *                  in their technician bucket once the guard scans it out
 */
const MODES = [
  { value: 'by_courier', label: 'Courier' },
  { value: 'by_porter', label: 'Porter' },
  { value: 'by_hand', label: 'In-house' },
  { value: 'by_vendor_pickup', label: 'Vendor pickup' },
];

const techName = (t) => [t.first_name, t.last_name].filter(Boolean).join(' ') || `#${t.technician_id}`;

export function validateVrtdcTransport(shipBy, f = {}) {
  const blank = (v) => !String(v || '').trim();
  if (!shipBy) return 'Choose how it travels';
  if (shipBy === 'by_courier') {
    if (blank(f.courier_name)) return 'Courier name is required';
    if (blank(f.awb_number)) return 'Courier tracking ID (AWB) is required';
    return null;
  }
  const people = {
    by_porter: ['porter_person_name', 'porter_person_phone', 'Porter person'],
    by_vendor_pickup: ['vendor_pickup_person', 'vendor_pickup_mobile', 'Vendor pickup person'],
    by_hand: [null, 'delivery_person_phone', 'Delivery person'],
  }[shipBy];
  if (!people) return 'Choose how it travels';
  const [nameKey, phoneKey, label] = people;
  if (shipBy === 'by_hand' && !f.delivery_person_id) return 'Choose our delivery person';
  if (nameKey && blank(f[nameKey])) return `${label} name is required`;
  const phoneErr = indianMobileError(f[phoneKey], { label: `${label} phone`, required: true });
  if (phoneErr) return phoneErr;
  if (blank(f.vehicle_number)) return 'Bike / vehicle number is required';
  return null;
}

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
  const inputCls = 'border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50 w-full';
  const label = (text) => <span className="block text-xs font-medium text-slate-600 mb-1">{text}</span>;

  const vehicle = (
    <label className="block">
      {label('Bike / vehicle number *')}
      <input
        className={`${inputCls} font-mono uppercase`}
        value={fields.vehicle_number || ''}
        onChange={(e) => onFieldsChange({ ...fields, vehicle_number: e.target.value.toUpperCase().replace(/\s+/g, '') })}
        disabled={disabled}
        maxLength={20}
        placeholder="HR26AB1234"
      />
    </label>
  );
  const person = (nameKey, phoneKey, who) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label className="block">
        {label(`${who} name *`)}
        <input className={inputCls} value={fields[nameKey] || ''} onChange={set(nameKey)} disabled={disabled} maxLength={120} />
      </label>
      <label className="block">
        {label(`${who} phone *`)}
        <input className={inputCls} value={fields[phoneKey] || ''} onChange={setPhone(phoneKey)} disabled={disabled} maxLength={10} inputMode="numeric" />
      </label>
    </div>
  );

  const pickTech = (e) => {
    const id = e.target.value;
    const t = deliveryTechnicians.find((x) => String(x.technician_id) === String(id));
    onFieldsChange({ ...fields, delivery_person_id: id, delivery_person_phone: t?.phone ? formatIndianMobileInput(String(t.phone)) : '' });
  };

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="How it travels" className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={shipBy === m.value}
            disabled={disabled}
            onClick={() => onShipByChange(m.value)}
            className={`px-3 py-1.5 rounded-lg border text-sm ${shipBy === m.value ? 'border-teal-700 bg-teal-50 text-teal-800 font-semibold' : 'border-slate-300 text-slate-700'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {shipBy === 'by_courier' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">{label('Courier name *')}<input className={inputCls} value={fields.courier_name || ''} onChange={set('courier_name')} disabled={disabled} placeholder="Blue Dart, DTDC…" /></label>
          <label className="block">{label('Tracking ID (AWB) *')}<input className={`${inputCls} font-mono`} value={fields.awb_number || ''} onChange={set('awb_number')} disabled={disabled} /></label>
          <label className="block sm:col-span-2">{label('Tracking link (optional)')}<input className={inputCls} value={fields.courier_tracking_url || ''} onChange={set('courier_tracking_url')} disabled={disabled} /></label>
        </div>
      )}

      {shipBy === 'by_porter' && (
        <div className="space-y-2">
          {person('porter_person_name', 'porter_person_phone', 'Porter person')}
          {vehicle}
          <label className="block">{label('Porter booking ID (optional)')}<input className={`${inputCls} font-mono`} value={fields.porter_tracking_id || ''} onChange={set('porter_tracking_id')} disabled={disabled} /></label>
        </div>
      )}

      {shipBy === 'by_vendor_pickup' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">The vendor's own person collects from our warehouse.</p>
          {person('vendor_pickup_person', 'vendor_pickup_mobile', 'Pickup person')}
          {vehicle}
        </div>
      )}

      {shipBy === 'by_hand' && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              {label('Our delivery person *')}
              <select className={inputCls} value={fields.delivery_person_id || ''} onChange={pickTech} disabled={disabled}>
                <option value="">Choose…</option>
                {deliveryTechnicians.filter((t) => t.is_active !== false).map((t) => (
                  <option key={t.technician_id} value={t.technician_id}>{techName(t)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              {label('Phone *')}
              <input className={inputCls} value={fields.delivery_person_phone || ''} onChange={setPhone('delivery_person_phone')} disabled={disabled} maxLength={10} inputMode="numeric" />
            </label>
          </div>
          {vehicle}
          <p className="text-xs text-slate-600">After the guard scans it out, it appears in this person's technician bucket to deliver.</p>
          {!deliveryTechnicians.length && <p className="text-xs text-amber-700">No delivery people found — add them under Delivery technicians.</p>}
        </div>
      )}
    </div>
  );
}
