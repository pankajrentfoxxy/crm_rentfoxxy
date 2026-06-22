import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import PickupSetupForm from './PickupSetupForm';

function machineFromSourceItem(item) {
  return {
    source_item_id: item.id,
    serial_number: item.serial_number,
    unique_serial_number: item.ttspl_id || item.unique_serial_number,
    ttspl_id: item.ttspl_id || item.unique_serial_number,
    brand: item.brand,
    model: item.model,
    ram: item.ram,
    storage: item.storage,
    generation: item.generation,
    customer_inventory_id: item.customer_inventory_id,
  };
}

function machineFromAsset(asset) {
  return {
    serial_number: asset.serial_number,
    unique_serial_number: asset.unique_serial_number,
    ttspl_id: asset.unique_serial_number,
    brand: asset.model_name?.split(' ')[0] || '',
    model: asset.model_name,
    ram: asset.ram,
    storage: asset.storage,
    generation: asset.generation,
  };
}

/**
 * Schedule a pickup on an existing ticket — creates pickup item(s) + Return DC + assignment.
 * Supports multiple laptops on one visit (same customer, location, technician).
 */
export default function CreatePickupModal({ ticket, items = [], sourceItem: sourceItemProp, onCreated, onClose }) {
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState(new Set());
  const [selectedSourceIds, setSelectedSourceIds] = useState(new Set());

  const sourceItem = sourceItemProp ?? null;
  const activePickupSourceIds = new Set(
    (items || [])
      .filter((i) => i.item_type === 'pickup' && !['resolved', 'closed', 'inventory_updated'].includes(i.status))
      .map((i) => i.source_item_id)
      .filter(Boolean)
  );

  useEffect(() => {
    if (sourceItem) {
      setSelectedSourceIds(new Set([String(sourceItem.id)]));
    }
  }, [sourceItem]);

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

  const toggleAsset = (id) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSource = (id) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedMachines = sourceItem
    ? [machineFromSourceItem(sourceItem)]
    : linkableItems.length
      ? linkableItems
          .filter((i) => selectedSourceIds.has(String(i.id)))
          .map(machineFromSourceItem)
      : assets
          .filter((a) => selectedAssetIds.has(String(a.id)))
          .map(machineFromAsset);

  const submit = async (payload) => {
    if (!selectedMachines.length) {
      toast.error('Select at least one laptop for this pickup');
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...payload,
        machines: selectedMachines,
        source_item_id: selectedMachines.length === 1 ? selectedMachines[0].source_item_id : null,
      };
      const { data } = await api.post(`/support/tickets/${ticket.id}/pickup`, body);
      const n = data.unit_count || selectedMachines.length;
      toast.success(`Pickup scheduled for ${n} laptop(s). Return DC ${data.return_dc_number}`);
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
          {sourceItem ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Laptop</p>
              <p className="font-mono font-semibold">{sourceItem.ttspl_id || sourceItem.unique_serial_number}</p>
            </div>
          ) : linkableItems.length > 0 ? (
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">
                Select laptop(s) from ticket*
              </label>
              <div className="space-y-2 max-h-40 overflow-y-auto border rounded-xl p-2">
                {linkableItems.map((item) => (
                  <label key={item.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.has(String(item.id))}
                      onChange={() => toggleSource(String(item.id))}
                      className="mt-1"
                    />
                    <div className="text-sm">
                      <p className="font-mono font-medium">{item.ttspl_id || item.unique_serial_number || item.serial_number}</p>
                      <p className="text-xs text-gray-500">{[item.brand, item.model].filter(Boolean).join(' ')}</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">{selectedSourceIds.size} selected — one Return DC for all</p>
            </div>
          ) : (
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">Select laptop(s)*</label>
              <div className="space-y-2 max-h-40 overflow-y-auto border rounded-xl p-2">
                {assets.map((a) => (
                  <label key={a.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAssetIds.has(String(a.id))}
                      onChange={() => toggleAsset(String(a.id))}
                      className="mt-1"
                    />
                    <div className="text-sm">
                      <p className="font-mono font-medium">{a.unique_serial_number || a.serial_number}</p>
                      <p className="text-xs text-gray-500">{a.model_name}</p>
                    </div>
                  </label>
                ))}
              </div>
              {!assets.length && <p className="text-sm text-gray-400">No customer laptops found.</p>}
              <p className="text-xs text-gray-500 mt-1">{selectedAssetIds.size} selected — one Return DC for all</p>
            </div>
          )}

          <PickupSetupForm
            ticket={ticket}
            customerId={ticket?.customer_id}
            selectedMachines={selectedMachines}
            onSubmit={submit}
            saving={saving}
            submitLabel={`Schedule Pickup + Return DC${selectedMachines.length > 1 ? ` (${selectedMachines.length} units)` : ''}`}
          />
        </div>
      </div>
    </div>
  );
}
