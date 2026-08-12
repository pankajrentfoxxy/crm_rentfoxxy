import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Loader2, PenLine, Printer } from 'lucide-react';
import { PageHeader, Button } from '../../../components/ui/primitives';
import { useAuth } from '../../../context/AuthContext';
import { getBackendOrigin } from '../../../utils/api';
import VrdcDispatchFields, { validateVrdcDispatch } from '../../floor-pipeline/components/VrdcDispatchFields';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import {
  dispatchPartVendorReturnDc,
  downloadPartVendorRepairPdf,
  fetchPartVendorRepairDc,
  receivePartVendorReturnDc,
} from '../partVendorRepairApi';

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead', 'procurement']);

function uploadUrl(p) {
  if (!p) return null;
  if (p.startsWith('http') || String(p).startsWith('data:')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${p.replace(/^\/?uploads\//, '')}`;
}

function EsignBox({ label, url, previewUrl, onSign, canSign, disabled, signerName, onSignerNameChange, optional }) {
  const display = previewUrl || url;
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase text-slate-500">
          {label}{optional ? ' (optional)' : ''}
        </h4>
        {canSign && !display ? (
          <button type="button" disabled={disabled} onClick={onSign} className="text-xs text-blue-600 inline-flex items-center gap-1">
            <PenLine className="w-3.5 h-3.5" /> Sign
          </button>
        ) : null}
      </div>
      {onSignerNameChange ? (
        <input
          className="w-full border rounded-lg px-2 py-1.5 text-xs"
          placeholder="Warehouse / signer name *"
          value={signerName || ''}
          onChange={(e) => onSignerNameChange(e.target.value)}
          disabled={disabled}
        />
      ) : signerName ? (
        <p className="text-xs text-slate-600">Signed by: <strong>{signerName}</strong></p>
      ) : null}
      {display ? (
        <div className="space-y-1">
          <img
            src={String(display).startsWith('data:') ? display : uploadUrl(display)}
            alt={label}
            className="w-full max-h-24 object-contain border rounded bg-white"
          />
          {canSign ? (
            <button type="button" disabled={disabled} onClick={onSign} className="text-xs text-blue-600">
              Re-sign
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-slate-400 min-h-[60px] flex items-center justify-center border border-dashed rounded">
          Awaiting signature
        </p>
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
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
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

export default function PartVendorRepairDcDetailPage() {
  const { dcNumber: rawDc } = useParams();
  const dcNumber = decodeURIComponent(rawDc || '');
  const { user } = useAuth();
  const canMutate = WAREHOUSE_ROLES.has(user?.role);

  const [loading, setLoading] = useState(true);
  const [dc, setDc] = useState(null);
  const [shipBy, setShipBy] = useState('');
  const [dispatchFields, setDispatchFields] = useState({});
  const [technicians, setTechnicians] = useState([]);
  const [busy, setBusy] = useState(false);
  const [receiveModes, setReceiveModes] = useState({});
  const [whSignerName, setWhSignerName] = useState('');
  const [pendingWhEsign, setPendingWhEsign] = useState(null);
  const [activeSign, setActiveSign] = useState(null);
  const [receiveSignerName, setReceiveSignerName] = useState('');
  const [pendingReceiveEsign, setPendingReceiveEsign] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchPartVendorRepairDc(dcNumber);
      const row = data.data || null;
      setDc(row);
      setShipBy(row?.ship_by || '');
      setDispatchFields({
        courier_name: row?.courier_name || '',
        awb_number: row?.awb_number || '',
        courier_tracking_url: row?.courier_tracking_url || '',
        porter_tracking_id: row?.porter_tracking_id || '',
        porter_order_id: row?.porter_order_id || '',
        porter_booking_url: row?.porter_booking_url || '',
        delivery_person_id: row?.delivery_person_id || '',
      });
      setWhSignerName(
        row?.warehouse_dispatch_signer_name
        || row?.warehouse_name
        || user?.name
        || user?.email
        || ''
      );
      setReceiveSignerName(user?.name || user?.email || '');
      setPendingWhEsign(null);
      setPendingReceiveEsign(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load DC');
      setDc(null);
    } finally {
      setLoading(false);
    }
  }, [dcNumber, user?.name, user?.email]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchDeliveryTechnicians()
      .then((res) => setTechnicians(res.data?.data || res.data || []))
      .catch(() => {});
  }, []);

  const handleDispatch = async () => {
    const err = validateVrdcDispatch(shipBy, dispatchFields);
    if (err) { toast.error(err); return; }
    if (!whSignerName.trim()) {
      toast.error('Enter warehouse signer name');
      return;
    }
    const esign = pendingWhEsign || dc?.warehouse_dispatch_esign_url;
    if (!esign) {
      toast.error('Warehouse e-signature is required');
      return;
    }
    setBusy(true);
    try {
      await dispatchPartVendorReturnDc(dcNumber, {
        ship_by: shipBy,
        ...dispatchFields,
        warehouse_esign: pendingWhEsign || undefined,
        warehouse_signer_name: whSignerName.trim(),
      });
      toast.success('Dispatched to vendor');
      setPendingWhEsign(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Dispatch failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePdf = async () => {
    setPdfBusy(true);
    try {
      await downloadPartVendorRepairPdf(dcNumber);
      toast.success('DC PDF downloaded — print for technician');
    } catch (e) {
      toast.error(e.response?.data?.message || 'PDF download failed');
    } finally {
      setPdfBusy(false);
    }
  };

  const handleReceive = async () => {
    const receive_items = (dc?.items || [])
      .filter((i) => i.item_status === 'dispatched' && receiveModes[i.instance_id])
      .map((i) => ({
        instance_id: i.instance_id,
        receive_mode: receiveModes[i.instance_id],
      }));
    if (!receive_items.length) {
      toast.error('Select receive mode for at least one pending item');
      return;
    }
    if (!receiveSignerName.trim()) {
      toast.error('Enter warehouse receiver name');
      return;
    }
    setBusy(true);
    try {
      await receivePartVendorReturnDc(dcNumber, {
        receive_items,
        warehouse_esign: pendingReceiveEsign || undefined,
        warehouse_signer_name: receiveSignerName.trim(),
      });
      toast.success('Parts received — QC pending');
      setPendingReceiveEsign(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Receive failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="p-10 text-center text-slate-400"><Loader2 className="inline w-6 h-6 animate-spin" /></div>;
  }
  if (!dc) {
    return (
      <div className="p-6">
        <Link to="/inventory-management/part-vendor-repair" className="text-blue-700">← Back</Link>
        <p className="mt-4 text-slate-500">DC not found</p>
      </div>
    );
  }

  const pendingItems = (dc.items || []).filter((i) => i.item_status === 'dispatched');
  const warehouseLabel = dc.warehouse_name || 'Warehouse';

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title={dc.dc_number}
        subtitle={`${dc.vendor_name || '—'} · ${String(dc.status || '').replace(/_/g, ' ')}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pdfBusy}
              onClick={handlePdf}
              className="inline-flex items-center gap-1.5 h-9 px-3 border rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              DC Print / PDF
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 h-9 px-3 border rounded-lg text-sm hover:bg-slate-50"
            >
              <Printer className="w-4 h-4" /> Print page
            </button>
            <Link to="/inventory-management/part-vendor-repair" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline">
              <ArrowLeft className="w-4 h-4" /> List
            </Link>
          </div>
        )}
      />

      <div className="rounded-xl border bg-white p-4 text-sm grid sm:grid-cols-2 gap-3">
        <div><p className="text-xs text-slate-500">Vendor</p><p className="font-medium">{dc.vendor_name}</p></div>
        <div><p className="text-xs text-slate-500">Contact</p><p>{dc.contact_person || '—'} · {dc.contact_mobile || '—'}</p></div>
        <div><p className="text-xs text-slate-500">Warehouse</p><p className="font-medium">{warehouseLabel}</p></div>
        <div className="sm:col-span-2"><p className="text-xs text-slate-500">Address</p><p className="whitespace-pre-wrap">{dc.shipping_address || dc.vendor_address || '—'}</p></div>
        {dc.remarks && <div className="sm:col-span-2"><p className="text-xs text-slate-500">Remarks</p><p>{dc.remarks}</p></div>}
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-4 py-2 border-b text-sm font-semibold">Line items</div>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
            <tr>
              <th className="px-3 py-2">PRT</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2">Serial</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Receive</th>
            </tr>
          </thead>
          <tbody>
            {(dc.items || []).map((i) => (
              <tr key={i.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{i.prt_id}</td>
                <td className="px-3 py-2">{i.part_name || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{i.serial_number || '—'}</td>
                <td className="px-3 py-2 capitalize">{String(i.item_status || '').replace(/_/g, ' ')}</td>
                <td className="px-3 py-2">
                  {i.item_status === 'dispatched' && canMutate ? (
                    <select
                      className="border rounded px-2 py-1 text-xs"
                      value={receiveModes[i.instance_id] || ''}
                      onChange={(e) => setReceiveModes((m) => ({ ...m, [i.instance_id]: e.target.value }))}
                    >
                      <option value="">—</option>
                      <option value="repaired">Repaired</option>
                      <option value="replacement">Replacement</option>
                    </select>
                  ) : (
                    <span className="text-xs text-slate-500">{i.receive_mode || '—'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canMutate && dc.status === 'draft' && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <h3 className="font-semibold text-sm">Dispatch</h3>
          <VrdcDispatchFields
            shipBy={shipBy}
            onShipByChange={setShipBy}
            fields={dispatchFields}
            onFieldsChange={setDispatchFields}
            deliveryTechnicians={technicians}
          />
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              Warehouse signature and name are required (same as laptop Vendor Repair DC).
            </p>
            <EsignBox
              label={`${warehouseLabel} e-sign`}
              url={dc.warehouse_dispatch_esign_url}
              previewUrl={pendingWhEsign}
              canSign={canMutate}
              onSign={() => setActiveSign('wh_dispatch')}
              signerName={whSignerName}
              onSignerNameChange={setWhSignerName}
            />
          </div>
          <Button disabled={busy} onClick={handleDispatch}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Sign & Dispatch
          </Button>
        </div>
      )}

      {canMutate && dc.status !== 'draft' && dc.warehouse_dispatch_esign_url ? (
        <div className="rounded-xl border bg-white p-4">
          <EsignBox
            label={`${warehouseLabel} dispatch sign`}
            url={dc.warehouse_dispatch_esign_url}
            signerName={dc.warehouse_dispatch_signer_name}
          />
        </div>
      ) : null}

      {canMutate && pendingItems.length > 0 && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <h3 className="font-semibold text-sm">Receive from vendor</h3>
          <p className="text-xs text-slate-500">Select repaired / replacement per line, then receive. Parts go to QC pending.</p>
          <EsignBox
            label={`${warehouseLabel} receive e-sign`}
            previewUrl={pendingReceiveEsign}
            canSign={canMutate}
            onSign={() => setActiveSign('wh_receive')}
            signerName={receiveSignerName}
            onSignerNameChange={setReceiveSignerName}
            optional
          />
          <Button disabled={busy} onClick={handleReceive}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Receive selected
          </Button>
        </div>
      )}

      {activeSign === 'wh_dispatch' ? (
        <SignatureModal
          title={`${warehouseLabel} dispatch signature`}
          onSave={async (dataUrl) => setPendingWhEsign(dataUrl)}
          onClose={() => setActiveSign(null)}
        />
      ) : null}
      {activeSign === 'wh_receive' ? (
        <SignatureModal
          title={`${warehouseLabel} receive signature`}
          onSave={async (dataUrl) => setPendingReceiveEsign(dataUrl)}
          onClose={() => setActiveSign(null)}
        />
      ) : null}
    </div>
  );
}
