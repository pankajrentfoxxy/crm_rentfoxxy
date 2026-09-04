import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { markInvoiceGeneratedOnZoho } from '../customerBillingApi';

function ymd(value) {
  const s = String(value || '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

export default function MarkZohoInvoiceModal({ invoice, candidates = [], onClose, onSaved }) {
  const initialIds = useMemo(() => {
    const onInvoice = (candidates || []).filter((row) => row.on_invoice).map((row) => Number(row.serial_id));
    return onInvoice.length ? onInvoice : [];
  }, [candidates]);
  const [selected, setSelected] = useState(() => new Set(initialIds));
  const [externalRef, setExternalRef] = useState(invoice?.external_reference || '');
  const [through, setThrough] = useState(ymd(invoice?.to_date) || '');
  const [includeSecurity, setIncludeSecurity] = useState(true);
  const [saving, setSaving] = useState(false);

  const toggle = (serialId) => {
    const id = Number(serialId);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selected.size) {
      toast.error('Select the laptop(s) already billed on Zoho');
      return;
    }
    if (!through) {
      toast.error('Enter the last date billed on Zoho');
      return;
    }
    setSaving(true);
    try {
      await markInvoiceGeneratedOnZoho(invoice.invoice_id, {
        serial_ids: [...selected],
        rent_billed_through: through,
        include_security: includeSecurity,
        external_reference: externalRef.trim() || undefined,
      });
      toast.success('Marked as generated on Zoho. Later monthly invoices will skip that catch-up and security.');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to mark Zoho invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="font-semibold text-gray-900 mb-1">Invoice generated on Zoho</h3>
        <p className="text-xs text-slate-500 mb-4">
          Use this after a first-order invoice was sent from Zoho. Selected laptops will not bring
          previous-month catch-up or security on the next CRM invoice.
        </p>
        <label className="block text-sm text-gray-600 mb-1">Zoho invoice number (optional)</label>
        <input
          type="text"
          value={externalRef}
          onChange={(e) => setExternalRef(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
          placeholder="e.g. INV-ZOHO-1234"
        />
        <label className="block text-sm text-gray-600 mb-1">Rent billed through</label>
        <input
          type="date"
          value={through}
          onChange={(e) => setThrough(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700 mb-4">
          <input
            type="checkbox"
            checked={includeSecurity}
            onChange={(e) => setIncludeSecurity(e.target.checked)}
          />
          Security already collected on Zoho
        </label>
        <p className="text-sm font-medium text-gray-800 mb-2">Laptops billed on Zoho</p>
        <div className="border rounded-lg divide-y max-h-56 overflow-y-auto mb-4">
          {!candidates.length ? (
            <p className="px-3 py-4 text-sm text-slate-500">No rented laptops found for this customer.</p>
          ) : candidates.map((row) => {
            const id = Number(row.serial_id);
            return (
              <label key={id} className="flex items-start gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(id)}
                  onChange={() => toggle(id)}
                />
                <span>
                  <span className="font-medium">{row.ttspl_id || `Serial ${id}`}</span>
                  {row.already_zoho && (
                    <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">Zoho</span>
                  )}
                  <span className="block text-xs text-slate-500">
                    Delivered {ymd(row.delivery_date) || '—'}
                    {row.dc_number ? ` · ${row.dc_number}` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Mark generated on Zoho'}
          </button>
        </div>
      </div>
    </div>
  );
}
