import React, { useEffect, useState } from 'react';
import api from '../../../utils/api';

/**
 * Shared pickup configuration: type, DC delivery address, dispatch assignment.
 * Used by CreatePickupModal and the new-ticket pickup flow.
 */
export default function PickupSetupForm({
  ticket,
  customerId,
  sourceItem = null,
  selectedAsset = null,
  selectedMachines = null,
  onSubmit,
  saving = false,
  submitLabel = 'Create Pickup + Return DC',
}) {
  const [pickupType, setPickupType] = useState('');
  const [dispatchMode, setDispatchMode] = useState('');
  const [pickupAddress, setPickupAddress] = useState({
    name: '', phone: '', address: '', city: '', state: '', pincode: '',
  });
  const [technicianId, setTechnicianId] = useState('');
  const [courier, setCourier] = useState({ name: '', awb: '' });
  const [porter, setPorter] = useState({ tracking_id: '', order_id: '' });
  const [technicians, setTechnicians] = useState([]);
  const [loadingAddr, setLoadingAddr] = useState(false);
  const [dcRef, setDcRef] = useState(null);

  const machines = selectedMachines?.length
    ? selectedMachines
    : (sourceItem || selectedAsset ? [sourceItem || selectedAsset] : []);

  const machineCode = machines[0]?.ttspl_id
    || machines[0]?.unique_serial_number
    || machines[0]?.serial_number
    || ticket?.ttspl_id;

  useEffect(() => {
    api.get('/support/technicians')
      .then((r) => setTechnicians(r.data.technicians || []))
      .catch(() => setTechnicians([]));
  }, []);

  useEffect(() => {
    setPickupAddress((a) => ({
      ...a,
      name: ticket?.customer_name || a.name,
      phone: ticket?.display_phone || ticket?.customer_phone || ticket?.ticket_phone_override || a.phone,
    }));
  }, [ticket?.customer_name, ticket?.display_phone, ticket?.customer_phone, ticket?.ticket_phone_override]);

  useEffect(() => {
    const cid = customerId || ticket?.customer_id;
    if (!cid || !machineCode) return;
    setLoadingAddr(true);
    api.get(`/support/customers/${cid}/pickup-context`, { params: { ttspl: machineCode } })
      .then((r) => {
        if (r.data.found && r.data.pickup_address) {
          setPickupAddress((a) => ({
            ...a,
            ...r.data.pickup_address,
            phone: r.data.pickup_address.phone || a.phone,
          }));
          setDcRef({
            original_dc_number: r.data.original_dc_number,
            sales_order_number: r.data.sales_order_number,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoadingAddr(false));
  }, [customerId, ticket?.customer_id, machineCode]);

  const canSubmit = pickupType && dispatchMode && pickupAddress.address.trim()
    && (dispatchMode !== 'technician' || technicianId);

  const handleSubmit = () => {
    if (!canSubmit || saving) return;
    onSubmit({
      pickup_type: pickupType,
      source_item_id: sourceItem?.id || null,
      pickup_address: pickupAddress,
      dispatch_mode: dispatchMode,
      technician_user_id: dispatchMode === 'technician' ? technicianId : null,
      courier_name: dispatchMode === 'courier' ? courier.name : null,
      awb_number: dispatchMode === 'courier' ? courier.awb : null,
      porter_tracking_id: dispatchMode === 'porter' ? porter.tracking_id : null,
      porter_order_id: dispatchMode === 'porter' ? porter.order_id : null,
    });
  };

  return (
    <div className="space-y-5">
      {machines.length > 0 && !selectedMachines && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Laptop</p>
          <p className="font-mono font-semibold text-slate-800">{machineCode}</p>
        </div>
      )}

      {selectedMachines?.length > 1 && (
        <div className="rounded-xl bg-orange-50 border border-orange-200 p-3 text-sm">
          <p className="text-xs text-orange-600 uppercase tracking-wide mb-1">{selectedMachines.length} laptops — one visit</p>
          <ul className="space-y-1">
            {selectedMachines.map((m, i) => (
              <li key={m.ttspl_id || m.unique_serial_number || i} className="font-mono text-xs text-slate-700">
                {m.ttspl_id || m.unique_serial_number || m.serial_number}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label className="text-sm font-semibold text-gray-700 block mb-2">Pickup Type*</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'repair', icon: '🔧', label: 'Repair Pickup', desc: 'Take to warehouse for repair' },
            { value: 'return', icon: '🔄', label: 'Return Pickup', desc: 'Customer returning laptop' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPickupType(opt.value)}
              className={`p-3 border-2 rounded-xl text-left transition ${
                pickupType === opt.value ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="text-xl mb-1">{opt.icon}</p>
              <p className="font-semibold text-sm">{opt.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-gray-700">Pickup Address*</label>
          {loadingAddr && <span className="text-xs text-gray-400">Loading from DC…</span>}
        </div>
        {dcRef?.original_dc_number && (
          <p className="text-xs text-blue-600 mb-2">
            From outbound DC <span className="font-mono">{dcRef.original_dc_number}</span>
            {dcRef.sales_order_number ? ` · SO ${dcRef.sales_order_number}` : ''}
          </p>
        )}
        <div className="space-y-2">
          {[
            ['Contact name', 'name', 'text'],
            ['Phone', 'phone', 'tel'],
            ['Address', 'address', 'text'],
          ].map(([label, key, type]) => (
            <input
              key={key}
              type={type}
              value={pickupAddress[key]}
              onChange={(e) => setPickupAddress((a) => ({ ...a, [key]: e.target.value }))}
              placeholder={label}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
          ))}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[['City', 'city'], ['State', 'state'], ['Pincode', 'pincode']].map(([label, key]) => (
              <input
                key={key}
                value={pickupAddress[key]}
                onChange={(e) => setPickupAddress((a) => ({ ...a, [key]: e.target.value }))}
                placeholder={label}
                className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              />
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold text-gray-700 block mb-2">Dispatch Method*</label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: 'technician', icon: '👤', label: 'Technician' },
            { value: 'courier', icon: '🚚', label: 'Courier' },
            { value: 'porter', icon: '🛵', label: 'Porter' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDispatchMode(opt.value)}
              className={`p-3 border-2 rounded-xl text-center transition ${
                dispatchMode === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="text-xl mb-1">{opt.icon}</p>
              <p className="font-semibold text-xs">{opt.label}</p>
            </button>
          ))}
        </div>

        {dispatchMode === 'technician' && (
          <select
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-2"
          >
            <option value="">Select technician…</option>
            {technicians.map((t) => (
              <option key={t.user_id} value={t.user_id}>
                {t.name}{t.mobile_no ? ` — ${t.mobile_no}` : ''}
              </option>
            ))}
          </select>
        )}

        {dispatchMode === 'courier' && (
          <div className="space-y-2 mt-2">
            <input
              value={courier.name}
              onChange={(e) => setCourier((c) => ({ ...c, name: e.target.value }))}
              placeholder="Courier name"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
            <input
              value={courier.awb}
              onChange={(e) => setCourier((c) => ({ ...c, awb: e.target.value }))}
              placeholder="AWB number"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
          </div>
        )}

        {dispatchMode === 'porter' && (
          <div className="space-y-2 mt-2">
            <input
              value={porter.tracking_id}
              onChange={(e) => setPorter((p) => ({ ...p, tracking_id: e.target.value }))}
              placeholder="Porter tracking ID"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
            <input
              value={porter.order_id}
              onChange={(e) => setPorter((p) => ({ ...p, order_id: e.target.value }))}
              placeholder="Porter order ID (optional)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={!canSubmit || saving}
        onClick={handleSubmit}
        className="w-full py-4 bg-orange-600 text-white rounded-2xl font-bold text-base disabled:opacity-50 active:scale-[0.98]"
      >
        {saving ? 'Creating…' : submitLabel}
      </button>
    </div>
  );
}
