import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Zap, ZapOff } from 'lucide-react';

/**
 * Live camera QR/barcode reader for phones.
 *
 * Uses the low-level `Html5Qrcode` class rather than `Html5QrcodeScanner`: the
 * latter renders its own chooser UI that opens the photo gallery, which is not
 * what anyone wants when they are standing in front of a part. This goes
 * straight to the rear camera on mount.
 */
function describeError(err) {
  const name = err?.name || '';
  const msg = String(err?.message || err || '');

  if (name === 'NotAllowedError' || /permission|denied/i.test(msg)) {
    return 'Camera access was blocked. Tap the lock icon next to the address bar, allow Camera, then try again.';
  }
  if (name === 'NotFoundError' || /no camera|not found/i.test(msg)) {
    return 'No camera was found on this device.';
  }
  if (name === 'NotReadableError' || /in use|could not start/i.test(msg)) {
    return 'The camera is already in use by another app. Close it and try again.';
  }
  if (name === 'OverconstrainedError') {
    return 'The rear camera is unavailable. Try switching cameras.';
  }
  return msg || 'The camera could not be started.';
}

export default function CameraScanner({ onScan, onError }) {
  // Several screens mount more than one scanner, so the mount point html5-qrcode
  // takes over has to be unique per instance.
  const elementId = `camera-scanner-${useId().replace(/:/g, '')}`;
  const [status, setStatus] = useState('starting');
  const [message, setMessage] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [facing, setFacing] = useState('environment');

  const scannerRef = useRef(null);
  const handledRef = useRef(false);
  // Held in refs so an inline callback from the caller does not retrigger the
  // effect and restart the camera on every render.
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  onScanRef.current = onScan;
  onErrorRef.current = onError;

  const teardown = useCallback(async (scanner) => {
    if (!scanner) return;
    if (scannerRef.current === scanner) scannerRef.current = null;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      // Already torn down — nothing to release.
    }
  }, []);

  const stop = useCallback(() => teardown(scannerRef.current), [teardown]);

  useEffect(() => {
    let cancelled = false;
    handledRef.current = false;
    setStatus('starting');
    setMessage('');
    setTorchOn(false);
    setTorchAvailable(false);

    (async () => {
      // getUserMedia is only exposed on HTTPS (localhost excepted), and the CRM
      // is served over HTTPS, so this only trips on odd proxies or http:// hosts.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setStatus('error');
          setMessage('Camera scanning needs a secure (https) connection. Open the CRM over https and try again.');
        }
        return;
      }

      let Html5Qrcode;
      let Html5QrcodeSupportedFormats;
      try {
        ({ Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode'));
      } catch {
        if (!cancelled) {
          setStatus('error');
          setMessage('The scanner could not be loaded. Check your connection and try again.');
        }
        return;
      }
      if (cancelled) return;

      const scanner = new Html5Qrcode(elementId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
        ],
        verbose: false,
      });
      scannerRef.current = scanner;

      const handleDecoded = (text) => {
        if (handledRef.current) return;
        const value = String(text || '').trim();
        if (!value) return;
        handledRef.current = true;
        // Release the stream before handing off so the modal can close cleanly.
        teardown(scanner).finally(() => onScanRef.current?.(value));
      };

      try {
        await scanner.start(
          { facingMode: facing },
          {
            fps: 12,
            // Square box sized to the viewport, so a 10 mm sticker fills enough
            // of the frame to decode when held ~10 cm from the lens.
            qrbox: (w, h) => {
              const edge = Math.floor(Math.min(w, h) * 0.75);
              return { width: edge, height: edge };
            },
            // No aspectRatio constraint: some Android cameras reject a forced
            // 1:1 and fail to start at all. The frame is letterboxed in CSS.
          },
          handleDecoded,
          () => {} // Per-frame decode misses are normal; stay quiet.
        );
        // The caller may have closed the modal while the camera was warming up;
        // release the stream against this scanner directly, because the cleanup
        // that already ran could not stop a camera that had not started yet.
        if (cancelled) {
          await teardown(scanner);
          return;
        }
        setStatus('scanning');

        try {
          const caps = scanner.getRunningTrackCapabilities?.() || {};
          setTorchAvailable(Boolean(caps.torch));
        } catch {
          setTorchAvailable(false);
        }
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        const text = describeError(err);
        setMessage(text);
        onErrorRef.current?.(text);
      }
    })();

    return () => { cancelled = true; stop(); };
  }, [facing, stop, teardown, elementId]);

  async function toggleTorch() {
    const scanner = scannerRef.current;
    if (!scanner) return;
    const next = !torchOn;
    try {
      await scanner.applyVideoConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  return (
    <div className="w-full">
      <div className="relative w-full overflow-hidden rounded-xl bg-slate-900 aspect-square">
        {/* object-contain keeps the whole frame — and so the whole scan region
            html5-qrcode overlays — visible, instead of cropping part of it away. */}
        <div id={elementId} className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-contain" />

        {status === 'starting' ? (
          <div className="absolute inset-0 grid place-items-center text-white/80 gap-2 text-sm">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Starting camera…</span>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="absolute inset-0 grid place-items-center p-5 text-center">
            <div className="space-y-2">
              <AlertTriangle className="w-7 h-7 mx-auto text-amber-400" />
              <p className="text-sm text-white/90 m-0">{message}</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 mt-3">
        <p className="text-xs text-slate-500 m-0">
          {status === 'scanning'
            ? 'Hold the QR sticker about 10 cm from the lens.'
            : 'Camera not running.'}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {torchAvailable ? (
            <button
              type="button"
              onClick={toggleTorch}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {torchOn ? <ZapOff className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
              {torchOn ? 'Light off' : 'Light'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Flip
          </button>
        </div>
      </div>
    </div>
  );
}
