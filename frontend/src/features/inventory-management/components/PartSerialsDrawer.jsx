import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Loader2, Plus, Search, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listPartInstances,
  addPartInstances,
  updatePartInstance,
} from '../../floor-pipeline/partRequestsApi';
import { createPartVendorReturnDc } from '../partVendorRepairApi';

const STATUS_COLORS = {
  in_stock: 'bg-green-100 text-green-700',
  reserved: 'bg-blue-100 text-blue-700',
  installed: 'bg-teal-100 text-teal-700',
  defective: 'bg-red-100 text-red-700',
  returned: 'bg-amber-100 text-amber-700',
  discarded: 'bg-gray-100 text-gray-600',
  sold: 'bg-purple-100 text-purple-700',
  with_technician: 'bg-indigo-100 text-indigo-700',
  with_vendor_repair: 'bg-orange-100 text-orange-800',
  qc_pending: 'bg-yellow-100 text-yellow-800',
};

// Only free stock can be reclassified from the UI (workflow statuses are locked).
const EDITABLE = new Set(['in_stock', 'defective', 'discarded']);

function AddForm({ partId, onAdded }) {
  const [serials, setSerials] = useState('');
  const [location, setLocation] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const list = serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) { toast.error('Enter at least one serial number'); return; }
    setBusy(true);
    try {
      const { data } = await addPartInstances({
        part_id: partId,
        serial_numbers: list,
        unit_cost: cost === '' ? undefined : Number(cost),
        location_code: location || undefined,
      });
      toast.success(data.message || `${list.length} unit(s) added`);
      setSerials(''); setLocation(''); setCost('');
      onAdded?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add units');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 p-3 space-y-3 bg-slate-50">
      <p className="text-sm font-semibold text-slate-700">Add serial numbers</p>
      <label className="block text-sm">
        <span className="text-xs text-slate-500">Serial number(s) — one per line, or comma-separated</span>
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
          rows={2}
          placeholder={'SN-12345\nSN-12346'}
          value={serials}
          onChange={(e) => setSerials(e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="text-xs text-slate-500">Location</span>
          <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Shelf A-3" />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-slate-500">Unit cost (₹)</span>
          <input type="number" min={0} step="0.01" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="defaults to part cost" />
        </label>
      </div>
      <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Add to stock
      </button>
    </form>
  );
}

function UnitRow({ unit, onSaved }) {
  const [serial, setSerial] = useState(unit.serial_number || '');
  const [location, setLocation] = useState(unit.location_code || '');
  const [busy, setBusy] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const editable = EDITABLE.has(unit.status);
  const dirty = serial !== (unit.serial_number || '') || location !== (unit.location_code || '');
  const canReturnToVendor = unit.status === 'defective' && !!unit.spo_id && !unit.vendor_repair_dc_number;

  const save = async (patch) => {
    setBusy(true);
    try {
      await updatePartInstance(unit.instance_id, patch);
      toast.success('Unit updated');
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const submitReturn = async () => {
    const reason = returnReason.trim();
    if (reason.length < 10) {
      toast.error('Return reason must be at least 10 characters');
      return;
    }
    setBusy(true);
    try {
      const { data } = await createPartVendorReturnDc({
        instance_ids: [unit.instance_id],
        remarks: reason,
        item_remarks: { [unit.instance_id]: reason },
      });
      toast.success(`Created ${data.dc_number || 'vendor return DC'}`);
      setReturnOpen(false);
      setReturnReason('');
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Return to vendor failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-slate-500">{unit.prt_id}</span>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[unit.status] || 'bg-gray-100 text-gray-600'}`}>
          {unit.status}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono disabled:bg-slate-50"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          placeholder="Serial number"
          disabled={!editable || busy}
        />
        <input
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location"
          disabled={!editable || busy}
        />
      </div>
      {unit.installed_ttspl_id && (
        <p className="mt-1 text-[11px] text-teal-700 font-mono">Installed on {unit.installed_ttspl_id}</p>
      )}
      {unit.vendor_repair_dc_number && (
        <p className="mt-1 text-[11px] text-orange-700">
          On vendor DC{' '}
          <Link className="underline font-semibold" to={`/inventory-management/part-vendor-repair/${encodeURIComponent(unit.vendor_repair_dc_number)}`}>
            {unit.vendor_repair_dc_number}
          </Link>
        </p>
      )}
      {editable && (
        <div className="mt-2 flex flex-wrap gap-2">
          {dirty && (
            <button type="button" disabled={busy} onClick={() => save({ serial_number: serial, location_code: location })}
              className="inline-flex items-center gap-1 rounded-lg bg-teal-700 text-white px-2.5 py-1 text-xs font-semibold disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> Save
            </button>
          )}
          {unit.status === 'in_stock' ? (
            <>
              <button type="button" disabled={busy} onClick={() => save({ status: 'defective' })}
                className="rounded-lg border border-red-200 text-red-700 px-2.5 py-1 text-xs font-semibold disabled:opacity-50">
                Mark defective
              </button>
              <button type="button" disabled={busy} onClick={() => save({ status: 'discarded' })}
                className="rounded-lg border border-slate-200 text-slate-600 px-2.5 py-1 text-xs font-semibold disabled:opacity-50">
                Discard
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => save({ status: 'in_stock' })}
              className="rounded-lg border border-green-200 text-green-700 px-2.5 py-1 text-xs font-semibold disabled:opacity-50">
              Restore to stock
            </button>
          )}
          {canReturnToVendor && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setReturnOpen((v) => !v)}
              className="rounded-lg border border-orange-300 text-orange-800 px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
            >
              Return to Vendor
            </button>
          )}
        </div>
      )}
      {returnOpen && (
        <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 p-2 space-y-2">
          <textarea
            className="w-full rounded-lg border border-orange-200 px-2 py-1.5 text-xs"
            rows={2}
            placeholder="Reason (min 10 chars) — defective / DOA / wrong part / warranty…"
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={submitReturn}
              className="rounded-lg bg-orange-700 text-white px-2.5 py-1 text-xs font-semibold disabled:opacity-50">
              Confirm return
            </button>
            <button type="button" disabled={busy} onClick={() => setReturnOpen(false)}
              className="rounded-lg border px-2.5 py-1 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PartSerialsDrawer({ open, part, onClose, onChanged }) {
  const [loading, setLoading] = useState(false);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState('');

  const partId = part?.part_id;

  const load = useCallback(async () => {
    if (!partId) return;
    setLoading(true);
    try {
      const { data } = await listPartInstances({ part_id: partId, limit: 500 });
      setUnits(data.instances || []);
    } catch {
      toast.error('Failed to load serial numbers');
    } finally {
      setLoading(false);
    }
  }, [partId]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    load();
  }, [open, load]);

  const handleChanged = useCallback(() => {
    load();
    onChanged?.();
  }, [load, onChanged]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) =>
      String(u.serial_number || '').toLowerCase().includes(q) ||
      String(u.prt_id || '').toLowerCase().includes(q) ||
      String(u.location_code || '').toLowerCase().includes(q) ||
      String(u.status || '').toLowerCase().includes(q)
    );
  }, [units, search]);

  const counts = useMemo(() => {
    const c = {};
    units.forEach((u) => { c[u.status] = (c[u.status] || 0) + 1; });
    return c;
  }, [units]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-[520px] bg-white h-full shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-start justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Serial numbers</h2>
            <p className="text-sm text-slate-500">{part?.part_name}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">In stock: {counts.in_stock || 0}</span>
              {counts.reserved ? <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700">Reserved: {counts.reserved}</span> : null}
              {counts.installed ? <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-teal-100 text-teal-700">Installed: {counts.installed}</span> : null}
              {counts.defective ? <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">Defective: {counts.defective}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          <AddForm partId={partId} onAdded={handleChanged} />

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-sm"
              placeholder="Search serial, PRT-ID, location, status"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              {units.length ? 'No units match your search.' : 'No serial numbers yet. Add units above.'}
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((u) => (
                <UnitRow key={u.instance_id} unit={u} onSaved={handleChanged} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
