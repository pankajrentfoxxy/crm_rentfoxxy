import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import AssetDetailsForm from '../../operation-management/components/AssetDetailsForm';
import { updateTicketConfig } from '../floorPipelineApi';

const CONFIG_FIELDS = [
  { key: 'brand', label: 'Brand', lineKey: 'brand' },
  { key: 'model', label: 'Model', lineKey: 'model_name' },
  { key: 'processor', label: 'Processor', lineKey: 'processor' },
  { key: 'generation', label: 'Generation', lineKey: 'generation' },
  { key: 'ram', label: 'RAM', lineKey: 'ram' },
  { key: 'storage', label: 'Storage / SSD', lineKey: 'storage' },
  { key: 'gpu', label: 'GPU', lineKey: 'gpu' },
  { key: 'screen_size', label: 'Screen Size', lineKey: 'screen_size' },
  { key: 'os', label: 'OS', lineKey: 'os' },
];

function buildLineFromTicket(ticket, extra = {}) {
  return {
    brand: ticket?.brand || extra.brand || '',
    model_name: ticket?.model || extra.model || '',
    processor: ticket?.processor || extra.processor || '',
    generation: extra.generation || ticket?.generation || '',
    ram: ticket?.ram || extra.ram || '',
    storage: ticket?.storage || extra.storage || extra.ssd || '',
    gpu: extra.gpu || '',
    screen_size: extra.screen_size || '',
    os: extra.os || '',
  };
}

function originalValue(ticket, extra, field) {
  if (['processor', 'ram', 'storage', 'brand', 'model'].includes(field.key)) {
    return ticket?.[field.key] || extra[field.key] || '';
  }
  return extra[field.key] || ticket?.[field.key] || '';
}

export default function ConfigUpdateModal({ open, onClose, ticket, extra = {}, onSaved }) {
  const [lines, setLines] = useState([buildLineFromTicket(null)]);
  const [changeType, setChangeType] = useState('correction');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !ticket) return;
    setLines([buildLineFromTicket(ticket, extra)]);
    setNotes('');
    setChangeType('correction');
    // Re-initialise only when the modal opens or a different ticket is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket?.ticket_id]);

  const row = lines[0] || {};

  const diffs = useMemo(() => {
    if (!ticket) return [];
    return CONFIG_FIELDS.filter((f) => {
      const orig = String(originalValue(ticket, extra, f)).trim();
      const next = f.lineKey === 'model_name'
        ? String(row.model_name || '').trim()
        : String(row[f.lineKey] || '').trim();
      return next !== orig;
    });
  }, [ticket, extra, row]);

  if (!open) return null;

  const handleSave = async () => {
    if (!notes.trim()) {
      toast.error('Notes are required');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateTicketConfig(ticket.ticket_id, {
        brand: row.brand,
        model: row.model_name,
        processor: row.processor,
        generation: row.generation,
        ram: row.ram,
        storage: row.storage,
        gpu: row.gpu,
        screen_size: row.screen_size,
        os: row.os,
        change_type: changeType,
        notes: notes.trim(),
      });
      if (data.success) {
        toast.success('Configuration updated');
        onSaved?.(data);
        onClose();
      } else {
        toast.error(data.message || 'Update failed');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <button type="button" className="fixed inset-0 bg-black/50" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 my-8 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-2xl p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-slate-900">Update laptop config</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-slate-500 -mt-2">
          Saves to the Production Asset (working config). PO/GRN original vendor config stays locked.
          Options come from Settings → Laptop Configuration mapping.
        </p>

        <AssetDetailsForm
          lines={lines}
          onChange={setLines}
          useCascadeApi
          reconcileValues
          quotationType="sale"
          requiredFields={['brand', 'model_name', 'processor', 'generation', 'ram', 'storage']}
          hideCommercialFields
          hideAddLine
        />

        <label className="block text-sm max-w-md">
          <span className="text-xs font-medium text-slate-600">OS</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={row.os || ''}
            onChange={(e) => setLines([{ ...row, os: e.target.value }])}
            placeholder="Optional — e.g. Windows 11 Pro"
          />
        </label>

        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">Change type</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value)}
          >
            <option value="upgrade">Upgrade</option>
            <option value="replacement">Replacement</option>
            <option value="correction">Correction</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">Notes *</span>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm min-h-[80px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {diffs.length ? (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900">
            <p className="font-medium mb-1">Changes preview:</p>
            {diffs.map((f) => {
              const before = originalValue(ticket, extra, f);
              const after = f.lineKey === 'model_name' ? row.model_name : row[f.lineKey];
              return (
                <p key={f.key}>{f.label}: {before || '—'} → <strong>{after || '—'}</strong></p>
              );
            })}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border">Cancel</button>
          <button
            type="button"
            disabled={saving || !diffs.length}
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save config'}
          </button>
        </div>
      </div>
    </div>
  );
}
