import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Loader2, Plus, Search, Check, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listPartInstances,
  addPartInstances,
  updatePartInstance,
  updatePartInstanceFitment,
  bulkUpdatePartInstanceFitment,
} from '../../floor-pipeline/partRequestsApi';
import { createPartVendorReturnDc } from '../partVendorRepairApi';
import FitmentControls, { emptyFitment, formatFitmentSummary } from './FitmentControls';

const STATUS_COLORS = {
  in_stock: 'bg-green-100 text-green-700',
  reserved: 'bg-blue-100 text-blue-700',
  installed: 'bg-teal-100 text-teal-700',
  defective: 'bg-red-100 text-red-700',
  returned: 'bg-amber-100 text-amber-700',
  discarded: 'bg-gray-100 text-gray-600',
  scrapped: 'bg-stone-200 text-stone-700',
  sold: 'bg-purple-100 text-purple-700',
  with_technician: 'bg-indigo-100 text-indigo-700',
  with_vendor_repair: 'bg-orange-100 text-orange-800',
  qc_pending: 'bg-yellow-100 text-yellow-800',
};

// Only free stock can be reclassified from the UI (workflow statuses are locked).
const EDITABLE = new Set(['in_stock', 'defective', 'discarded']);

function fitmentFromUnit(unit) {
  const f = String(unit?.fitment || 'unset').toLowerCase();
  if (f === 'universal') {
    return { fitment: 'universal', fits_laptop_brand: null, fits_laptop_models: [] };
  }
  if (f === 'specific') {
    return {
      fitment: 'specific',
      fits_laptop_brand: unit.fits_laptop_brand || null,
      fits_laptop_models: Array.isArray(unit.fits_laptop_models)
        ? unit.fits_laptop_models.map((m) => String(m).trim()).filter(Boolean)
        : [],
    };
  }
  return emptyFitment();
}

