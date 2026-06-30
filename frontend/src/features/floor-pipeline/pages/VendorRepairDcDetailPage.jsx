import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Loader2, PenLine, Printer, RotateCcw } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { getBackendOrigin } from '../../../utils/api';
import {
  fetchVendorRepairDc,
  receiveVendorRepairBack,
  signVendorRepairDispatch,
  vendorRepairPdfUrl,
} from '../vendorRepairApi';
import { ticketStatusLabel } from '../floorPipelineUi';
import { invalidateInventoryManagement } from '../../inventory-management/inventoryCountsEvents';

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);

function uploadUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${p.replace(/^\/?uploads\//, '')}`;
}

function EsignBox({ label, url, previewUrl, onSign, canSign, disabled }) {
  const display = previewUrl || url;
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase text-slate-500">{label}</h4>
        {canSign && !display ? (
          <button type="button" disabled={disabled} onClick={onSign} className="text-xs text-blue-600 inline-flex items-center gap-1">
            <PenLine className="w-3.5 h-3.5" /> Sign
          </button>
        ) : null}
      </div>
      {display ? (
        <img src={display.startsWith('data:') ? display : uploadUrl(display)} alt={label} className="w-full max-h-24 object-contain border rounded bg-white" />
      ) : (
        <p className="text-xs text-slate-400 min-h-[60px] flex items-center justify-center border border-dashed rounded">Awaiting signature</p>
      )}
    </div>
  );
}

