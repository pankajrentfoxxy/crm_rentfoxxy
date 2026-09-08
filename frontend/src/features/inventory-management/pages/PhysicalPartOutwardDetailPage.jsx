import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Loader2, PenLine } from 'lucide-react';
import { PageHeader, Button } from '../../../components/ui/primitives';
import { useAuth } from '../../../context/AuthContext';
import { partCategoryLabel } from '../../../constants/laptopConditions';
import VrdcDispatchFields, { validateVrdcDispatch } from '../../floor-pipeline/components/VrdcDispatchFields';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import {
  cancelDraftPhysicalOutward,
  dispatchPhysicalOutward,
  downloadPhysicalOutwardPdf,
  fetchPhysicalOutward,
} from '../physicalDeadPartApi';
import {
  fmtDate,
  fmtDateTime,
  outwardStatusLabel,
  physicalPhotoList,
  physicalUploadUrl,
  statusChip,
} from '../physicalDeadPartUi';

const WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead', 'procurement']);

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
          placeholder="Signer name *"
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
            src={String(display).startsWith('data:') ? display : physicalUploadUrl(display)}
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

export default function PhysicalPartOutwardDetailPage() {
  const { outwardNumber } = useParams();
  const decoded = decodeURIComponent(outwardNumber || '');
  const navigate = useNavigate();
  const { user } = useAuth();
  const canMutate = WAREHOUSE_ROLES.has(user?.role);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shipBy, setShipBy] = useState('');
  const [dispatchFields, setDispatchFields] = useState({});
  const [technicians, setTechnicians] = useState([]);
  const [busy, setBusy] = useState(false);
  const [whSignerName, setWhSignerName] = useState('');
  const [pendingWhEsign, setPendingWhEsign] = useState(null);
  const [activeSign, setActiveSign] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchPhysicalOutward(decoded);
      const row = res.data;
      setData(row);
      const outward = row?.outward;
      setShipBy(outward?.ship_by || '');
      setDispatchFields({
        courier_name: outward?.courier_name || '',
        awb_number: outward?.awb_number || '',
        courier_tracking_url: outward?.courier_tracking_url || '',
        porter_tracking_id: outward?.porter_tracking_id || '',
        porter_order_id: outward?.porter_order_id || '',
        porter_booking_url: outward?.porter_booking_url || '',
        delivery_person_id: outward?.delivery_person_id || '',
      });
      setWhSignerName(outward?.warehouse_dispatch_signer_name || user?.name || user?.email || '');
      setPendingWhEsign(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load outward');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [decoded, user?.name, user?.email]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchDeliveryTechnicians({ limit: 200 })
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
    const esign = pendingWhEsign || data?.outward?.warehouse_dispatch_esign_url;
    if (!esign) {
      toast.error('Warehouse e-signature is required');
      return;
    }
    setBusy(true);
    try {
      await dispatchPhysicalOutward(decoded, {
        ship_by: shipBy,
        ...dispatchFields,
        warehouse_esign: pendingWhEsign || undefined,
        warehouse_signer_name: whSignerName.trim(),
      });
      toast.success('Outward e-signed — print PDF and send through the gate');
      setPendingWhEsign(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Dispatch failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this draft outward? Parts return to Available.')) return;
    setBusy(true);
    try {
      await cancelDraftPhysicalOutward(decoded);
      toast.success('Draft cancelled');
      navigate('/inventory-management/physical-parts');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePdf = async () => {
    setPdfBusy(true);
    try {
      await downloadPhysicalOutwardPdf(decoded);
      toast.success('PDF downloaded');
    } catch (e) {
      toast.error(e.response?.data?.message || 'PDF download failed');
    } finally {
      setPdfBusy(false);
    }
  };

  if (loading) return <p className="p-8 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></p>;
  if (!data?.outward) {
    return (
      <div className="p-6">
        <p className="text-red-600">Outward not found</p>
        <Link to="/inventory-management/physical-parts" className="text-blue-700 text-sm">Back</Link>
      </div>
    );
  }

  const { outward, parts } = data;
  const isDraft = outward.status === 'draft';
  const isReady = outward.status === 'dispatch_ready';
  const canPdf = !isDraft && outward.status !== 'cancelled';

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title={outward.outward_number}
        subtitle={`${parts.length} part(s) · ${outward.receiver_name} · ${outwardStatusLabel(outward.status)}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link to="/inventory-management/physical-parts" className="inline-flex items-center gap-1.5 h-9 px-3 border rounded-lg text-sm text-blue-700">
              <ArrowLeft className="w-4 h-4" /> Inventory
            </Link>
            {canPdf ? (
              <Button type="button" variant="secondary" disabled={pdfBusy} onClick={handlePdf}>
                {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                PDF
              </Button>
            ) : null}
            {isDraft && canMutate ? (
              <Button type="button" variant="danger" disabled={busy} onClick={handleCancel}>
                Cancel draft
              </Button>
            ) : null}
          </div>
        )}
      />

      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-2xl border bg-white p-4 shadow-sm text-sm space-y-1 md:col-span-2">
          <p>
            <span className="text-slate-500">Status:</span>{' '}
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusChip(outward.status)}`}>
              {outwardStatusLabel(outward.status)}
            </span>
          </p>
          <p><span className="text-slate-500">Date:</span> {fmtDate(outward.outward_date)}</p>
          <p><span className="text-slate-500">Receiver:</span> {outward.receiver_name} ({outward.receiver_type})</p>
          {outward.receiver_contact ? <p><span className="text-slate-500">Contact:</span> {outward.receiver_contact}</p> : null}
          <p><span className="text-slate-500">Purpose:</span> {outward.purpose}</p>
          {outward.reference_number ? <p><span className="text-slate-500">Reference:</span> {outward.reference_number}</p> : null}
          <p><span className="text-slate-500">By:</span> {outward.created_by_name || '—'}</p>
          {outward.remarks ? <p><span className="text-slate-500">Remarks:</span> {outward.remarks}</p> : null}
          {isReady ? (
            <p className="text-blue-800 bg-blue-50 rounded-lg px-3 py-2 mt-2">
              Waiting for outward guard. Print the PDF and scan the gate QR.
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500 m-0 mb-2">Outward photos</p>
          <div className="flex flex-wrap gap-2">
            {physicalPhotoList(outward, 'photos', 'photo_paths', 'photo_path').map((src) => (
              <a key={src} href={physicalUploadUrl(src)} target="_blank" rel="noreferrer">
                <img src={physicalUploadUrl(src)} alt="Outward" className="h-16 w-16 object-cover rounded border bg-white" />
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border rounded-xl bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">DP</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2">Inward photo</th>
              <th className="px-3 py-2">Inward</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.part_id} className="border-t">
                <td className="px-3 py-2 font-mono font-semibold">{p.dp_number}</td>
                <td className="px-3 py-2">
                  {p.part_name} · {partCategoryLabel(p.category)}
                  {p.serial_number ? <span className="block text-xs font-mono text-slate-500">{p.serial_number}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {physicalPhotoList(p).map((src) => (
                      <a key={src} href={physicalUploadUrl(src)} target="_blank" rel="noreferrer">
                        <img src={physicalUploadUrl(src)} alt="" className="h-12 w-12 object-cover rounded border" />
                      </a>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs font-mono">
                  <Link to={`/inventory-management/physical-parts/inward/${encodeURIComponent(p.inward_number)}`} className="text-blue-700">
                    {p.inward_number}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isDraft && canMutate ? (
        <div className="border rounded-xl bg-white p-4 space-y-4">
          <h3 className="font-semibold text-slate-900">Warehouse dispatch</h3>
          <p className="text-xs text-slate-500 m-0">
            Choose send mode, sign, then print the PDF. The outward guard scans the QR and each DP before the parts leave.
          </p>
          <VrdcDispatchFields
            shipBy={shipBy}
            onShipByChange={setShipBy}
            fields={dispatchFields}
            onFieldsChange={setDispatchFields}
            deliveryTechnicians={technicians}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <EsignBox
              label="Warehouse signature"
              url={outward.warehouse_dispatch_esign_url}
              previewUrl={pendingWhEsign}
              canSign
              disabled={busy}
              signerName={whSignerName}
              onSignerNameChange={setWhSignerName}
              onSign={() => setActiveSign('warehouse')}
            />
          </div>
          <Button type="button" disabled={busy} onClick={handleDispatch}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Dispatch outward
          </Button>
        </div>
      ) : null}

      {!isDraft && outward.status !== 'cancelled' ? (
        <div className="border rounded-xl bg-white p-4 text-sm space-y-1">
          <p><span className="text-slate-500">Ship by:</span> {outward.ship_by || '—'}</p>
          {outward.courier_name ? <p><span className="text-slate-500">Courier:</span> {outward.courier_name} · {outward.awb_number || '—'}</p> : null}
          {outward.porter_tracking_id ? <p><span className="text-slate-500">Porter:</span> {outward.porter_tracking_id}</p> : null}
          {outward.warehouse_dispatch_signer_name ? (
            <p><span className="text-slate-500">Warehouse sign:</span> {outward.warehouse_dispatch_signer_name}</p>
          ) : null}
          <p><span className="text-slate-500">Dispatched at:</span> {fmtDateTime(outward.dispatched_at)}</p>
          <p><span className="text-slate-500">Gate confirmed:</span> {fmtDateTime(outward.gate_confirmed_at)}</p>
        </div>
      ) : null}

      {activeSign === 'warehouse' ? (
        <SignatureModal
          title="Warehouse dispatch signature"
          onClose={() => setActiveSign(null)}
          onSave={async (dataUrl) => { setPendingWhEsign(dataUrl); }}
        />
      ) : null}
    </div>
  );
}
