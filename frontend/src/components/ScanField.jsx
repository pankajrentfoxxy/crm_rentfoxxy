import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import CameraScanner from './CameraScanner';

function looksCompleteScan(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (/^TTSPL\d{3,}$/i.test(s)) return true;
  if (/^(G?DC|RDC|SDC|VRDC|GRN|SO)\/.+/i.test(s)) return true;
  if (/RFXG1\|/i.test(s)) return true;
  if (/^[A-Z0-9]{10,32}$/i.test(s) && !/\s/.test(s) && !/^TTSPL/i.test(s)) return true;
  return false;
}

/**
 * Text input that accepts a USB "gun" scanner as well as typing, with an
 * optional camera fallback for phones.
 *
 * Hardware scanners behave like a keyboard and finish with Enter, so the plain
 * input already works; `onScan` fires on Enter (or on a camera read) and is
 * where the caller should look the code up.
 */
export default function ScanField({
  value,
  onChange,
  onScan,
  placeholder = 'Scan or type…',
  disabled = false,
  autoFocus = false,
  camera = true,
  id,
  className = '',
  'aria-label': ariaLabel,
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const onScanRef = useRef(onScan);
  const lastEmittedRef = useRef('');
  onScanRef.current = onScan;

  useEffect(() => {
    if (disabled) return undefined;
    const text = String(value || '').trim();
    if (!text) {
      lastEmittedRef.current = '';
      return undefined;
    }
    if (!looksCompleteScan(text) || lastEmittedRef.current === text) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const next = String(value || '').trim();
      if (!looksCompleteScan(next) || lastEmittedRef.current === next) return;
      lastEmittedRef.current = next;
      onScanRef.current?.(next);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [value, disabled]);

  const handleCameraRead = useCallback((decoded) => {
    const text = String(decoded || '').trim();
    if (!text) return;
    setCameraOpen(false);
    onChange?.(text);
    onScan?.(text);
  }, [onChange, onScan]);

  return (
    <>
      <div className={`flex items-stretch gap-2 ${className}`}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-label={ariaLabel}
          className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono uppercase
            focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none disabled:opacity-50"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const text = String(value || '').trim();
            if (!text) return;
            lastEmittedRef.current = text;
            onScan?.(text);
          }}
        />
        {camera ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCameraOpen(true)}
            className="shrink-0 grid place-items-center w-11 rounded-xl border border-slate-200 text-slate-600
              hover:bg-slate-50 disabled:opacity-50"
            aria-label="Scan with camera"
            title="Scan with camera"
          >
            <Camera className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {cameraOpen ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-label="Camera scanner"
          onClick={(e) => { if (e.target === e.currentTarget) setCameraOpen(false); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">Scan QR code</h3>
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                aria-label="Close camera"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <CameraScanner onScan={handleCameraRead} />
            </div>
            <div className="px-4 pb-4">
              <button
                type="button"
                onClick={() => { setCameraOpen(false); inputRef.current?.focus(); }}
                className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Type the code instead
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
