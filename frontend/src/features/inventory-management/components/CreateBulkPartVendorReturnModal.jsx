import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import { createPartVendorReturnDc } from '../partVendorRepairApi';

/**
 * Bulk create a Parts Vendor Repair DC from selected defective units.
 * All selected units must resolve to the same vendor (enforced by API).
 */
export default function CreateBulkPartVendorReturnModal({ units, onClose, onCreated }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorAddress, setVendorAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactMobile, setContactMobile] = useState('');
  const [itemRemarks, setItemRemarks] = useState(() => {
    const map = {};
    for (const u of units || []) map[u.instance_id] = u.notes || '';
    return map;
  });

  useEffect(() => {
    const first = (units || []).find((u) => u.vendor_name) || (units || [])[0];
    if (!first) return;
    setVendorName(first.vendor_name || '');
    setVendorAddress(first.vendor_address || '');
    setContactPerson(first.vendor_contact_person || '');
    setContactMobile(first.vendor_contact_mobile || '');
  }, [units]);

  const vendorSummary = useMemo(() => {
    const names = [...new Set((units || []).map((u) => u.vendor_name).filter(Boolean))];
    return names.length <= 1 ? (names[0] || '—') : `${names.length} vendors (will fail if mixed)`;
  }, [units]);

  const submit = async (e) => {
    e.preventDefault();
    if (!units?.length) {
      toast.error('Select at least one part');
      return;
    }
    if (!vendorName.trim()) {
      toast.error('Vendor name is required');
      return;
    }
    if (!vendorAddress.trim()) {
      toast.error('Vendor address is required');
      return;
    }
    const reason = remarks.trim();
    if (reason.length < 10) {
      toast.error('Remarks must be at least 10 characters');
      return;
    }
    setBusy(true);
    try {
      const { data } = await createPartVendorReturnDc({
        instance_ids: units.map((u) => u.instance_id),
        vendor_id: units[0]?.resolved_vendor_id || undefined,
        vendor_name: vendorName.trim(),
        vendor_address: vendorAddress.trim(),
        vendor_billing_address: vendorAddress.trim(),
        shipping_address: vendorAddress.trim(),
        contact_person: contactPerson.trim() || undefined,
        contact_mobile: contactMobile.trim() || undefined,
        remarks: reason,
        item_remarks: itemRemarks,
      });
      toast.success(`Created ${data.dc_number} (${data.item_count || units.length} parts)`);
      onCreated?.(data);
      onClose?.();
      if (data.dc_number) {
        navigate(`/inventory-management/part-vendor-repair/${encodeURIComponent(data.dc_number)}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create vendor return DC');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">Bulk send to vendor</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {units.length} defective part{units.length === 1 ? '' : 's'} · {vendorSummary}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              On receive back, choose repair or replacement per line — parts go straight to stock (no QC pending).
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Vendor name *</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Vendor address *</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[72px]"
                value={vendorAddress}
                onChange={(e) => setVendorAddress(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Contact person</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Contact mobile</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={contactMobile}
                onChange={(e) => setContactMobile(e.target.value)}
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Remarks * (min 10 chars)</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[64px]"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Reason for vendor return / repair request…"
                required
              />
            </label>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">PRT</th>
                  <th className="px-3 py-2">Part</th>
                  <th className="px-3 py-2">Vendor / SPO</th>
                  <th className="px-3 py-2">Line note</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.instance_id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{u.prt_id}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{u.part_name}</div>
                      <div className="text-[11px] text-slate-400">{u.serial_number || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      <div>{u.vendor_name || '—'}</div>
                      <div className="text-slate-400">{u.purchase_order_number || ''}</div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full border rounded px-2 py-1 text-xs"
                        value={itemRemarks[u.instance_id] || ''}
                        onChange={(e) => setItemRemarks((m) => ({ ...m, [u.instance_id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm border rounded-lg">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create return DC
          </button>
        </div>
      </form>
    </div>
  );
}
