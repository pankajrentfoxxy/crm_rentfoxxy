import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { isReturnPickupEditable } from '../utils';

/**
 * Edit a scheduled Return DC — uncheck laptop(s) to defer (e.g. customer sends 2 today, 1 tomorrow).
 */
export default function EditPickupModal({ ticket, pickups = [], onSaved, onClose }) {
  const [saving, setSaving] = useState(false);
  const linked = useMemo(() => {
    const rdc = ticket?.return_dc_number;
    return (pickups || []).filter(
      (p) => p.item_type === 'pickup'
        && p.return_dc_number === rdc
        && !['resolved', 'closed', 'inventory_updated', 'cancelled'].includes(p.status)
    );
  }, [pickups, ticket?.return_dc_number]);

  const editable = linked.filter(isReturnPickupEditable);
  const [selected, setSelected] = useState(() => new Set(editable.map((p) => String(p.id))));

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async () => {
    const keepIds = [...selected].map((id) => parseInt(id, 10)).filter((id) => id > 0);
    if (!keepIds.length) {
      toast.error('Keep at least one laptop on this Return DC');
      return;
    }
    if (keepIds.length >= editable.length) {
      toast.error('Uncheck at least one laptop to defer to a later pickup');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.patch(`/support/tickets/${ticket.id}/return-pickup-machines`, {
        keep_pickup_item_ids: keepIds,
        return_dc_number: ticket.return_dc_number,
      });
      const removed = editable.length - keepIds.length;
      toast.success(data.message || `Return DC updated — ${removed} laptop(s) deferred`);
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to edit pickup');
    } finally {
      setSaving(false);
    }
  };

  if (!editable.length) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
          <p className="text-sm text-gray-700">This pickup can no longer be edited — guard has already scanned it inward or warehouse has received the units.</p>
          <button type="button" className="support-btn-primary mt-4 w-full min-h-[44px]" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-gray-900">Edit scheduled pickup</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600">
            Return DC <span className="font-mono font-semibold">{ticket.return_dc_number}</span>
            {' '}— uncheck laptop(s) the customer is <strong>not</strong> handing over today. They stay on the ticket for a later pickup.
          </p>
          <div className="space-y-2 border rounded-xl p-2 max-h-52 overflow-y-auto">
            {editable.map((item) => (
              <label key={item.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(String(item.id))}
                  onChange={() => toggle(item.id)}
                  className="mt-1"
                />
                <div className="text-sm">
                  <p className="font-mono font-medium">{item.ttspl_id || item.unique_serial_number || item.serial_number}</p>
                  <p className="text-xs text-gray-500">{[item.brand, item.model].filter(Boolean).join(' ')}</p>
                </div>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            {selected.size} of {editable.length} selected for today&apos;s pickup
          </p>
          <div className="flex gap-2">
            <button type="button" className="support-btn-outline flex-1 min-h-[44px]" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="support-btn-primary flex-1 min-h-[44px]"
              onClick={submit}
              disabled={saving || selected.size >= editable.length || selected.size < 1}
            >
              {saving ? 'Saving…' : `Update Return DC (${selected.size} laptop${selected.size === 1 ? '' : 's'})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
