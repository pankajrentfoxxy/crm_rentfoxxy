import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';

/**
 * CreatePickupModal — support lead creates a pickup (repair or return).
 * Selects type -> address -> dispatch method, then auto-creates a Return DC
 * and a customer OTP on submit (POST /support/tickets/:id/pickup).
 */
export default function CreatePickupModal({ ticket, items = [], onCreated, onClose }) {
  const [pickupType, setPickupType] = useState('');
  const [dispatchMode, setDispatchMode] = useState('');
  const [sourceItemId, setSourceItemId] = useState('');
  const [pickupAddress, setPickupAddress] = useState({
    name: '', phone: '', address: '', city: '', state: '', pincode: ''
  });
  const [technicianId, setTechnicianId] = useState('');
  const [courier, setCourier] = useState({ name: '', awb: '' });
  const [porter, setPorter] = useState({ tracking_id: '', order_id: '' });
  const [technicians, setTechnicians] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/support/technicians')
      .then((r) => setTechnicians(r.data.technicians || []))
      .catch(() => setTechnicians([]));
    setPickupAddress((a) => ({
      ...a,
      name: ticket?.customer_name || a.name,
      phone: ticket?.display_phone || ticket?.customer_phone || a.phone,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Complaint / replacement items provide the laptop being picked up.
  const sourceItems = items.filter((i) => i.item_type === 'complaint' || i.item_type === 'replacement');

  const canSubmit = pickupType && dispatchMode && pickupAddress.address.trim()
    && (dispatchMode !== 'technician' || technicianId);

  const submit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/support/tickets/${ticket.id}/pickup`, {
        pickup_type: pickupType,
        source_item_id: sourceItemId || null,
        pickup_address: pickupAddress,
        dispatch_mode: dispatchMode,
        technician_user_id: dispatchMode === 'technician' ? technicianId : null,
        courier_name: dispatchMode === 'courier' ? courier.name : null,
        awb_number: dispatchMode === 'courier' ? courier.awb : null,
        porter_tracking_id: dispatchMode === 'porter' ? porter.tracking_id : null,
        porter_order_id: dispatchMode === 'porter' ? porter.order_id : null,
      });
      toast.success(`Pickup created. Return DC ${data.return_dc_number}`);
      onCreated?.(data);
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to create pickup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-gray-900">Create Pickup</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Pickup type */}
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

          {/* Source item */}
          {sourceItems.length > 0 && (
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">Linked laptop (optional)</label>
              <select
                value={sourceItemId}
                onChange={(e) => setSourceItemId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="">Use ticket laptop / not linked</option>
                {sourceItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.ttspl_id || i.unique_serial_number || i.serial_number} — {i.brand} {i.model}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Pickup address */}
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-2">Pickup Address*</label>
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

          {/* Dispatch method */}
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
        </div>

        <div className="p-4 border-t sticky bottom-0 bg-white">
          <button
            type="button"
            disabled={!canSubmit || saving}
            onClick={submit}
            className="w-full py-4 bg-orange-600 text-white rounded-2xl font-bold text-base disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Creating…' : 'Create Pickup + Return DC'}
          </button>
        </div>
      </div>
    </div>
  );
}
