import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Loader2, PlugZap } from 'lucide-react';
import ScanField from '../../components/ScanField';
import {
  fetchPickupCharger,
  fetchReturnDcChargers,
  scanPickupCharger,
  scanReturnDcCharger,
} from './dispatchChargerApi';

export default function PickupChargerScanPanel({
  pickupItemId,
  rdcNumber,
  onScanned,
}) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [ttspl, setTtspl] = useState('');
  const [chargerScan, setChargerScan] = useState('');
  const [cableScan, setCableScan] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (pickupItemId) {
        const { data } = await fetchPickupCharger(pickupItemId);
        setState(data.data || null);
      } else if (rdcNumber) {
        const { data } = await fetchReturnDcChargers(rdcNumber);
        const units = data.data?.units || [];
        const needed = units.find((u) => u.required && !u.scanned) || units[0] || null;
        setState(needed);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load charger');
    } finally {
      setLoading(false);
    }
  }, [pickupItemId, rdcNumber]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking charger sent with this laptop…
      </div>
    );
  }

  if (!state?.required) return null;

  if (state.scanned) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
        <span className="text-xs text-green-800 font-medium">
          Laptop, charger, and power cable scanned — {state.charger?.charger_label || 'matched'}
        </span>
      </div>
    );
  }

  const submit = async () => {
    if (!ttspl.trim() || !chargerScan.trim()) {
      toast.error('Scan the laptop TTSPL ID and the charger we sent');
      return;
    }
    if ((state.charger?.cable_label || state.charger?.needs_both_kit_scans) && !cableScan.trim()) {
      toast.error('Scan the power cable we sent with this laptop');
      return;
    }
    setBusy(true);
    try {
      const payload = { ttspl_scan: ttspl, adapter_scan: chargerScan, charger_scan: chargerScan, cable_scan: cableScan };
      if (pickupItemId) await scanPickupCharger(pickupItemId, payload);
      else await scanReturnDcCharger(rdcNumber, payload);
      toast.success('Laptop and charger matched');
      await load();
      onScanned?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'This is a different charger. Scan the charger we sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 space-y-2">
      <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
        <PlugZap className="w-4 h-4 text-amber-700" />
        Scan TTSPL ID, charger, and power cable we sent
      </p>
      <p className="text-xs text-gray-600">
        Laptop {state.ttspl_id || 'TTSPL'} · adapter {state.charger?.adapter_label || 'PRT'} · cable {state.charger?.cable_label || 'PRT'}
      </p>
      <ScanField
        value={ttspl}
        onChange={setTtspl}
        placeholder="Scan laptop TTSPL ID"
        aria-label="Scan TTSPL ID"
      />
      <ScanField
        value={chargerScan}
        onChange={setChargerScan}
        placeholder="Scan charger / adapter we sent"
        aria-label="Scan charger"
      />
      <ScanField
        value={cableScan}
        onChange={setCableScan}
        placeholder="Scan power cable we sent"
        aria-label="Scan power cable"
      />
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="w-full py-3 bg-amber-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Confirm laptop + charger + cable'}
      </button>
    </div>
  );
}