function StockForm({ partId, editingUnit, onCancelEdit, onSaved }) {
  const isEdit = Boolean(editingUnit?.instance_id);
  const [serials, setSerials] = useState('');
  const [location, setLocation] = useState('');
  const [cost, setCost] = useState('');
  const [fitment, setFitment] = useState(emptyFitment);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editingUnit) {
      setSerials('');
      setLocation('');
      setCost('');
      setFitment(emptyFitment());
      return;
    }
    setSerials(editingUnit.serial_number || '');
    setLocation(editingUnit.location_code || '');
    setCost(
      editingUnit.unit_cost != null && editingUnit.unit_cost !== ''
        ? String(editingUnit.unit_cost)
        : ''
    );
    setFitment(fitmentFromUnit(editingUnit));
  }, [editingUnit]);

  const resetAdd = () => {
    setSerials('');
    setLocation('');
    setCost('');
    setFitment(emptyFitment());
  };

  const submit = async (e) => {
    e.preventDefault();
    if (fitment.fitment === 'specific' && !fitment.fits_laptop_brand) {
      toast.error('Pick a laptop brand for specific fitment');
      return;
    }

    if (isEdit) {
      setBusy(true);
      try {
        await updatePartInstance(editingUnit.instance_id, {
          serial_number: serials.trim() || null,
          location_code: location || null,
          unit_cost: cost === '' ? undefined : Number(cost),
        });
        await updatePartInstanceFitment(editingUnit.instance_id, {
          fitment: fitment.fitment,
          fits_laptop_brand: fitment.fits_laptop_brand,
          fits_laptop_models: fitment.fits_laptop_models,
          reason: 'Edited from Parts Inventory serials drawer',
        });
        toast.success('Unit updated');
        onCancelEdit?.();
        onSaved?.();
      } catch (err) {
        toast.error(err.response?.data?.message || 'Update failed');
      } finally {
        setBusy(false);
      }
      return;
    }

    const list = serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) {
      toast.error('Enter at least one serial number');
      return;
    }
    setBusy(true);
    try {
      const { data } = await addPartInstances({
        part_id: partId,
        serial_numbers: list,
        unit_cost: cost === '' ? undefined : Number(cost),
        location_code: location || undefined,
        fitment: fitment.fitment,
        fits_laptop_brand: fitment.fits_laptop_brand,
        fits_laptop_models: fitment.fits_laptop_models,
      });
      toast.success(data.message || `${list.length} unit(s) added`);
      resetAdd();
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add units');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      data-stock-form-top
      onSubmit={submit}
      className={`rounded-xl border p-3 space-y-3 ${
        isEdit ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">
          {isEdit ? `Edit unit · ${editingUnit.prt_id || ''}` : 'Add serial numbers'}
        </p>
        {isEdit ? (
          <button
            type="button"
            onClick={onCancelEdit}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            Cancel edit
          </button>
        ) : null}
      </div>
      <label className="block text-sm">
        <span className="text-xs text-slate-500">
          {isEdit
            ? 'Serial number'
            : 'Serial number(s) — one per line, or comma-separated'}
        </span>
        {isEdit ? (
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
            value={serials}
            onChange={(e) => setSerials(e.target.value)}
            placeholder="Serial number"
          />
        ) : (
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
            rows={2}
            placeholder={'SN-12345\nSN-12346'}
            value={serials}
            onChange={(e) => setSerials(e.target.value)}
          />
        )}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="text-xs text-slate-500">Location</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Shelf A-3"
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-slate-500">Unit cost (₹)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="defaults to part cost"
          />
        </label>
      </div>
      <FitmentControls
        compact
        label="Laptop fitment"
        value={fitment}
        onChange={setFitment}
        allowUnset
      />
      <button
        type="submit"
        disabled={busy}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
          isEdit ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
        {isEdit ? 'Save changes' : 'Add to stock'}
      </button>
    </form>
  );
}

function UnitRow({ unit, onSaved, onEdit, isEditing }) {
  const [busy, setBusy] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const editable = EDITABLE.has(unit.status);
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
    <div className={`rounded-lg border p-3 ${isEditing ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-slate-500">{unit.prt_id}</span>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[unit.status] || 'bg-gray-100 text-gray-600'}`}>
          {unit.status}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <p className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 font-mono text-slate-800">
          {unit.serial_number || '—'}
        </p>
        <p className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-slate-700">
          {unit.location_code || 'No location'}
        </p>
      </div>
      {(unit.fitment && unit.fitment !== 'unset') || unit.brand_name || unit.brand ? (
        <p className="mt-1.5 text-xs text-slate-600">
          {[
            unit.fitment === 'universal' && 'Fits: Universal',
            unit.fitment === 'specific' && `Fits: ${unit.fits_laptop_brand || '?'}${
              Array.isArray(unit.fits_laptop_models) && unit.fits_laptop_models.length
                ? ` · ${unit.fits_laptop_models.join(', ')}`
                : ' · all models'
            }`,
            (unit.brand_name || unit.brand) && `Part brand: ${unit.brand_name || unit.brand}`,
          ].filter(Boolean).join(' · ')}
        </p>
      ) : null}
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
          <button
            type="button"
            disabled={busy}
            onClick={() => onEdit?.(unit)}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
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

/**
 * Stock that predates fitment tagging is 'unset', and an unset unit shows up for
 * every laptop — which is exactly the "it lists all the parts" complaint. Tagging
 * 1600+ units one at a time is not realistic, so this tags a whole part at once.
 */
function BulkFitmentPanel({ partId, units, onSaved }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('untagged');
  const [fitment, setFitment] = useState(emptyFitment);
  const [busy, setBusy] = useState(false);

  const untagged = units.filter((u) => String(u.fitment || 'unset') === 'unset').length;
  const target = scope === 'untagged' ? untagged : units.length;

  useEffect(() => {
    if (!open) {
      setFitment(emptyFitment());
      setScope('untagged');
    }
  }, [open]);

  if (!units.length) return null;

  const apply = async () => {
    if (fitment.fitment === 'unset') {
      toast.error('Pick Universal or Specific — "Unset" is what you are clearing');
      return;
    }
    if (fitment.fitment === 'specific' && !fitment.fits_laptop_brand) {
      toast.error('Pick a laptop brand for specific fitment');
      return;
    }
    if (!window.confirm(`Tag ${target} unit(s) as "${formatFitmentSummary(fitment)}"?`)) return;
    setBusy(true);
    try {
      const { data } = await bulkUpdatePartInstanceFitment({
        part_id: partId,
        only_untagged: scope === 'untagged',
        fitment: fitment.fitment,
        fits_laptop_brand: fitment.fits_laptop_brand,
        fits_laptop_models: fitment.fits_laptop_models,
        reason: 'Bulk tagged from Parts Inventory serials drawer',
      });
      toast.success(`${data.updated || 0} unit(s) tagged`);
      setOpen(false);
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Bulk tagging failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-sm font-semibold text-slate-700">Tag fitment in bulk</span>
        <span className="text-[11px] text-slate-500">
          {untagged ? `${untagged} untagged` : 'all tagged'}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            {[
              { id: 'untagged', label: `Untagged only (${untagged})` },
              { id: 'all', label: `All units (${units.length})` },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setScope(o.id)}
                className={`px-3 py-1.5 text-[11px] font-semibold border-r border-slate-200 last:border-r-0 ${
                  scope === o.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <FitmentControls
            compact
            label="Laptop fitment to apply"
            value={fitment}
            onChange={setFitment}
            allowUnset={false}
          />

          <button
            type="button"
            onClick={apply}
            disabled={busy || !target}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Apply to {target} unit{target === 1 ? '' : 's'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function PartSerialsDrawer({ open, part, onClose, onChanged }) {
  const [loading, setLoading] = useState(false);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState('');
  const [editingUnit, setEditingUnit] = useState(null);

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
    setEditingUnit(null);
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
      String(u.status || '').toLowerCase().includes(q) ||
      String(u.brand_name || u.brand || '').toLowerCase().includes(q) ||
      String(u.model_name || u.model || '').toLowerCase().includes(q) ||
      String(u.fits_laptop_brand || '').toLowerCase().includes(q)
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
          <StockForm
            partId={partId}
            editingUnit={editingUnit}
            onCancelEdit={() => setEditingUnit(null)}
            onSaved={handleChanged}
          />

          <BulkFitmentPanel partId={partId} units={units} onSaved={handleChanged} />

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
                <UnitRow
                  key={u.instance_id}
                  unit={u}
                  onSaved={handleChanged}
                  onEdit={(unit) => {
                    setEditingUnit(unit);
                    // Scroll form into view for clarity on long lists
                    window.requestAnimationFrame(() => {
                      document.querySelector('[data-stock-form-top]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });
                  }}
                  isEditing={editingUnit?.instance_id === u.instance_id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
