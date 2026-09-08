import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import { fetchPhysicalPart } from '../physicalDeadPartApi';
import { fmtDateTime, physicalPhotoList, physicalUploadUrl, statusChip } from '../physicalDeadPartUi';
import { partCategoryLabel } from '../../../constants/laptopConditions';

export default function PhysicalPartDetailDrawer({ dpNumber, onClose }) {
  const [part, setPart] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPhysicalPart(dpNumber)
      .then(({ data }) => { if (!cancelled) setPart(data.part); })
      .catch((err) => {
        if (!cancelled) toast.error(err.response?.data?.message || 'Failed to load part');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dpNumber]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div>
            <p className="font-mono font-semibold text-slate-900">{dpNumber}</p>
            <p className="text-xs text-slate-500">Physical / dead part history</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        {loading ? (
          <p className="p-8 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></p>
        ) : !part ? (
          <p className="p-6 text-sm text-slate-500">Not found</p>
        ) : (
          <div className="p-4 space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 m-0">{part.part_name}</h3>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusChip(part.status)}`}>
                {part.status_label}
              </span>
            </div>
            <p className="text-slate-600">{partCategoryLabel(part.category)} · {part.condition} · {part.warehouse}</p>
            {part.serial_number ? <p>Serial: <span className="font-mono">{part.serial_number}</span></p> : null}

            <section className="rounded-xl border p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-slate-500 m-0">Inward</h4>
              <p>Date: {fmtDateTime(part.inward_date || part.inward_at)}</p>
              <p>Warehouse: {part.inward_warehouse || part.warehouse}</p>
              <p>Reason: {part.inward_reason || '—'}</p>
              <p>By: {part.inward_user || part.created_by_name || '—'}</p>
              {part.inward_number ? (
                <Link
                  to={`/inventory-management/physical-parts/inward/${encodeURIComponent(part.inward_number)}`}
                  className="text-blue-700 text-xs font-medium"
                >
                  {part.inward_number} →
                </Link>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {physicalPhotoList(part, 'inward_photos', 'inward_photo_paths', 'inward_photo_path').map((src) => (
                  <a key={src} href={physicalUploadUrl(src)} target="_blank" rel="noreferrer">
                    <img src={physicalUploadUrl(src)} alt="Inward" className="h-20 w-20 object-cover rounded border bg-white" />
                  </a>
                ))}
              </div>
            </section>

            <section className="rounded-xl border p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-slate-500 m-0">Outward</h4>
              {part.status === 'pending' ? (
                <>
                  <p className="text-blue-800">Locked on a draft / dispatch-ready outward.</p>
                  {part.outward_number ? (
                    <Link
                      to={`/inventory-management/physical-parts/outward/${encodeURIComponent(part.outward_number)}`}
                      className="text-blue-700 text-xs font-medium"
                    >
                      {part.outward_number} →
                    </Link>
                  ) : null}
                </>
              ) : part.status === 'out' ? (
                <>
                  <p>Date: {fmtDateTime(part.outward_date || part.outward_at)}</p>
                  <p>Receiver: {part.receiver_name} ({part.receiver_type})</p>
                  {part.receiver_contact ? <p>Contact: {part.receiver_contact}</p> : null}
                  <p>Purpose: {part.outward_purpose || '—'}</p>
                  <p>By: {part.outward_user || '—'}</p>
                  {part.reference_number ? <p>Reference: {part.reference_number}</p> : null}
                  {part.outward_number ? (
                    <Link
                      to={`/inventory-management/physical-parts/outward/${encodeURIComponent(part.outward_number)}`}
                      className="text-blue-700 text-xs font-medium"
                    >
                      {part.outward_number} →
                    </Link>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {physicalPhotoList(part, 'outward_photos', 'outward_photo_paths', 'outward_photo_path').map((src) => (
                      <a key={src} href={physicalUploadUrl(src)} target="_blank" rel="noreferrer">
                        <img src={physicalUploadUrl(src)} alt="Outward" className="h-20 w-20 object-cover rounded border bg-white" />
                      </a>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-slate-400">Still available in warehouse.</p>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
