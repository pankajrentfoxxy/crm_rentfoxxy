import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ClipboardList, Laptop, Ticket, X } from 'lucide-react';
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

/**
 * Split a pasted block into codes.
 *
 * Accepts whatever the warehouse actually pastes: commas from a typed list,
 * newlines and tabs from a two-column Excel copy, spaces and semicolons from
 * everything else. A two-column paste yields both the asset code and the serial
 * for the same machine; both resolve to the same row and are de-duplicated by
 * serial_id, so it counts once.
 */
function parseCodes(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const key = token.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

export default function VendorReturnTicketCreatePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [vendors, setVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [laptops, setLaptops] = useState([]);
  const [laptopTotal, setLaptopTotal] = useState(0);
  // serial_id -> row. A Map rather than a Set of ids so a selection survives the
  // search filter: the confirm step used to list only selections still present in
  // the filtered page, while submitting every id, so filtered-out picks were sent
  // but never shown.
  const [selectedMap, setSelectedMap] = useState(new Map());
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteResult, setPasteResult] = useState(null);

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
  const selectedRows = useMemo(() => [...selectedMap.values()], [selectedMap]);
  const selectedCount = selectedMap.size;
  const allSelected = laptops.length > 0 && laptops.every((r) => selectedMap.has(r.serial_id));

  const toggle = (row) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(row.serial_id)) next.delete(row.serial_id);
      else next.set(row.serial_id, row);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedMap((prev) => {
      if (allSelected) {
        const next = new Map(prev);
        laptops.forEach((r) => next.delete(r.serial_id));
        return next;
      }
      const next = new Map(prev);
      laptops.forEach((r) => next.set(r.serial_id, r));
      return next;
    });
  };

  /**
   * Match a pasted block against every eligible laptop for this vendor and select
   * the hits.
   *
   * Deliberately re-fetches the whole eligible set with no search term instead of
   * matching against what is on screen: the table shows one filtered, paginated
   * page, so matching against it would silently drop codes that are eligible but
   * not currently listed — the worst possible failure for a paste of 60+ assets,
   * because the count would look plausible.
   */
  const applyPaste = useCallback(async () => {
    const codes = parseCodes(pasteText);
    if (!codes.length) {
      toast.error('Paste some asset codes or serial numbers first');
      return;
    }
    setPasteBusy(true);
    try {
      const all = [];
      const limit = 200;
      for (let page = 1; page <= 25; page += 1) {
        const res = await fetchVendorReturnTicketEligible({
          vendor_id: Number(vendorId), page, limit,
        });
        const batch = res.data?.data || [];
        all.push(...batch);
        const total = res.data?.pagination?.total ?? all.length;
        if (batch.length < limit || all.length >= total) break;
      }

      const index = new Map();
      for (const row of all) {
        if (row.ttspl_id) index.set(String(row.ttspl_id).trim().toUpperCase(), row);
        if (row.serial_number) index.set(String(row.serial_number).trim().toUpperCase(), row);
      }

      const matched = new Map();
      const notFound = [];
      for (const code of codes) {
        const row = index.get(code.toUpperCase());
        if (row) matched.set(row.serial_id, row);
        else notFound.push(code);
      }

      // Counted here, not inside the updater: StrictMode invokes the updater
      // twice and would double every figure the user is shown.
      let added = 0;
      let already = 0;
      matched.forEach((_row, id) => {
        if (selectedMap.has(id)) already += 1;
        else added += 1;
      });
      setSelectedMap((prev) => {
        const next = new Map(prev);
        matched.forEach((row, id) => next.set(id, row));
        return next;
      });

      setPasteResult({ codes: codes.length, added, already, notFound });
      if (notFound.length) {
        toast(`${added} selected · ${notFound.length} not found`, { icon: '⚠️' });
      } else {
        toast.success(`${added} laptop${added === 1 ? '' : 's'} selected`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not match the pasted list');
    } finally {
      setPasteBusy(false);
    }
  }, [pasteText, vendorId, selectedMap]);

  const handleCreate = async () => {
    if (!selectedCount) {
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
        serial_ids: [...selectedMap.keys()],
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
                  setSelectedMap(new Map());
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
                {laptopTotal} listed, <strong>{selectedCount}</strong> selected
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setPasteOpen((v) => !v)}
                >
                  <ClipboardList className="w-4 h-4" /> Paste list
                </Button>
                <SearchField
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search TTSPL / serial…"
                />
              </div>
            </div>

            {pasteOpen && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">Select by pasting a list</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Asset IDs or serial numbers, in any mix. Separate with commas, spaces or new
                      lines — pasting two columns straight out of Excel works.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPasteOpen(false); setPasteResult(null); }}
                    className="text-slate-400 hover:text-slate-600 shrink-0"
                    aria-label="Close paste panel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <textarea
                  id="vendor-return-paste"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                  rows={5}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'TTSPL5650, TTSPL5657, TTSPL5669\nor\nTTSPL5650\t919Q463\nTTSPL5657\t81J0503'}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button loading={pasteBusy} disabled={!pasteText.trim()} onClick={applyPaste}>
                    Match &amp; select
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!pasteText && !pasteResult}
                    onClick={() => { setPasteText(''); setPasteResult(null); }}
                  >
                    Clear
                  </Button>
                  {selectedCount > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => { setSelectedMap(new Map()); setPasteResult(null); }}
                    >
                      Deselect all {selectedCount}
                    </Button>
                  )}
                </div>

                {pasteResult && (
                  <div className="rounded-lg bg-white border p-3 text-sm space-y-2">
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      <span><strong>{pasteResult.codes}</strong> code{pasteResult.codes === 1 ? '' : 's'} read</span>
                      <span className="text-emerald-700"><strong>{pasteResult.added}</strong> newly selected</span>
                      {pasteResult.already > 0 && (
                        <span className="text-slate-500"><strong>{pasteResult.already}</strong> already selected</span>
                      )}
                      <span className={pasteResult.notFound.length ? 'text-amber-700' : 'text-slate-500'}>
                        <strong>{pasteResult.notFound.length}</strong> not found
                      </span>
                    </div>
                    {pasteResult.notFound.length > 0 && (
                      <div>
                        <p className="text-xs text-amber-800 mb-1">
                          Not eligible for this vendor — already returned, not in stock, still with a
                          customer, or on another return ticket:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {pasteResult.notFound.map((code) => (
                            <span
                              key={code}
                              className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-xs font-mono"
                            >
                              {code}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
                          checked={selectedMap.has(row.serial_id)}
                          onChange={() => toggle(row)}
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
              <Button variant="secondary" onClick={() => { setStep(0); setSelectedMap(new Map()); }}>Back</Button>
              <Button disabled={!selectedCount} onClick={() => setStep(2)}>Next: Confirm</Button>
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
