import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Laptop, Package } from 'lucide-react';
import { PageHeader, Button, SearchField } from '../../../components/ui/primitives';
import {
  createReturnToVendorDc,
  fetchReturnToVendorEligible,
} from '../vendorManagementApi';

const STEPS = ['Select Laptops', 'Confirm'];

function statusPill(status) {
  const map = {
    in_stock: 'bg-emerald-50 text-emerald-700',
    returned: 'bg-amber-50 text-amber-800',
    qc_failed: 'bg-red-50 text-red-700',
  };
  return map[status] || 'bg-slate-100 text-slate-600';
}

export default function ReturnToVendorCreatePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [laptops, setLaptops] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadLaptops = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchReturnToVendorEligible({
        search: search || undefined,
        limit: 200,
      });
      setLaptops(res.data?.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to load laptops');
      setLaptops([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadLaptops();
  }, [loadLaptops]);

  const selectedRows = laptops.filter((r) => selected.has(r.serial_id));

  const selectedVendor = useMemo(() => {
    const names = [...new Set(selectedRows.map((r) => r.vendor_name).filter(Boolean))];
    return names.length === 1 ? names[0] : names.length > 1 ? null : '';
  }, [selectedRows]);

  const toggle = (serialId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(serialId)) next.delete(serialId);
      else next.add(serialId);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!selected.size) {
      toast.error('Select at least one laptop');
      return;
    }
    if (selectedVendor === null) {
      toast.error('All selected laptops must belong to the same vendor');
      return;
    }
    if (!returnReason.trim()) {
      toast.error('Return reason is required');
      return;
    }
    setSaving(true);
    try {
      const res = await createReturnToVendorDc({
        serial_ids: [...selected],
        return_reason: returnReason.trim(),
        remarks: remarks.trim() || undefined,
      });
      toast.success(`Return DC ${res.data?.dc?.dc_number || ''} created`);
      navigate(`/vendor-management/return-to-vendor/${encodeURIComponent(res.data?.dc?.dc_number)}`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to create return DC');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Return Laptop to Vendor"
        subtitle="Select warehouse laptops to send back to the original supplier"
        actions={(
          <Link to="/vendor-management/return-to-vendor" className="text-sm text-blue-600 inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to list
          </Link>
        )}
      />

      <div className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <span
            key={label}
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {i + 1}. {label}
          </span>
        ))}
      </div>

      <div className="rounded-xl border bg-white shadow-sm p-4 space-y-4">
        {step === 0 && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <p className="text-sm text-slate-600">
                Pick one or more laptops in warehouse. Selected: <strong>{selected.size}</strong>
              </p>
              <SearchField value={search} onChange={setSearch} placeholder="Search TTSPL / serial / vendor…" />
            </div>
            {selectedVendor === null && selected.size > 0 && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                Selected laptops belong to different vendors — pick laptops from one vendor only.
              </p>
            )}
            <div className="overflow-x-auto border rounded-lg max-h-[28rem] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left w-10" />
                    <th className="px-3 py-2 text-left">Asset ID</th>
                    <th className="px-3 py-2 text-left">Serial</th>
                    <th className="px-3 py-2 text-left">Vendor</th>
                    <th className="px-3 py-2 text-left">PO</th>
                    <th className="px-3 py-2 text-left">Brand / Model</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Warehouse</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                  ) : laptops.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No eligible laptops in warehouse</td></tr>
                  ) : laptops.map((row) => (
                    <tr key={row.serial_id} className="border-t hover:bg-slate-50/80">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(row.serial_id)}
                          onChange={() => toggle(row.serial_id)}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{row.ttspl_id}</td>
                      <td className="px-3 py-2">{row.serial_number}</td>
                      <td className="px-3 py-2">{row.vendor_name || '—'}</td>
                      <td className="px-3 py-2 text-xs">{row.po_number || row.po_id || '—'}</td>
                      <td className="px-3 py-2">{[row.brand, row.model].filter(Boolean).join(' ') || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${statusPill(row.inventory_status)}`}>
                          {row.inventory_status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {[row.warehouse_carret, row.warehouse_carret_slot].filter(Boolean).join(' / ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <Button disabled={!selected.size || selectedVendor === null} onClick={() => setStep(1)}>
                Next: Confirm
              </Button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase text-slate-500">Vendor</p>
              <p className="font-medium">{selectedVendor || '—'}</p>
            </div>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Return reason *</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                rows={2}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="e.g. QC failed, DOA, wrong configuration…"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Remarks (optional)</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </label>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-2">
                {selectedRows.length} laptop{selectedRows.length === 1 ? '' : 's'} selected
              </p>
              <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                {selectedRows.map((r) => (
                  <li key={r.serial_id} className="flex items-center gap-2">
                    <Laptop className="w-3.5 h-3.5 text-slate-400" />
                    {r.ttspl_id} — {r.serial_number}
                    {r.po_number ? ` · ${r.po_number}` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
              <Button loading={saving} onClick={handleCreate}>
                <Package className="w-4 h-4" /> Generate Return DC
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
