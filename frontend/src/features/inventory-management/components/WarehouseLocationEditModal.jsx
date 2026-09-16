import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import { fetchCarretAvailability, updateInventoryWarehouseLocation } from '../inventoryManagementApi';

const CARRETS = Array.from({ length: 30 }, (_, i) => i + 1);
const SLOTS_PER_CARRET = 17;

function locationLabel(carret, slot) {
  if (!carret || !slot) return '—';
  return `Carret ${carret} / Slot ${slot}`;
}

export default function WarehouseLocationEditModal({ open, row, onClose, onSaved }) {
  const currentCarret = row?.warehouse_carret != null ? Number(row.warehouse_carret) : '';
  const currentSlot = row?.warehouse_carret_slot != null ? Number(row.warehouse_carret_slot) : '';
  const [carret, setCarret] = useState('');
  const [slot, setSlot] = useState('');
  const [carretInfo, setCarretInfo] = useState(null);
  const [loadingCarret, setLoadingCarret] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    setCarret(currentCarret ? String(currentCarret) : '');
    setSlot(currentSlot ? String(currentSlot) : '');
    setCarretInfo(null);
  }, [open, row, currentCarret, currentSlot]);

  const loadCarret = useCallback(async (carretNum) => {
    if (!carretNum) {
      setCarretInfo(null);
      return;
    }
    setLoadingCarret(true);
    try {
      const { data } = await fetchCarretAvailability(carretNum);
      setCarretInfo(data.data || null);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load carret availability');
      setCarretInfo(null);
    } finally {
      setLoadingCarret(false);
    }
  }, []);

  useEffect(() => {
    if (open && carret) loadCarret(Number(carret));
  }, [open, carret, loadCarret]);

  const occupiedByOthers = useMemo(() => {
    const used = new Set();
    for (const s of carretInfo?.slots || []) {
      const slotNum = Number(s.slot);
      const sameUnit = Number(s.serial_id) === Number(row?.serial_id);
      if (!sameUnit) used.add(slotNum);
    }
    return used;
  }, [carretInfo, row?.serial_id]);

  const availableSlots = useMemo(() => {
    const list = [];
    for (let i = 1; i <= SLOTS_PER_CARRET; i += 1) {
      if (!occupiedByOthers.has(i)) list.push(i);
    }
    return list;
  }, [occupiedByOthers]);

  const occupiedCount = occupiedByOthers.size;
  const fullForOthers = occupiedCount >= SLOTS_PER_CARRET && !availableSlots.length;

  const submit = async () => {
    if (!row?.serial_id) return;
    if (!carret || !slot) {
      toast.error('Select warehouse carret and slot');
      return;
    }
    if (Number(carret) === Number(currentCarret) && Number(slot) === Number(currentSlot)) {
      toast.error('Choose a different location');
      return;
    }
    setSaving(true);
    try {
      const { data } = await updateInventoryWarehouseLocation(row.serial_id, {
        warehouse_carret: Number(carret),
        warehouse_carret_slot: Number(slot),
      });
      toast.success(data.message || 'Location updated');
      onSaved?.(data.data);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to update location');
    } finally {
      setSaving(false);
    }
  };

  if (!open || !row) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-slate-900">Change warehouse location</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-slate-600">
          {row.unique_product_serial || row.inventory_asset_code || row.serial_number}
          <span className="block text-xs text-slate-500 mt-1">
            Current: {locationLabel(currentCarret, currentSlot)}
          </span>
        </p>
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">Warehouse Carret (1–30) *</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={carret}
            onChange={(e) => {
              setCarret(e.target.value);
              setSlot('');
            }}
          >
            <option value="">Select carret</option>
            {CARRETS.map((c) => (
              <option key={c} value={c}>Carret {c}</option>
            ))}
          </select>
        </label>
        {carret ? (
          <div className="text-xs text-slate-500">
            {loadingCarret ? 'Checking capacity…' : (
              fullForOthers
                ? <span className="text-amber-700">This carret is full (17/17).</span>
                : <span>{occupiedCount}/17 occupied · {availableSlots.length} slots free</span>
            )}
          </div>
        ) : null}
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">Slot (1–17) *</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            disabled={!carret || loadingCarret || fullForOthers}
          >
            <option value="">Select slot</option>
            {availableSlots.map((s) => (
              <option key={s} value={s}>Slot {s}</option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm border rounded-lg">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !carret || !slot}
            onClick={submit}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-teal-600 text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save location'}
          </button>
        </div>
      </div>
    </div>
  );
}
