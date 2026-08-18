import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { confirmReturnDcWarehouse } from '../salesPipelineApi';

/** Warehouse e-sign for a Return DC from Delivery Register. */
export default function ReturnWarehouseReceiveModal({ dc, onClose, onReceived }) {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [name, setName] = useState(() => user?.name || user?.email || '');
  const [saving, setSaving] = useState(false);
  const rdcNumber = dc?.dc_number;

  useEffect(() => {
    const loginName = user?.name || user?.email || '';
    if (!loginName) return;
    setName((prev) => (prev?.trim() ? prev : loginName));
  }, [user?.name, user?.email]);

  useEffect(() => {
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
  }, []);

  const submit = async () => {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error('Please sign');
      return;
    }
    if (!name.trim()) {
      toast.error('Enter your name');
      return;
    }
    setSaving(true);
    try {
      await confirmReturnDcWarehouse(rdcNumber, {
        esign_data: padRef.current.toDataURL('image/png'),
        signer_name: name.trim(),
      });
      toast.success(`Warehouse receipt confirmed for ${rdcNumber}`);
      onReceived?.();
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to confirm receipt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Warehouse receive — {rdcNumber}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          {dc.customer_name} · {(dc.serials || []).length || 1} unit(s) — confirms all laptops on this Return DC.
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Warehouse staff name*"
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
        />
        <div className="border-2 border-gray-200 rounded-lg overflow-hidden mb-3 bg-white">
          <canvas ref={canvasRef} className="w-full h-32 touch-none block" style={{ touchAction: 'none' }} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => padRef.current?.clear()} className="flex-1 py-2 border rounded-lg text-sm">Clear</button>
          <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="flex-[2] py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Confirming…' : 'Confirm receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}
