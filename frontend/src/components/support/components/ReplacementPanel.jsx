import React, { useEffect, useState } from 'react';
import api from '../../../utils/api';

export default function ReplacementPanel({ ticketId, sourceItem, customerId, onDone, onCancel }) {
  const [assets, setAssets] = useState([]);
  const [assetId, setAssetId] = useState('');
  const [reason, setReason] = useState(sourceItem.replacement_flag_reason || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/support/customers/${customerId}/available-assets`).then((r) => setAssets(r.data.assets || [])).catch(() => setAssets([]));
  }, [customerId]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/support/tickets/${ticketId}/replacements`, {
        source_item_id: sourceItem.id,
        new_customer_inventory_id: Number(assetId),
        reason
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white border border-pink-200 rounded-xl p-4 space-y-3">
      <h3 className="font-semibold text-pink-900">Initiate replacement</h3>
      <p className="text-sm">{sourceItem.model} · {sourceItem.unique_serial_number || sourceItem.serial_number}</p>
      <select className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
        <option value="">Select replacement machine</option>
        {assets.map((a) => (
          <option key={a.id} value={a.id}>{a.model_name} · {a.unique_serial_number || a.serial_number}</option>
        ))}
      </select>
      <textarea className="w-full border rounded-lg p-3 min-h-[72px] text-base" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="support-btn-primary" disabled={!assetId || busy} onClick={submit}>Confirm & create replacement order</button>
        <button type="button" className="support-btn-outline" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
