import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Laptop, Package } from 'lucide-react';
import { PageHeader, Button, SearchField } from '../../../components/ui/primitives';
import {
  createReturnToVendorDc,
  fetchReturnToVendorEligible,
  fetchReturnToVendorEligibleVendors,
} from '../vendorManagementApi';

const STEPS = ['Select Vendor', 'Select Laptops', 'Confirm'];

const STATUS_FILTERS = [
  { value: 'hide_returned', label: 'Hide already returned' },
  { value: 'all', label: 'All warehouse' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'returned', label: 'Returned only' },
  { value: 'qc_failed', label: 'QC failed' },
];

function vendorLabel(v) {
  return [v.business_name, v.first_name].filter(Boolean).join(' · ') || `Vendor ${v.vendor_id}`;
}

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
  const [vendors, setVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [laptops, setLaptops] = useState([]);
  const [laptopTotal, setLaptopTotal] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('hide_returned');
  const [returnReason, setReturnReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadVendors = useCallback(async () => {
    setVendorsLoading(true);
    try {
      const res = await fetchReturnToVendorEligibleVendors();
      setVendors(res.data?.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to load vendors');
      setVendors([]);
    } finally {
      setVendorsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  const loadLaptops = useCallback(async () => {
    if (!vendorId) {
      setLaptops([]);
      setLaptopTotal(0);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchReturnToVendorEligible({
        vendor_id: Number(vendorId),
        search: search || undefined,
        inventory_status: statusFilter,
        page: 1,
        limit: 200,
      });
      setLaptops(res.data?.data || []);
      setLaptopTotal(res.data?.pagination?.total || (res.data?.data || []).length);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to load laptops');
      setLaptops([]);
      setLaptopTotal(0);
    } finally {
      setLoading(false);
    }
  }, [vendorId, search, statusFilter]);

  useEffect(() => {
    if (step >= 1 && vendorId) loadLaptops();
  }, [loadLaptops, step, vendorId]);

  const selectedVendor = useMemo(
    () => vendors.find((v) => String(v.vendor_id) === String(vendorId)) || null,
    [vendors, vendorId]
  );

  const selectedRows = laptops.filter((r) => selected.has(r.serial_id));
  const allSelected = laptops.length > 0 && laptops.every((r) => selected.has(r.serial_id));

  const toggle = (serialId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(serialId)) next.delete(serialId);
      else next.add(serialId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(laptops.map((r) => r.serial_id));
    });
  };

  const handleVendorNext = () => {
    if (!vendorId) {
      toast.error('Select a vendor first');
      return;
    }
    setSelected(new Set());
    setStep(1);
  };

  const handleCreate = async () => {
    if (!selected.size) {
      toast.error('Select at least one laptop');
      return;
    }
    if (!returnReason.trim()) {
      toast.error('Return reason is required');
      return;
    }
    setSaving(true);
    try {
      const res = await createReturnToVendorDc({
        vendor_id: Number(vendorId),
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
        subtitle="Select a vendor, then pick their inward warehouse laptops to send back"
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
            <label className="block text-sm max-w-xl">
              <span className="font-medium text-slate-700">Vendor *</span>
              <select
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-60"
                value={vendorId}
                disabled={vendorsLoading}
                onChange={(e) => setVendorId(e.target.value)}
              >
                <option value="">{vendorsLoading ? 'Loading vendors…' : 'Select vendor'}</option>
                {vendors.map((v) => (
                  <option key={v.vendor_id} value={String(v.vendor_id)}>
                    {vendorLabel(v)} ({v.inward_count} inward)
                  </option>
                ))}
              </select>
            </label>
            {!vendorsLoading && vendors.length === 0 && (
              <p className="text-sm text-slate-500">No vendor currently has inward warehouse laptops to return.</p>
            )}
            <div className="flex justify-end">
              <Button disabled={!vendorId} onClick={handleVendorNext}>
                Next: Show inward laptops
              </Button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <p className="text-sm text-slate-600">
                Inward laptops for <strong>{selectedVendor ? vendorLabel(selectedVendor) : 'vendor'}</strong>
                {' — '}
                {laptopTotal} listed, <strong>{selected.size}</strong> selected
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="whitespace-nowrap">Status</span>
                  <select
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setSelected(new Set());
                    }}
                  >
                    {STATUS_FILTERS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                <SearchField
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search TTSPL / serial…"
                />
              </div>
            </div>
            <div className="overflow-x-auto border rounded-lg max-h-[28rem] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left w-10">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!laptops.length} />
                    </th>
                    <th className="px-3 py-2 text-left">Asset ID</th>
                    <th className="px-3 py-2 text-left">Serial</th>
                    <th className="px-3 py-2 text-left">PO</th>
                    <th className="px-3 py-2 text-left">Brand / Model</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Warehouse</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                  ) : laptops.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                        {statusFilter === 'hide_returned'
                          ? 'No inward laptops to return. Already-returned units are hidden — switch Status to All warehouse if needed.'
                          : 'No inward laptops for this vendor and filter'}
                      </td>
                    </tr>
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
            <div className="flex justify-between">
              <Button
                variant="secondary"
                onClick={() => {
                  setStep(0);
                  setSelected(new Set());
                }}
              >
                Back
              </Button>
              <Button disabled={!selected.size} onClick={() => setStep(2)}>
                Next: Confirm
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase text-slate-500">Vendor</p>
              <p className="font-medium">{selectedVendor ? vendorLabel(selectedVendor) : '—'}</p>
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
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
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
