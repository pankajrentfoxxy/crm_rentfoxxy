import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { getRefusedReturnUnits, receiveRefusedReturn } from '../salesPipelineApi';

const norm = (v) => String(v ?? '').trim().toUpperCase();

function configLine(unit) {
  return [unit.brand, unit.model, unit.processor, unit.generation, unit.ram, unit.storage, unit.gpu, unit.screen_size]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Warehouse "Receive Back" for a customer-refused delivery challan.
 * Verifies the TTSPL + serial of every unit against the challan, then captures the
 * receiver name, e-signature and remarks — the same inward the support Return DC uses.
 */
export default function RefusedWarehouseReceiveModal({ dcNumber, customerName, onClose, onReceived }) {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [units, setUnits] = useState([]);
  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(() => user?.name || user?.email || '');
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    const loginName = user?.name || user?.email || '';
    if (!loginName) return;
    setName((prev) => (prev?.trim() ? prev : loginName));
  }, [user?.name, user?.email]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getRefusedReturnUnits(dcNumber);
      const list = r.data?.units || [];
      setUnits(list);
      setEntries(Object.fromEntries(list.map((_, i) => [i, { ttspl: '', serial_number: '' }])));
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load units on this challan');
    } finally {
      setLoading(false);
    }
  }, [dcNumber]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (loading) return undefined;
    let pad;
    import('signature_pad').then(({ default: SP }) => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext('2d').scale(ratio, ratio);
      pad = new SP(canvas, { backgroundColor: '#fff', penColor: '#1A1A2E', minWidth: 1.5, maxWidth: 3 });
      padRef.current = pad;
    });
    return () => { pad?.off?.(); };
  }, [loading]);

  const setEntry = (i, field, value) => setEntries((prev) => ({
    ...prev,
    [i]: { ...(prev[i] || { ttspl: '', serial_number: '' }), [field]: value },
  }));

  // A unit is verified when the typed TTSPL and serial both match the challan record.
  const unitMatches = (unit, i) => {
    const entry = entries[i] || {};
    const ttsplOk = !unit.ttspl || norm(entry.ttspl) === norm(unit.ttspl);
    const serialOk = !unit.serial_number || norm(entry.serial_number) === norm(unit.serial_number);
    const typedSomething = Boolean(norm(entry.ttspl) || norm(entry.serial_number));
    return typedSomething && ttsplOk && serialOk;
  };

  const allVerified = units.length > 0 && units.every(unitMatches);

  const submit = async () => {
    if (!allVerified) { toast.error('Verify the TTSPL ID and serial number of every unit'); return; }
    if (!name.trim()) { toast.error('Enter the warehouse receiver name'); return; }
    if (!padRef.current || padRef.current.isEmpty()) { toast.error('Warehouse e-signature is required'); return; }
    setSaving(true);
    try {
      await receiveRefusedReturn(dcNumber, {
        esign_data: padRef.current.toDataURL('image/png'),
        signer_name: name.trim(),
        remarks: remarks.trim() || undefined,
        units: units.map((u, i) => ({
          ttspl: (entries[i]?.ttspl || u.ttspl || '').trim(),
          serial_number: (entries[i]?.serial_number || u.serial_number || '').trim(),
        })),
      });
      toast.success('Received back at the warehouse — units returned to stock');
      onReceived?.();
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to receive units back');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-semibold text-gray-900">Receive Back — {dcNumber}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Customer refused this delivery{customerName ? ` (${customerName})` : ''}. Verify each unit, then sign the
          inward — the laptops go back to warehouse stock and re-enter QC.
        </p>

        {loading ? (
          <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading units…</p>
        ) : units.length === 0 ? (
          <p className="text-sm text-gray-500">No units found on this challan.</p>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              {units.map((unit, i) => {
                const ok = unitMatches(unit, i);
                return (
                  <div key={unit.serial_id || i} className={`border rounded-lg p-3 ${ok ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-200'}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{unit.ttspl || unit.serial_number || `Unit ${i + 1}`}</p>
                        <p className="text-xs text-gray-500 break-words">{configLine(unit) || '—'}</p>
                      </div>
                      {ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={entries[i]?.ttspl || ''}
                        onChange={(e) => setEntry(i, 'ttspl', e.target.value)}
                        placeholder="TTSPL ID*"
                        className="border rounded-lg px-2 py-1.5 text-sm"
                      />
                      <input
                        value={entries[i]?.serial_number || ''}
                        onChange={(e) => setEntry(i, 'serial_number', e.target.value)}
                        placeholder="Serial number*"
                        className="border rounded-lg px-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Warehouse receiver name*"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
            />
            <textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Receive remarks (optional)"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
            />
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Warehouse e-signature*</p>
            <div className="border-2 border-gray-200 rounded-lg overflow-hidden mb-3 bg-white">
              <canvas ref={canvasRef} className="w-full h-32 touch-none block" style={{ touchAction: 'none' }} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => padRef.current?.clear()} className="flex-1 py-2 border rounded-lg text-sm">Clear</button>
              <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
              <button
                type="button"
                onClick={submit}
                disabled={saving || !allVerified}
                className="flex-[2] py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {saving ? 'Receiving…' : 'Confirm receipt'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
