import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import PickupSetupForm from './PickupSetupForm';

/**
 * Schedule a pickup on an existing ticket — creates pickup item + Return DC + assignment.
 */
export default function CreatePickupModal({ ticket, items = [], sourceItem: sourceItemProp, onCreated, onClose }) {
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState([]);
  const [assetId, setAssetId] = useState('');

  const sourceItem = sourceItemProp ?? null;
  const activePickupSourceIds = new Set(
    (items || [])
      .filter((i) => i.item_type === 'pickup' && !['resolved', 'closed', 'inventory_updated'].includes(i.status))
      .map((i) => i.source_item_id)
      .filter(Boolean)
  );

  useEffect(() => {
    if (sourceItem || !ticket?.customer_id) return;
    api.get(`/support/customers/${ticket.customer_id}/assets`)
      .then((r) => setAssets(r.data.assets || []))
      .catch(() => setAssets([]));
  }, [sourceItem, ticket?.customer_id]);

  const linkableItems = (items || []).filter(
    (i) => (i.item_type === 'complaint' || i.item_type === 'replacement')
      && !activePickupSourceIds.has(i.id)
  );

  const selectedAsset = !sourceItem && assetId
    ? assets.find((a) => String(a.id) === String(assetId))
    : null;

  const effectiveSource = sourceItem
    || (linkableItems.length === 1 ? linkableItems[0] : null);

  const submit = async (payload) => {
    if (!effectiveSource && !selectedAsset) {
      toast.error('Select a laptop for this pickup');
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...payload,
        source_item_id: effectiveSource?.id || null,
      };
      if (selectedAsset) {
        body.serial_number = selectedAsset.serial_number;
        body.unique_serial_number = selectedAsset.unique_serial_number;
        body.ttspl_id = selectedAsset.unique_serial_number;
        body.brand = selectedAsset.model_name?.split(' ')[0] || '';
        body.model = selectedAsset.model_name;
        body.ram = selectedAsset.ram;
        body.storage = selectedAsset.storage;
        body.generation = selectedAsset.generation;
      }
      const { data } = await api.post(`/support/tickets/${ticket.id}/pickup`, body);
      toast.success(`Pickup scheduled. Return DC ${data.return_dc_number}`);
      onCreated?.(data);
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to schedule pickup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-gray-900">Schedule Pickup</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {!effectiveSource && linkableItems.length > 1 && (
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">Link to ticket item*</label>
              <select
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                value={effectiveSource?.id || ''}
                onChange={() => {}}
                disabled
              >
                <option value="">Select from complaint tab items via &quot;Schedule pickup for this machine&quot;</option>
              </select>
            </div>
          )}
          {!effectiveSource && (
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">Laptop*</label>
              <select
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="">Select customer laptop…</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.unique_serial_number || a.serial_number} — {a.model_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <PickupSetupForm
            ticket={ticket}
            customerId={ticket?.customer_id}
            sourceItem={effectiveSource}
            selectedAsset={selectedAsset}
            onSubmit={submit}
            saving={saving}
            submitLabel="Schedule Pickup + Return DC"
          />
        </div>
      </div>
    </div>
  );
}
