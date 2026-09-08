import React from 'react';
import { formatIndianMobileInput, indianMobileError } from '../../../utils/phoneValidation';

const SHIP_OPTIONS = [
  { value: 'by_hand', label: 'Inhouse' },
  { value: 'by_courier', label: 'Courier' },
  { value: 'by_porter', label: 'Porter' },
  { value: 'by_vendor_pickup', label: 'Vendor Pickup' },
];

export function shipByToDispatchMode(shipBy) {
  if (shipBy === 'by_hand') return 'inhouse';
  if (shipBy === 'by_porter') return 'porter';
  if (shipBy === 'by_vendor_pickup') return 'vendor_pickup';
  return 'courier';
}

export function validateVrdcDispatch(shipBy, fields) {
  if (!shipBy) return 'Select how laptops will be sent to the vendor';
  if (shipBy === 'by_courier' && !fields.courier_name?.trim()) {
    return 'Courier name is required';
  }
  if (shipBy === 'by_porter' && !fields.porter_tracking_id?.trim()) {
    return 'Porter tracking / booking ID is required';
  }
  if (shipBy === 'by_hand' && !fields.delivery_person_id) {
    return 'Select a delivery person for Inhouse dispatch';
  }
  if (shipBy === 'by_hand' && !String(fields.vehicle_number || '').trim()) {
    return 'Vehicle number is required for Inhouse / delivery boy dispatch';
  }
  if (shipBy === 'by_vendor_pickup') {
    if (!fields.vendor_pickup_person?.trim()) {
      return 'Vendor pickup person name is required';
    }
    const mobileErr = indianMobileError(fields.vendor_pickup_mobile, { label: 'Vendor pickup mobile' });
    if (mobileErr) return mobileErr;
  }
  return null;
}

export default function VrdcDispatchFields({
  shipBy,
  onShipByChange,
  fields,
  onFieldsChange,
  deliveryTechnicians = [],
  disabled = false,
}) {
  const set = (k) => (e) => onFieldsChange({ ...fields, [k]: e.target.value });

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Send mode *</label>
        <select
          className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
          value={shipBy}
          onChange={(e) => onShipByChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">Select mode…</option>
          {SHIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {shipBy === 'by_courier' ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
              placeholder="Courier name *"
              value={fields.courier_name || ''}
              onChange={set('courier_name')}
              disabled={disabled}
            />
            <input
              className="border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
              placeholder="AWB number"
              value={fields.awb_number || ''}
              onChange={set('awb_number')}
              disabled={disabled}
            />
          </div>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
            placeholder="Tracking URL (optional)"
            value={fields.courier_tracking_url || ''}
            onChange={set('courier_tracking_url')}
            disabled={disabled}
          />
        </div>
      ) : null}

      {shipBy === 'by_porter' ? (
        <div className="space-y-2">
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
            placeholder="Porter booking / tracking ID *"
            value={fields.porter_tracking_id || ''}
            onChange={set('porter_tracking_id')}
            disabled={disabled}
          />
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
            placeholder="Porter order ID (optional)"
            value={fields.porter_order_id || ''}
            onChange={set('porter_order_id')}
            disabled={disabled}
          />
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
            placeholder="Booking URL (optional)"
            value={fields.porter_booking_url || ''}
            onChange={set('porter_booking_url')}
            disabled={disabled}
          />
        </div>
      ) : null}

      {shipBy === 'by_hand' ? (
        <div className="space-y-2">
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
            value={fields.delivery_person_id || ''}
            onChange={set('delivery_person_id')}
            disabled={disabled}
          >
            <option value="">Select delivery person *</option>
            {deliveryTechnicians.filter((t) => t.is_active !== false).map((t) => (
              <option key={t.technician_id} value={t.technician_id}>
                {[t.first_name, t.last_name].filter(Boolean).join(' ')}
                {t.phone ? ` — ${t.phone}` : ''}
              </option>
            ))}
          </select>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono uppercase disabled:bg-slate-50"
            placeholder="Vehicle number *"
            value={fields.vehicle_number || ''}
            onChange={(e) => onFieldsChange({
              ...fields,
              vehicle_number: e.target.value.toUpperCase().replace(/\s+/g, ''),
            })}
            disabled={disabled}
            maxLength={20}
          />
          {!deliveryTechnicians.length ? (
            <p className="text-xs text-amber-600 mt-1">No delivery technicians found. Add via Delivery Technicians.</p>
          ) : null}
        </div>
      ) : null}

      {shipBy === 'by_vendor_pickup' ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            Vendor will send their own person to collect from the warehouse.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
              placeholder="Collector name *"
              value={fields.vendor_pickup_person || ''}
              onChange={set('vendor_pickup_person')}
              disabled={disabled}
            />
            <input
              className="border rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
              placeholder="Collector mobile *"
              value={fields.vendor_pickup_mobile || ''}
              onChange={(e) => onFieldsChange({
                ...fields,
                vendor_pickup_mobile: formatIndianMobileInput(e.target.value),
              })}
              disabled={disabled}
              maxLength={10}
              inputMode="numeric"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
