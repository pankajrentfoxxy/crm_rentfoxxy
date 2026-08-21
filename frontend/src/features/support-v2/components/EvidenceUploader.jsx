import React, { useRef, useState } from 'react';
import { uploadAttachments } from '../supportV2Api';

async function downscale(file) {
  if (!file || !file.type.startsWith('image/')) return file;
  if (file.size < 1.5 * 1024 * 1024 && file.type === 'image/jpeg') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function EvidenceUploader({
  attachmentIds = [],
  onChange,
  ticketId = null,
  required = false,
  canSkip = false,
  onSkip,
  deferred = false,
}) {
  const inputRef = useRef(null);
  const [previews, setPreviews] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [busy, setBusy] = useState(false);

  const addFiles = async (list) => {
    const files = [...list].filter(Boolean);
    if (!files.length) return;
    setBusy(true);
    const staged = files.map((f) => ({ name: f.name, url: URL.createObjectURL(f), progress: 10 }));
    setPreviews((p) => [...p, ...staged]);
    try {
      const shrunk = [];
      for (const f of files) shrunk.push(await downscale(f));
      const r = await uploadAttachments(ticketId, shrunk, { kind: 'PHOTO_CUSTOMER' });
      const ids = (r.data?.rows || []).map((x) => x.attachment_id);
      onChange?.([...(attachmentIds || []), ...ids]);
      setPreviews((p) => p.map((x) => ({ ...x, progress: 100 })));
    } catch {
      setPreviews((p) => p.map((x) => ({ ...x, error: true })));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  };

  const remove = (i) => {
    const next = (attachmentIds || []).filter((_, idx) => idx !== i);
    onChange?.(next);
  };

  const count = (attachmentIds || []).length;

  return (
    <div
      className="rounded-[10px] border border-sup-lineSoft p-3 space-y-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onPaste={(e) => addFiles(e.clipboardData.files)}
    >
      <div className="flex items-center justify-between text-[12px] font-semibold">
        <span>Evidence</span>
        <span className="text-sup-muted font-normal">{count} photo{count === 1 ? '' : 's'}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {(attachmentIds || []).map((id, i) => (
          <button
            key={id}
            type="button"
            className="relative w-16 h-16 rounded-md bg-sup-canvas2 border border-sup-line overflow-hidden"
            onClick={() => setLightbox(i)}
          >
            <span className="text-[10px] text-sup-muted">#{id}</span>
            <span
              className="absolute top-0 right-0 bg-white text-[10px] px-1"
              onClick={(e) => { e.stopPropagation(); remove(i); }}
            >✕</span>
          </button>
        ))}
        <button
          type="button"
          className="w-16 h-16 rounded-md border border-dashed border-sup-line text-[11px] text-sup-muted"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          ＋ Add
        </button>
        <button
          type="button"
          className="md:hidden h-11 px-3 rounded-md bg-sup-ink text-white text-[12px]"
          onClick={() => inputRef.current?.click()}
        >
          Take photo
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
      <p className="text-[11px] text-sup-muted">Drag files, paste, or use the camera. Photos are resized before upload.</p>
      {required && count === 0 && !deferred && (
        <div className="rounded-md bg-pri2-bg text-pri2 px-2 py-1.5 text-[11.5px] flex items-center justify-between gap-2">
          <span>This issue is usually chargeable — photos are required before a charge can be raised.</span>
          {canSkip && (
            <button type="button" className="underline shrink-0" onClick={onSkip}>Skip — customer will send</button>
          )}
        </div>
      )}
      {deferred && <p className="text-[11.5px] text-pri2">Photos deferred — customer will send later.</p>}
      {lightbox != null && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setLightbox(null)}>
          <div className="bg-white rounded-[10px] p-4 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="text-[12px] mb-2">Photo {lightbox + 1} of {count}</div>
            <div className="h-64 bg-sup-canvas2 rounded-md flex items-center justify-center text-sup-muted">#{attachmentIds[lightbox]}</div>
            <div className="flex justify-between mt-3">
              <button type="button" onClick={() => setLightbox((i) => Math.max(0, i - 1))}>←</button>
              <button type="button" onClick={() => setLightbox(null)}>Close</button>
              <button type="button" onClick={() => setLightbox((i) => Math.min(count - 1, i + 1))}>→</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
