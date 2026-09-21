import React, { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Trash2, X } from 'lucide-react';
import { getBackendOrigin } from '../../../utils/api';

export function parseBillFiles(row) {
  const raw = row?.bill_files;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function billFilePath(f) {
  if (!f) return '';
  if (typeof f === 'string') return f;
  return String(f.path || f.url || f.file || f.filename || '');
}

export function billFileName(f) {
  if (typeof f === 'string') return f.split('/').pop() || 'File';
  return f.name || f.filename || billFilePath(f).split('/').pop() || 'File';
}

export function isImageBillFile(f, mime) {
  if (mime && String(mime).startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic|svg)$/i.test(`${billFileName(f)} ${billFilePath(f)}`);
}

export function isPdfBillFile(f, mime) {
  if (mime && String(mime).includes('pdf')) return true;
  return /\.pdf$/i.test(`${billFileName(f)} ${billFilePath(f)}`);
}

export function filePublicUrl(p) {
  const path = billFilePath(p);
  if (!path) return '#';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

export function hasBillOnRow(row) {
  return !!(row?.bill_name || parseBillFiles(row).length);
}

export function BillFilesTable({
  files,
  billName,
  compact = false,
  canRemove = false,
  removingIndex = null,
  onPreviewImage,
  onRemoveFile,
}) {
  if (!billName && !files?.length) {
    return <span className="text-slate-400 text-xs">N/A</span>;
  }
  return (
    <div className="space-y-1.5 min-w-[12rem]">
      {billName ? (
        <p className="text-xs font-semibold text-orange-700">{billName}</p>
      ) : null}
      {files?.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">Preview</th>
                <th className="px-2 py-1 text-left font-semibold">File name</th>
                {canRemove ? <th className="px-2 py-1 text-right font-semibold">Remove</th> : null}
              </tr>
            </thead>
            <tbody>
              {files.map((f, idx) => {
                const href = filePublicUrl(f);
                const name = billFileName(f);
                const image = isImageBillFile(f);
                const pdf = isPdfBillFile(f);
                const imageIndex = files.slice(0, idx + 1).filter((x) => isImageBillFile(x)).length - 1;
                return (
                  <tr key={`${href}-${idx}`} className="border-t border-slate-100">
                    <td className="px-2 py-1">
                      {image ? (
                        <button
                          type="button"
                          className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} rounded border overflow-hidden`}
                          onClick={() => onPreviewImage?.(files, imageIndex)}
                        >
                          <img src={href} alt={name} className="h-full w-full object-cover" />
                        </button>
                      ) : (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex text-slate-500 hover:text-orange-600">
                          {pdf ? <FileText className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                        </a>
                      )}
                    </td>
                    <td className="px-2 py-1 text-slate-700 max-w-[10rem] truncate" title={name}>
                      {name}
                    </td>
                    {canRemove ? (
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          disabled={removingIndex === idx}
                          className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 disabled:opacity-50"
                          onClick={() => onRemoveFile?.(idx)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {removingIndex === idx ? '…' : 'Remove'}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <span className="text-slate-400 text-xs">No files</span>
      )}
    </div>
  );
}

export function PendingBillFileCard({ file, onRemove, onPreview }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file?.type?.startsWith('image/')) return undefined;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const image = !!url;
  return (
    <div className="relative rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
      {image ? (
        <button type="button" className="block w-full aspect-square" onClick={() => onPreview(url, file.name)}>
          <img src={url} alt={file.name} className="w-full h-full object-cover" />
        </button>
      ) : (
        <div className="aspect-square flex flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-slate-600">
          <FileText className="w-6 h-6 text-slate-400" />
          <span className="line-clamp-3 break-all">{file.name}</span>
        </div>
      )}
      <p className="px-1.5 py-1 text-[10px] text-slate-600 truncate" title={file.name}>{file.name}</p>
      <button
        type="button"
        className="absolute top-1 right-1 p-0.5 rounded-full bg-white/90 shadow hover:bg-white"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function BillLightbox({ open, items, index, onClose, onIndexChange }) {
  if (!open || !items?.length) return null;
  const cur = items[index] || items[0];
  return (
    <div
      className="fixed inset-0 z-[120] bg-black/85 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <button
        type="button"
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Close"
        onClick={onClose}
      >
        <X className="w-6 h-6" />
      </button>
      {items.length > 1 ? (
        <>
          <button
            type="button"
            className="absolute left-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => onIndexChange?.((index - 1 + items.length) % items.length)}
          >
            ‹
          </button>
          <button
            type="button"
            className="absolute right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => onIndexChange?.((index + 1) % items.length)}
          >
            ›
          </button>
        </>
      ) : null}
      <div className="max-w-[90vw] max-h-[85vh] text-center">
        <img src={cur.href} alt={cur.name || 'Bill'} className="max-w-full max-h-[80vh] object-contain mx-auto" />
        {cur.name ? <p className="mt-2 text-sm text-white/80">{cur.name}</p> : null}
      </div>
    </div>
  );
}