function SignatureModal({ title, onSave, onClose }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let pad;
    import('signature_pad').then(({ default: SignaturePad }) => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext('2d').scale(ratio, ratio);
      pad = new SignaturePad(canvas, { backgroundColor: '#fff', penColor: '#1A1A2E' });
      padRef.current = pad;
    });
    return () => { if (pad) pad.off(); };
  }, []);

  const save = async () => {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error('Please sign first');
      return;
    }
    setSaving(true);
    try {
      await onSave(padRef.current.toDataURL('image/png'));
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Sign failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-md p-4 space-y-3">
        <h3 className="font-semibold">{title}</h3>
        <canvas ref={canvasRef} className="w-full h-40 border rounded-lg touch-none" />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => padRef.current?.clear()} className="px-3 py-2 border rounded-lg text-sm">Clear</button>
          <button type="button" disabled={saving} onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save signature'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VendorRepairDcDetailPage() {
  const { dcNumber: rawDc } = useParams();
  const dcNumber = decodeURIComponent(rawDc || '');
  const { user } = useAuth();
  const canProcess = WAREHOUSE_ROLES.has(user?.role);
  const [loading, setLoading] = useState(true);
  const [dc, setDc] = useState(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [whReturnSign, setWhReturnSign] = useState(null);
  const [vendorReturnSign, setVendorReturnSign] = useState(null);
  const [pendingWhDispatch, setPendingWhDispatch] = useState(null);
  const [pendingVendorDispatch, setPendingVendorDispatch] = useState(null);
  const [activeSign, setActiveSign] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchVendorRepairDc(dcNumber);
      setDc(data.data);
    } catch {
      toast.error('Vendor repair DC not found');
      setDc(null);
    } finally {
      setLoading(false);
    }
  }, [dcNumber]);

  useEffect(() => { load(); }, [load]);

  const statusLabel = (s) => {
    if (s === 'draft') return 'Draft — pending e-sign';
    if (s === 'dispatched') return 'Dispatched to Vendor';
    if (s === 'returned') return 'Returned';
    return s;
  };

  const completeDispatchSign = async () => {
    const wh = pendingWhDispatch || dc?.warehouse_dispatch_esign_url;
    const vendor = pendingVendorDispatch || dc?.vendor_dispatch_esign_url;
    if (!wh || !vendor) {
      toast.error('Both warehouse and vendor dispatch signatures are required');
      return;
    }
    try {
      await signVendorRepairDispatch(dcNumber, {
        warehouse_esign: pendingWhDispatch || undefined,
        vendor_esign: pendingVendorDispatch || undefined,
      });
      toast.success('Dispatched to vendor');
      setPendingWhDispatch(null);
      setPendingVendorDispatch(null);
      invalidateInventoryManagement();
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Dispatch failed');
    }
  };

  const submitReceiveBack = async () => {
    if (!whReturnSign || !vendorReturnSign) {
      toast.error('Both return signatures are required');
      return;
    }
    if (!window.confirm('Confirm laptops received back at warehouse? Tickets will re-enter QC Process.')) return;
    try {
      await receiveVendorRepairBack(dcNumber, {
        warehouse_esign: whReturnSign,
        vendor_esign: vendorReturnSign,
      });
      toast.success('Received at warehouse — QC Process');
      setReceiveOpen(false);
      invalidateInventoryManagement();
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Receive back failed');
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }
  if (!dc) return <p className="p-6 text-red-600">Vendor repair DC not found.</p>;

  const dispatchReady = dc.status === 'draft'
    && (pendingWhDispatch || dc.warehouse_dispatch_esign_url)
    && (pendingVendorDispatch || dc.vendor_dispatch_esign_url);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/floor-pipeline/diagnosis-failed" className="text-sm text-blue-600 hover:underline">← Diagnosis Failed</Link>
          <h1 className="text-xl font-bold mt-1">Vendor Repair DC</h1>
          <p className="font-mono text-purple-800">{dc.dc_number}</p>
          <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-900">{statusLabel(dc.status)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={vendorRepairPdfUrl(dcNumber)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-sm">
            <Download className="w-4 h-4" /> PDF
          </a>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-sm">
            <Printer className="w-4 h-4" /> Print
          </button>
          {canProcess && dc.status === 'dispatched' ? (
            <button type="button" onClick={() => setReceiveOpen(true)} className="inline-flex items-center gap-1 px-3 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold">
              <RotateCcw className="w-4 h-4" /> Receive Back to Warehouse
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 print:grid-cols-2">
        <div className="rounded-xl border bg-white p-4 text-sm space-y-1">
          <h3 className="font-semibold mb-2">Vendor</h3>
          <p>{dc.vendor_name}</p>
          <p className="text-slate-600">{dc.vendor_address}</p>
          <p className="text-slate-600">{dc.contact_person} · {dc.contact_mobile}</p>
          <p className="text-slate-600">Expected return: {dc.expected_return_date || '—'}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 text-sm space-y-1">
          <h3 className="font-semibold mb-2">Warehouse</h3>
          <p>{dc.warehouse_name || '—'}</p>
          <p className="text-slate-600">{dc.warehouse_address || '—'}</p>
          <p className="text-slate-600">Out date: {dc.out_date ? new Date(dc.out_date).toLocaleDateString('en-IN') : '—'}</p>
        </div>
      </div>

      {dc.remarks ? (
        <div className="rounded-xl border bg-white p-4 text-sm">
          <h3 className="font-semibold mb-1">Remarks</h3>
          <p className="text-slate-700">{dc.remarks}</p>
        </div>
      ) : null}

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3 text-left">TTSPL</th>
              <th className="p-3 text-left">Serial</th>
              <th className="p-3 text-left">Configuration</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Ticket</th>
            </tr>
          </thead>
          <tbody>
            {(dc.items || []).map((item) => (
              <tr key={item.id} className="border-t">
                <td className="p-3 font-mono text-xs">{item.ttspl_id || '—'}</td>
                <td className="p-3 font-mono text-xs">{item.serial_number || '—'}</td>
                <td className="p-3 text-xs">{item.configuration || '—'}</td>
                <td className="p-3 text-xs">{ticketStatusLabel(item.ticket_status)}</td>
                <td className="p-3">
                  <Link to={`/floor-pipeline/tickets/${item.ticket_id}`} className="text-blue-600">#{item.ticket_id}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canProcess && dc.status === 'draft' ? (
        <div className="rounded-xl border bg-white p-4 space-y-3 print:hidden">
          <h3 className="font-semibold">Dispatch e-signatures</h3>
          <p className="text-xs text-slate-500">Both signatures are required before laptops leave the warehouse.</p>
          <div className="grid md:grid-cols-2 gap-3">
            <EsignBox
              label="Warehouse e-sign"
              url={dc.warehouse_dispatch_esign_url}
              previewUrl={pendingWhDispatch}
              canSign={canProcess}
              onSign={() => setActiveSign('wh_dispatch')}
            />
            <EsignBox
              label="Vendor e-sign"
              url={dc.vendor_dispatch_esign_url}
              previewUrl={pendingVendorDispatch}
              canSign={canProcess}
              onSign={() => setActiveSign('vendor_dispatch')}
            />
          </div>
          {dispatchReady ? (
            <button type="button" onClick={completeDispatchSign} className="w-full py-2.5 rounded-lg bg-purple-700 text-white font-semibold text-sm">
              Confirm dispatch to vendor
            </button>
          ) : null}
        </div>
      ) : null}

      {canProcess && dc.status === 'dispatched' && dc.warehouse_dispatch_esign_url ? (
        <div className="grid md:grid-cols-2 gap-3 print:hidden">
          <EsignBox label="Warehouse dispatch sign" url={dc.warehouse_dispatch_esign_url} />
          <EsignBox label="Vendor dispatch sign" url={dc.vendor_dispatch_esign_url} />
        </div>
      ) : null}

      {activeSign ? (
        <SignatureModal
          title={
            activeSign === 'wh_dispatch' ? 'Warehouse signature'
              : activeSign === 'vendor_dispatch' ? 'Vendor signature'
                : activeSign === 'wh_return' ? 'Warehouse return signature'
                  : 'Vendor return signature'
          }
          onClose={() => setActiveSign(null)}
          onSave={async (dataUrl) => {
            if (activeSign === 'wh_dispatch') setPendingWhDispatch(dataUrl);
            else if (activeSign === 'vendor_dispatch') setPendingVendorDispatch(dataUrl);
            else if (activeSign === 'wh_return') setWhReturnSign(dataUrl);
            else if (activeSign === 'vendor_return') setVendorReturnSign(dataUrl);
          }}
        />
      ) : null}

      {receiveOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setReceiveOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3">
            <h3 className="font-semibold">Receive Back to Warehouse</h3>
            <p className="text-xs text-slate-500">Capture return e-signatures. Ticket status will change to QC Process.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setActiveSign('wh_return')} className="py-2 border rounded-lg text-sm">
                {whReturnSign ? 'Warehouse signed ✓' : 'Warehouse e-sign'}
              </button>
              <button type="button" onClick={() => setActiveSign('vendor_return')} className="py-2 border rounded-lg text-sm">
                {vendorReturnSign ? 'Vendor signed ✓' : 'Vendor return e-sign'}
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReceiveOpen(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button type="button" onClick={submitReceiveBack} className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold">
                Confirm receive
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
