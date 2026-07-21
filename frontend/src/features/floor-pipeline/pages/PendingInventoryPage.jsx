import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, PackageCheck, X } from 'lucide-react';
import usePermission from '../../../hooks/usePermission';
import {
  fetchCarretAvailability,
  fetchPendingInventory,
  receiveProductionAsset,
} from '../floorPipelineApi';

const CARRETS = Array.from({ length: 30 }, (_, i) => i + 1);
const TAG_LABELS = { rental: 'Rental', sale: 'Sale', both: 'Rental + Sale' };

function fmtConfig(row) {
  return [row.brand, row.model, row.processor, row.generation, row.ram, row.ssd || row.storage]
    .filter(Boolean)
    .join(' · ') || '—';
}

function fmtSource(row) {
  const v = row.qc2_verification || {};
  if (v.source === 'dispatch_qc') {
    const reason = v.reason === 'config_mismatch' ? 'config mismatch' : (v.reason || 'failed');
    return `Dispatch QC · ${reason}`;
  }
  if (v.source === 'qc2_script' || v.source === 'qc2') return 'QC2';
  return v.source || 'QC2';
}

function fmtWhen(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function fmtTag(tag) {
  if (!tag) return '—';
  return TAG_LABELS[tag] || tag;
}

export default function PendingInventoryPage() {
  const { canEdit } = usePermission();
  const canReceive = canEdit('pending_inventory');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [receiveFor, setReceiveFor] = useState(null);
  const [serialInput, setSerialInput] = useState('');
  const [carret, setCarret] = useState('');
  const [slot, setSlot] = useState('');
  const [carretInfo, setCarretInfo] = useState(null);
  const [loadingCarret, setLoadingCarret] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchPendingInventory();
      setRows(data.data || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load pending inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadCarret = useCallback(async (carretNum) => {
    if (!carretNum) {
      setCarretInfo(null);
      setSlot('');
      return;
    }
    setLoadingCarret(true);
    try {
      const { data } = await fetchCarretAvailability(carretNum);
      setCarretInfo(data.data || null);
      const next = data.data?.next_available_slot;
      setSlot(next ? String(next) : '');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load carret availability');
      setCarretInfo(null);
    } finally {
      setLoadingCarret(false);
    }
  }, []);

  useEffect(() => {
    if (receiveFor && carret) loadCarret(Number(carret));
  }, [receiveFor, carret, loadCarret]);

  const occupiedSlots = useMemo(
    () => new Set((carretInfo?.slots || []).map((s) => Number(s.slot))),
    [carretInfo]
  );

  const availableSlots = useMemo(() => {
    const list = [];
    for (let i = 1; i <= 17; i += 1) {
      if (!occupiedSlots.has(i)) list.push(i);
    }
    return list;
  }, [occupiedSlots]);

  const openReceive = (row) => {
    setReceiveFor(row);
    setSerialInput('');
    setCarret('');
    setSlot('');
    setCarretInfo(null);
  };

  const submitReceive = async () => {
    if (!receiveFor || !serialInput.trim()) {
      toast.error('Enter the serial number');
      return;
    }
    if (!carret || !slot) {
      toast.error('Select warehouse carret and slot');
      return;
    }
    if (carretInfo?.full && !occupiedSlots.has(Number(slot))) {
      toast.error(`Carret ${carret} is full — choose another carret`);
      return;
    }
    setSaving(true);
    try {
      await receiveProductionAsset(receiveFor.production_asset_id, {
        serial_number: serialInput.trim(),
        warehouse_carret: Number(carret),
        warehouse_carret_slot: Number(slot),
      });
      toast.success('Received into Ready to Rent/Sell');
      setReceiveFor(null);
      setSerialInput('');
      setCarret('');
      setSlot('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Receive failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <PackageCheck className="w-6 h-6 text-teal-600" />
            Pending Inventory
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Units awaiting serial-verified receive with warehouse location (from QC2 or Dispatch QC).
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-sm px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-slate-500 text-sm">
          No units pending receive.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">TTSPL</th>
                <th className="px-3 py-2">Configuration</th>
                <th className="px-3 py-2">Tagged As</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">QC2 By</th>
                <th className="px-3 py-2">QC2 Time</th>
                <th className="px-3 py-2">Status</th>
                {canReceive ? <th className="px-3 py-2">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.production_asset_id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    {row.ticket_id ? (
                      <Link className="text-blue-600 hover:underline" to={`/floor-pipeline/tickets/${row.ticket_id}`}>
                        #{row.ticket_id}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 font-medium">{row.ttspl_id || '—'}</td>
                  <td className="px-3 py-2 max-w-xs truncate" title={fmtConfig(row)}>{fmtConfig(row)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtTag(row.inventory_tag)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{fmtSource(row)}</td>
                  <td className="px-3 py-2">{row.qc2_completed_by_name || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtWhen(row.qc2_completed_at)}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-xs font-medium">
                      Pending receive
                    </span>
                  </td>
                  {canReceive ? (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => openReceive(row)}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                      >
                        Receive
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {receiveFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setReceiveFor(null)} aria-label="Close" />
          <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-slate-900">Receive into Inventory</h3>
              <button type="button" onClick={() => setReceiveFor(null)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              TTSPL <strong>{receiveFor.ttspl_id || '—'}</strong>
              {receiveFor.inventory_tag ? (
                <> · Tagged as <strong>{fmtTag(receiveFor.inventory_tag)}</strong></>
              ) : null}
            </p>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Serial Number *</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                placeholder="Scan or type serial"
                autoFocus
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Warehouse Carret (1–30) *</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={carret}
                onChange={(e) => setCarret(e.target.value)}
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
                  <>
                    {carretInfo?.full
                      ? <span className="text-amber-700">This carret is full (17/17).</span>
                      : <span>{carretInfo?.count || 0}/17 occupied · {availableSlots.length} slots free</span>}
                  </>
                )}
              </div>
            ) : null}
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Slot (1–17) *</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                disabled={!carret || loadingCarret || (carretInfo?.full && !availableSlots.length)}
              >
                <option value="">Select slot</option>
                {availableSlots.map((s) => (
                  <option key={s} value={s}>Slot {s}</option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReceiveFor(null)} className="px-3 py-2 text-sm border rounded-lg">
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || (carretInfo?.full && !slot)}
                onClick={submitReceive}
                className="px-3 py-2 text-sm rounded-lg bg-teal-600 text-white disabled:opacity-50"
              >
                {saving ? 'Receiving…' : 'Confirm Receive'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
