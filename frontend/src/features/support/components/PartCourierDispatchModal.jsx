import React, { useState } from 'react';
import { X, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { approveAndGenerateCustomerDc } from '../supportPartsApi';

export default function PartCourierDispatchModal({
  open,
  onClose,
  requests,
  instanceMap,
  onSuccess,
}) {
  const [courierName, setCourierName] = useState('');
  const [awbNumber, setAwbNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [billingType, setBillingType] = useState('under_warranty');
  const [chargeAmount, setChargeAmount] = useState('');
  const [tampered, setTampered] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!courierName.trim()) {
      toast.error('Courier name is required');
      return;
    }
    if (billingType === 'charge_customer' && !(Number(chargeAmount) > 0)) {
      toast.error('Enter charge amount for customer billing');
      return;
    }
    setBusy(true);
    try {
      const { data } = await approveAndGenerateCustomerDc({
        request_ids: requests.map((r) => r.id),
        instance_map: instanceMap,
        ship_by: 'by_courier',
        courier_name: courierName.trim(),
        awb_number: awbNumber.trim() || null,
        courier_tracking_url: trackingUrl.trim() || null,
        billing_type: billingType,
        charge_amount: billingType === 'charge_customer' ? Number(chargeAmount) : 0,
        tampered_by_customer: tampered,
      });
      toast.success(data.message || `Part DC ${data.dc_number} created`);
      onSuccess?.(data);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to create Part DC');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-[#534AB7]" />
            <h3 className="font-semibold text-gray-900">Send Part to Customer (Courier)</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-800">
            <p className="font-medium">{requests.length} part request(s)</p>
            <ul className="mt-1 text-xs space-y-0.5">
              {requests.map((r) => (
                <li key={r.id}>
                  {r.part_name} · {r.ttspl_id || r.ticket_number}
                  {r.fulfillment_mode === 'courier_to_customer' && (
                    <span className="ml-1 text-blue-600">(Courier)</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs mt-2 text-blue-700">
              A Part DC (PDC) will be generated with customer billing/shipping address, GST, and SO tag.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Billing</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBillingType('under_warranty')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm border ${
                  billingType === 'under_warranty'
                    ? 'border-green-600 bg-green-50 text-green-800 font-semibold'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                Under warranty (no charge)
              </button>
              <button
                type="button"
                onClick={() => setBillingType('charge_customer')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm border ${
                  billingType === 'charge_customer'
                    ? 'border-amber-600 bg-amber-50 text-amber-800 font-semibold'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                Charge customer
              </button>
            </div>
          </div>

          {billingType === 'charge_customer' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Charge amount (Rs.)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={chargeAmount}
                  onChange={(e) => setChargeAmount(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Amount to invoice customer"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={tampered} onChange={(e) => setTampered(e.target.checked)} />
                Customer tampering (charge applies)
              </label>
            </div>
          )}

          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase">Courier details</p>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Courier name *"
              value={courierName}
              onChange={(e) => setCourierName(e.target.value)}
            />
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="AWB / tracking number"
              value={awbNumber}
              onChange={(e) => setAwbNumber(e.target.value)}
            />
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Tracking URL (optional)"
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="border-t px-4 py-3 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="px-4 py-2 bg-[#534AB7] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Generate Part DC & Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}
