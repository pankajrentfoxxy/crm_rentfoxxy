import React from 'react';

const SHIP_OPTIONS = [
  { value: 'by_hand', label: 'By Hand' },
  { value: 'by_courier', label: 'By Courier' },
  { value: 'by_porter', label: 'By Porter' },
];

export function shipByToDispatchMode(shipBy) {
  if (shipBy === 'by_hand') return 'inhouse';
  if (shipBy === 'by_porter') return 'porter';
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
    return 'Select a delivery person for By Hand dispatch';
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
        <div>
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
          {!deliveryTechnicians.length ? (
            <p className="text-xs text-amber-600 mt-1">No delivery technicians found. Add via Delivery Technicians.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
