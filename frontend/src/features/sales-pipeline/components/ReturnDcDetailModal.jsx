import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, FileText, KeyRound, Image as ImageIcon, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { confirmReturnDcWarehouse, getReturnDcDetail } from '../salesPipelineApi';
import { formatDate, formatDateTime } from '../salesPipelineUtils';
import { getBackendOrigin } from '../../../utils/api';

function assetUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  const base = getBackendOrigin().replace(/\/$/, '');
  return `${base}/${p.replace(/^\/?/, '')}`;
}

function WarehouseSignPanel({ rdcNumber, onSigned }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

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
    if (!padRef.current?.isEmpty()) {
      /* continue */
    } else {
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
      toast.success('Warehouse receipt confirmed');
      onSigned();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to confirm receipt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-blue-200 rounded-xl p-4 bg-blue-50/50">
      <p className="font-semibold text-sm text-gray-900 mb-2">Warehouse receipt e-sign</p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Warehouse staff name*"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2"
      />
      <div className="border-2 border-gray-200 rounded-lg overflow-hidden bg-white mb-2">
        <canvas ref={canvasRef} className="w-full h-28 touch-none block" style={{ touchAction: 'none' }} />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => padRef.current?.clear()} className="flex-1 py-2 border rounded-lg text-sm">Clear</button>
        <button type="button" onClick={submit} disabled={saving} className="flex-[2] py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
          {saving ? 'Confirming…' : 'Confirm all units received'}
        </button>
      </div>
    </div>
  );
}

export default function ReturnDcDetailModal({ rdcNumber, onClose, onUpdated }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getReturnDcDetail(rdcNumber);
      setDetail(r.data);
    } catch {
      toast.error('Failed to load Return DC');
    } finally {
      setLoading(false);
    }
  }, [rdcNumber]);

  useEffect(() => { load(); }, [load]);

  const pdfLink = assetUrl(detail?.pdf_path);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="font-semibold text-lg">Return DC {rdcNumber}</h2>
            {detail && (
              <p className="text-xs text-gray-500">
                {detail.customer_name} · {detail.unit_count} unit{detail.unit_count !== 1 ? 's' : ''} · {detail.status}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {loading ? (
            <p className="text-center text-gray-500 py-8">Loading…</p>
          ) : !detail ? (
            <p className="text-center text-gray-500 py-8">Not found</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="px-2 py-1 rounded-full bg-gray-100">{formatDate(detail.created_at)}</span>
                {detail.original_dc_number && (
                  <span className="px-2 py-1 rounded-full bg-gray-100 font-mono text-xs">From DC {detail.original_dc_number}</span>
                )}
                {detail.customer_otp_verified_at ? (
                  <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center gap-1 text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Customer OTP verified
                  </span>
                ) : detail.customer_otp_code ? (
                  <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-mono inline-flex items-center gap-1 text-xs">
                    <KeyRound className="w-3.5 h-3.5" /> OTP {detail.customer_otp_code}
                  </span>
                ) : null}
              </div>

              {pdfLink && (
                <a href={pdfLink} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-xl text-sm font-medium">
                  <FileText className="w-4 h-4" />
                  {detail.esign?.warehouse_url ? 'View signed Return DC PDF' : 'View Return DC PDF'}
                </a>
              )}

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Units</h3>
                <div className="border rounded-xl divide-y">
                  {(detail.units || []).map((u, i) => (
                    <div key={u.ttspl || i} className="px-4 py-3 text-sm">
                      <p className="font-medium">{[u.brand, u.model].filter(Boolean).join(' ') || 'Laptop'}</p>
                      <p className="text-xs text-gray-500 font-mono mt-0.5">
                        {u.ttspl || '—'} · SN {u.serial || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {(detail.pickup_items || []).some((i) => i.pod_image_path) && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Pickup POD photos</h3>
                  <div className="flex flex-wrap gap-3">
                    {detail.pickup_items.filter((i) => i.pod_image_path).map((i) => (
                      <a key={i.id} href={assetUrl(i.pod_image_path)} target="_blank" rel="noreferrer"
                        className="block border rounded-lg overflow-hidden w-24 h-24 bg-gray-50">
                        <img src={assetUrl(i.pod_image_path)} alt="" className="w-full h-full object-cover" />
                        <p className="text-[10px] text-center py-0.5 font-mono truncate px-1">{i.ttspl_id}</p>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="border rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase mb-1">Technician sign-out</p>
                  {detail.esign?.technician_url ? (
                    <>
                      <a href={assetUrl(detail.esign.technician_url)} target="_blank" rel="noreferrer"
                        className="text-xs text-blue-600 inline-flex items-center gap-1 mb-1">
                        <ImageIcon className="w-3.5 h-3.5" /> View signature
                      </a>
                      <p className="text-sm">{detail.esign.technician_name || '—'}</p>
                      <p className="text-xs text-gray-400">{formatDateTime(detail.esign.technician_at)}</p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">Pending technician sign</p>
                  )}
                </div>
                <div className="border rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase mb-1">Warehouse received</p>
                  {detail.esign?.warehouse_url ? (
                    <>
                      <a href={assetUrl(detail.esign.warehouse_url)} target="_blank" rel="noreferrer"
                        className="text-xs text-blue-600 inline-flex items-center gap-1 mb-1">
                        <ImageIcon className="w-3.5 h-3.5" /> View signature
                      </a>
                      <p className="text-sm">{detail.esign.warehouse_name || '—'}</p>
                      <p className="text-xs text-gray-400">{formatDateTime(detail.esign.warehouse_at)}</p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">Pending warehouse confirmation</p>
                  )}
                </div>
              </div>

              {detail.can_warehouse_confirm && (
                <WarehouseSignPanel
                  rdcNumber={rdcNumber}
                  onSigned={() => { load(); onUpdated?.(); }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
