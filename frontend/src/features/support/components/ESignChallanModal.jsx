import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { signAndIssueChallan, returnPart, acceptReturn } from '../supportPartsApi';

/**
 * E-sign bottom-sheet for support part challans.
 * mode:
 *   'tech'   -> tech signs to receive parts (sign-and-issue)
 *   'return' -> warehouse signs to accept a returned part (needs requestId)
 */
export default function ESignChallanModal({ challan, mode = 'tech', requestId, viaPickup = false, onSigned, onClose }) {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [signerName, setSignerName] = useState(() => user?.name || user?.email || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loginName = user?.name || user?.email || '';
    if (!loginName) return;
    setSignerName((prev) => (prev?.trim() ? prev : loginName));
  }, [user?.name, user?.email]);

  useEffect(() => {
    let pad;
    import('signature_pad').then(({ default: SignaturePad }) => {
      if (canvasRef.current) {
        // Scale canvas for crisp lines on high-DPI screens.
        const canvas = canvasRef.current;
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext('2d').scale(ratio, ratio);
        pad = new SignaturePad(canvas, {
          backgroundColor: 'rgb(255,255,255)',
          penColor: '#1A1A2E',
          minWidth: 1.2,
          maxWidth: 2.8,
        });
        padRef.current = pad;
      }
    });
    return () => { if (pad) pad.off(); };
  }, []);

  const clear = () => padRef.current?.clear();

  const save = async () => {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error('Please sign before saving');
      return;
    }
    if (!signerName.trim()) {
      toast.error('Please enter your name');
      return;
    }
    setSaving(true);
    try {
      const dataUrl = padRef.current.toDataURL('image/png');
      if (mode === 'return') {
        const payload = { esign_data: dataUrl, signer_name: signerName.trim() };
        if (viaPickup) {
          await acceptReturn(requestId, payload);
        } else {
          await returnPart(requestId, { method: 'self', ...payload });
        }
        toast.success('Return confirmed. Stock updated.');
      } else {
        await signAndIssueChallan(challan.id, { esign_data: dataUrl, signer_name: signerName.trim() });
        toast.success('Signed! Parts issued to technician.');
      }
      onSigned();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Sign failed');
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'return'
    ? 'Warehouse Sign - Confirm Return'
    : 'Technician Sign - Parts Receipt';

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-gray-900">{title}</p>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-gray-500 mb-3">
          {challan?.challan_number && <>Challan: <strong>{challan.challan_number}</strong> · </>}
          {mode === 'return'
            ? 'Sign to confirm the part has been received back at the warehouse.'
            : 'Sign to confirm you have received the listed parts.'}
        </p>

        <input
          type="text"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="Enter your full name*"
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:ring-2 focus:ring-blue-500 outline-none"
        />

        <div className="border-2 border-gray-200 rounded-xl overflow-hidden mb-3">
          <p className="text-xs text-gray-400 px-3 pt-2 text-center">Sign below using finger or stylus</p>
          <canvas
            ref={canvasRef}
            className="w-full touch-none bg-white block"
            style={{ touchAction: 'none', height: 160 }}
          />
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={clear} className="flex-1 py-3 min-h-[44px] border border-gray-200 rounded-xl text-sm font-medium">
            Clear
          </button>
          <button type="button" onClick={onClose} className="flex-1 py-3 min-h-[44px] border border-gray-200 rounded-xl text-sm">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className="flex-[2] py-3 min-h-[44px] bg-blue-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
            {saving ? 'Saving…' : 'Confirm sign'}
          </button>
        </div>
      </div>
    </div>
  );
}
