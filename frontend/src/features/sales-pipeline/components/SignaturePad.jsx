import React, { useEffect, useRef } from 'react';
import SignaturePad from 'signature_pad';
import toast from 'react-hot-toast';

export default function SignaturePadComponent({ onSave, onCancel }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const canvas = canvasRef.current;
    // Match the drawing buffer to the displayed size for crisp strokes.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      padRef.current?.clear();
    };
    padRef.current = new SignaturePad(canvas, {
      backgroundColor: 'rgb(255,255,255)',
      penColor: 'rgb(0,0,0)',
    });
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const handleSave = () => {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error('Please sign before saving');
      return;
    }
    onSave(padRef.current.toDataURL('image/png'));
  };

  return (
    <div className="border-2 border-dashed border-gray-300 rounded-xl p-2">
      <p className="text-xs text-gray-500 mb-2 text-center">
        Ask the customer to sign below using finger or stylus
      </p>
      <canvas
        ref={canvasRef}
        className="w-full h-48 touch-none rounded-lg bg-white border"
      />
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={() => padRef.current?.clear()}
          className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">
          Clear
        </button>
        <button type="button" onClick={onCancel}
          className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">
          Cancel
        </button>
        <button type="button" onClick={handleSave}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold">
          Save Signature
        </button>
      </div>
    </div>
  );
}
