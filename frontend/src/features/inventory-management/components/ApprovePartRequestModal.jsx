import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, Loader2, QrCode, Search, X } from 'lucide-react';
import api from '../../../utils/api';
import ScanField from '../../../components/ScanField';
import { PART_CATEGORIES } from '../../../constants/laptopConditions';
import { listPartInstances } from '../../floor-pipeline/partRequestsApi';
import { lookupPartUnit } from '../partTrackingApi';

/**
 * Warehouse approval: pick the exact physical unit going out (by scanning its
 * QR label, or from stock), and declare whether a defective part is coming back
 * off the laptop.
 *
 * onConfirm({ instance_id, old_part_expected, old_part_category, old_part_part_id, old_part_name })
 */
export default function ApprovePartRequestModal({ open, request, busy = false, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [units, setUnits] = useState([]);
  const [selected, setSelected] = useState('auto');
  const [search, setSearch] = useState('');

  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(null);
  const [scanError, setScanError] = useState('');

  const [oldPartExpected, setOldPartExpected] = useState('yes');
  const [oldPartCategory, setOldPartCategory] = useState('');
  const [oldPartName, setOldPartName] = useState('');
  const [oldPartId, setOldPartId] = useState(null);
  const [catalog, setCatalog] = useState([]);

  const partId = request?.part_id;

  useEffect(() => {
    if (!open || !partId) return undefined;
    let alive = true;
    setLoading(true);
    setSelected('auto');
    setSearch('');
    setScanCode('');
    setScanned(null);
    setScanError('');
    // Replacing a part almost always sends the old one back; upgrades often add
    // to an empty slot, so leave that for the team to confirm.
    setOldPartExpected(request?.request_type === 'upgrade' ? 'not_available' : 'yes');
    setOldPartCategory(request?.category || '');
    setOldPartName(request?.part_name || '');
    setOldPartId(request?.part_id || null);

    listPartInstances({ part_id: partId, status: 'in_stock', limit: 500 })
      .then(({ data }) => {
        if (!alive) return;
        const rows = data.instances || [];
        setUnits(rows);
        setSelected(rows.length ? rows[0].instance_id : 'auto');
      })
      .catch(() => { if (alive) { setUnits([]); setSelected('auto'); } })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [open, partId, request]);

  // Catalog for naming the old part when it is not the same type as the new one.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      api.get('/parts', { params: { search: oldPartName || '', limit: 20 } })
        .then(({ data }) => { if (alive) setCatalog(data.parts || []); })
        .catch(() => { if (alive) setCatalog([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [open, oldPartName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) =>
      String(u.serial_number || '').toLowerCase().includes(q) ||
      String(u.prt_id || '').toLowerCase().includes(q) ||
      String(u.location_code || '').toLowerCase().includes(q)
    );
  }, [units, search]);

  async function handleScan(code) {
    const value = String(code || '').trim();
    if (!value) return;
    setScanning(true);
    setScanError('');
    setScanned(null);
    try {
      const { data } = await lookupPartUnit(value);
      const unit = data.unit;
      if (Number(unit.part_id) !== Number(partId)) {
        setScanError(`${unit.prt_id} is a "${unit.part_name}", but this request is for "${request?.part_name}".`);
        return;
      }
      if (!['in_stock', 'reserved'].includes(unit.status)) {
        setScanError(`${unit.prt_id} is "${unit.status}" and cannot be issued.`);
        return;
      }
      setScanned(unit);
      setSelected(unit.instance_id);
      toast.success(`${unit.prt_id} selected`);
    } catch (e) {
      setScanError(e.response?.data?.message || `No part unit found for "${value}"`);
    } finally {
      setScanning(false);
    }
  }

  function submit() {
    if (oldPartExpected === 'yes' && !oldPartId && !oldPartName.trim()) {
      toast.error('Pick the category and name of the old part coming back');
      return;
    }
    onConfirm?.({
      instance_id: selected === 'auto' ? null : Number(selected),
      old_part_expected: oldPartExpected,
      old_part_category: oldPartExpected === 'yes' ? (oldPartCategory || null) : null,
      old_part_part_id: oldPartExpected === 'yes' ? oldPartId : null,
      old_part_name: oldPartExpected === 'yes' ? (oldPartName.trim() || null) : null,
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <button type="button" className="fixed inset-0 bg-black/50" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 my-8 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-white">
          <div>
            <h3 className="font-semibold text-slate-900">Approve part request</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {request?.part_name}{request?.request_number ? ` · ${request.request_number}` : ''}
              {request?.ttspl_id ? ` · ${request.ttspl_id}` : ''}
            </p>
          </div>
          <button type="button" className="p-2 rounded-lg hover:bg-slate-100" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <QrCode className="w-3.5 h-3.5" /> Scan the part going out
            </h4>
            <ScanField
              value={scanCode}
              onChange={(v) => { setScanCode(v); setScanError(''); }}
              onScan={handleScan}
              placeholder="Scan QR, or type Part ID / serial"
              aria-label="Scan the part QR code"
              disabled={busy}
              autoFocus
            />
            {scanning ? (
              <p className="text-xs text-slate-500 flex items-center gap-1.5 m-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking up…
              </p>
            ) : null}
            {scanError ? (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 flex items-start gap-1.5 m-0">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {scanError}
              </p>
            ) : null}
            {scanned ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
                <p className="font-mono font-semibold m-0">{scanned.prt_id}</p>
                <p className="m-0 mt-0.5">
                  {scanned.part_name}
                  {scanned.serial_number ? ` · Serial ${scanned.serial_number}` : ' · No serial'}
                  {scanned.location_code ? ` · ${scanned.location_code}` : ''}
                </p>
                {scanned.purchase_order_number ? (
                  <p className="m-0 mt-0.5 text-emerald-700">
                    {scanned.purchase_order_number}
                    {scanned.vendor_name ? ` · ${scanned.vendor_name}` : ''}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Or pick from stock
            </h4>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading available units…
              </div>
            ) : (
              <>
                {units.length > 3 ? (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      className="w-full rounded-xl border border-slate-200 pl-8 pr-2 py-2 text-sm"
                      placeholder="Search Part ID, serial, location"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                ) : null}

                <label className={`flex items-center gap-3 rounded-xl border p-3 text-sm cursor-pointer ${selected === 'auto' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                  <input type="radio" name="unit" checked={selected === 'auto'} onChange={() => setSelected('auto')} />
                  <span className="font-medium text-slate-700">Auto-pick oldest available unit</span>
                </label>

                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="text-sm text-slate-500 py-3 text-center">
                      {units.length ? 'No units match your search.' : 'No tracked units in stock — auto-pick will assign one.'}
                    </p>
                  ) : filtered.map((u) => (
                    <label
                      key={u.instance_id}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-sm cursor-pointer ${Number(selected) === u.instance_id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
                    >
                      <input
                        type="radio"
                        name="unit"
                        checked={Number(selected) === u.instance_id}
                        onChange={() => { setSelected(u.instance_id); setScanned(null); }}
                      />
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-semibold text-slate-800 truncate m-0">{u.prt_id}</p>
                        <p className="text-xs text-slate-500 m-0">
                          {u.serial_number || 'No serial'}{u.location_code ? ` · ${u.location_code}` : ''}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
              Old / defective part
            </h4>
            <p className="text-[11px] text-amber-800 m-0">
              Does this laptop have an old part coming back? If it does, it will be taken into inventory
              with its own Part ID when the technician hands it over.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'yes', label: 'Yes — old part will come back' },
                { value: 'not_available', label: 'No part on this laptop' },
              ].map((o) => (
                <label
                  key={o.value}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium cursor-pointer ${
                    oldPartExpected === o.value ? 'border-amber-500 bg-white text-amber-900' : 'border-amber-200 text-amber-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="old-part-expected"
                    checked={oldPartExpected === o.value}
                    onChange={() => setOldPartExpected(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </div>

            {oldPartExpected === 'yes' ? (
              <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
                <div>
                  <label className="block text-[11px] font-semibold text-amber-900 mb-1" htmlFor="old-part-category">
                    Category
                  </label>
                  <select
                    id="old-part-category"
                    className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
                    value={oldPartCategory}
                    onChange={(e) => setOldPartCategory(e.target.value)}
                  >
                    <option value="">Select category…</option>
                    {PART_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-amber-900 mb-1" htmlFor="old-part-name">
                    Part name
                  </label>
                  <input
                    id="old-part-name"
                    list="old-part-catalog"
                    className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm"
                    placeholder="e.g. Samsung 8GB DDR4"
                    value={oldPartName}
                    onChange={(e) => {
                      setOldPartName(e.target.value);
                      const match = catalog.find((p) => p.part_name === e.target.value);
                      setOldPartId(match ? match.part_id : null);
                      if (match?.category) setOldPartCategory(match.category);
                    }}
                  />
                  <datalist id="old-part-catalog">
                    {catalog.map((p) => <option key={p.part_id} value={p.part_name} />)}
                  </datalist>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="sticky bottom-0 flex gap-2 px-5 py-3.5 border-t border-slate-100 bg-white">
          <button type="button" className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="flex-1 rounded-xl bg-green-600 text-white py-2.5 text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            onClick={submit}
            disabled={busy || loading}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {busy ? 'Approving…' : 'Approve & reserve'}
          </button>
        </div>
      </div>
    </div>
  );
}
