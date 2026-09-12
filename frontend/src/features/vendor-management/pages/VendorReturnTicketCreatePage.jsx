import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Laptop, Ticket } from 'lucide-react';
import { PageHeader, Button, SearchField } from '../../../components/ui/primitives';
import {
  createVendorReturnTicket,
  fetchVendorReturnTicketEligible,
  fetchVendorReturnTicketEligibleVendors,
} from '../vendorManagementApi';

const STEPS = ['Select Vendor', 'Select Laptops', 'Confirm'];

function vendorLabel(v) {
  return [v.business_name, v.first_name].filter(Boolean).join(' · ') || `Vendor ${v.vendor_id}`;
}

export default function VendorReturnTicketCreatePage() {
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
      const res = await fetchVendorReturnTicketEligibleVendors();
      setVendors(res.data?.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to load vendors');
      setVendors([]);
    } finally {
      setVendorsLoading(false);
    }
  }, []);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  const loadLaptops = useCallback(async () => {
    if (!vendorId) {
      setLaptops([]);
      setLaptopTotal(0);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchVendorReturnTicketEligible({
        vendor_id: Number(vendorId),
        search: search || undefined,
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
  }, [vendorId, search]);

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
      const res = await createVendorReturnTicket({
        vendor_id: Number(vendorId),
        serial_ids: [...selected],
        return_reason: returnReason.trim(),
        remarks: remarks.trim() || undefined,
      });
      toast.success(`Ticket ${res.data?.ticket?.ticket_number || ''} created`);
      navigate(`/vendor-management/return-ticket/${encodeURIComponent(res.data?.ticket?.ticket_number)}`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to create ticket');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="New Vendor Return Ticket"
        subtitle="Rental-purchase laptops only. Rent does not stop until you notify the vendor."
        actions={(
          <Link to="/vendor-management/return-ticket" className="text-sm text-blue-600 inline-flex items-center gap-1">
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
                    {vendorLabel(v)} ({v.inward_count} in stock)
                  </option>
                ))}
              </select>
            </label>
            {!vendorsLoading && vendors.length === 0 && (
              <p className="text-sm text-slate-500">No vendor currently has in-stock rental-purchase laptops eligible to return.</p>
            )}
            <div className="flex justify-end">
              <Button
                disabled={!vendorId}
                onClick={() => {
                  if (!vendorId) {
                    toast.error('Select a vendor first');
                    return;
                  }
                  setSelected(new Set());
                  setStep(1);
                }}
              >
                Next: Show in-stock laptops
              </Button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <p className="text-sm text-slate-600">
                In-stock rental units for <strong>{selectedVendor ? vendorLabel(selectedVendor) : 'vendor'}</strong>
                {' — '}
                {laptopTotal} listed, <strong>{selected.size}</strong> selected
              </p>
              <SearchField
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search TTSPL / serial…"
              />
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
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                  ) : laptops.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No in-stock rental laptops for this vendor</td></tr>
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
                      <td className="px-3 py-2 text-xs">{row.inventory_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => { setStep(0); setSelected(new Set()); }}>Back</Button>
              <Button disabled={!selected.size} onClick={() => setStep(2)}>Next: Confirm</Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase text-slate-500">Vendor</p>
              <p className="font-medium">{selectedVendor ? vendorLabel(selectedVendor) : '—'}</p>
              {selectedVendor?.email ? (
                <p className="text-xs text-slate-500 mt-1">{selectedVendor.email}</p>
              ) : (
                <p className="text-xs text-amber-700 mt-1">No email on file — you will not be able to notify until one is added.</p>
              )}
            </div>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Return reason *</span>
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                rows={2}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="e.g. End of rental, DOA, vendor collection…"
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
            <p className="text-xs text-slate-500">
              Creating the ticket does not stop rent and does not change warehouse stock.
              Rent stops only when you click Notify vendor on the next screen.
            </p>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button loading={saving} onClick={handleCreate}>
                <Ticket className="w-4 h-4" /> Create Ticket
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
