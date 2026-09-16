import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import ScanField from '../../components/ScanField';
import { scanDispatchQcCharger } from './dispatchChargerApi';

export default function DispatchQcSubmitScanModal({
  open,
  ticket,
  charger,
  onClose,
  onMatched,
}) {
  const [ttspl, setTtspl] = useState('');
  const [chargerScan, setChargerScan] = useState('');
  const [cableScan, setCableScan] = useState('');
  const [saving, setSaving] = useState(false);
  const needsCharger = charger?.disposition === 'attach';
  const needsCable = Boolean(charger?.cable_label || charger?.needs_both_kit_scans);

  if (!open) return null;

  const submit = async () => {
    if (!ttspl.trim()) {
      toast.error('Scan the laptop TTSPL ID');
      return;
    }
    if (needsCharger && !chargerScan.trim()) {
      toast.error('Scan the charger attached to this laptop');
      return;
    }
    if (needsCable && !cableScan.trim()) {
      toast.error('Scan the power cable attached to this laptop');
      return;
    }
    setSaving(true);
    try {
      const { data } = await scanDispatchQcCharger(ticket.ticket_id, {
        ttspl_scan: ttspl,
        adapter_scan: chargerScan,
        charger_scan: chargerScan,
        cable_scan: cableScan,
      });
      toast.success(data.message || 'Scan matched');
      onMatched?.(data.data);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Scan did not match');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-slate-900">Scan before Dispatch QC submit</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-slate-600">
          {needsCharger
            ? `Scan ${charger?.ttspl_id || 'the laptop TTSPL'}, adapter ${charger?.adapter_label || ''}, and power cable ${charger?.cable_label || ''}.`
            : `Scan ${charger?.ttspl_id || 'the laptop TTSPL ID'} to confirm this unit.`}
        </p>
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">Laptop TTSPL ID</span>
          <ScanField
            value={ttspl}
            onChange={setTtspl}
            placeholder="Scan TTSPL ID"
            autoFocus
            aria-label="Scan TTSPL ID"
            className="mt-1"
          />
        </label>
        {needsCharger ? (
          <>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">Laptop charger / adapter</span>
              <ScanField
                value={chargerScan}
                onChange={setChargerScan}
                placeholder="Scan adapter PRT"
                aria-label="Scan adapter"
                className="mt-1"
              />
            </label>
            {needsCable ? (
              <label className="block text-sm">
                <span className="text-xs font-medium text-slate-600">Power cable</span>
                <ScanField
                  value={cableScan}
                  onChange={setCableScan}
                  placeholder="Scan power cable PRT"
                  aria-label="Scan power cable"
                  className="mt-1"
                />
              </label>
            ) : null}
          </>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm border rounded-lg">Cancel</button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-teal-600 text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Checking…' : 'Confirm scan'}
          </button>
        </div>
      </div>
    </div>
  );
}
