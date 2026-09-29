import React, { useEffect, useRef } from 'react';
import SignaturePadLib from 'signature_pad';
import toast from 'react-hot-toast';
import Button from './Button';

/**
 * Signature capture in the Carret style. Same props as the old
 * features/sales-pipeline/components/SignaturePad — onSave(dataUrlPng) and
 * onCancel — so a screen swaps it by changing the import. `prompt` is the line
 * above the box (who signs).
 */
export default function SignaturePad({ onSave, onCancel, prompt = 'Sign in the box with a finger or stylus', saveLabel = 'Save signature' }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext('2d').scale(ratio, ratio);
      padRef.current?.clear();
    };
    padRef.current = new SignaturePadLib(canvas, { backgroundColor: 'rgb(255,255,255)', penColor: 'rgb(0,0,0)' });
    resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); padRef.current?.off(); };
  }, []);

  const save = () => {
    if (!padRef.current || padRef.current.isEmpty()) { toast.error('Sign in the box first'); return; }
    onSave?.(padRef.current.toDataURL('image/png'));
  };

  return (
    <div className="c-sign">
      <div className="c-note">{prompt}</div>
      <canvas ref={canvasRef} className="c-sign-canvas" aria-label="Signature box" />
      <div className="c-sign-actions">
        <Button variant="quiet" onClick={() => padRef.current?.clear()}>Clear</Button>
        {onCancel && <Button variant="quiet" onClick={onCancel}>Cancel</Button>}
        <Button variant="primary" onClick={save}>{saveLabel}</Button>
      </div>
    </div>
  );
}
