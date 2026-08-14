import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Loader2, PenLine } from 'lucide-react';
import { PageHeader, Button } from '../../../components/ui/primitives';
import { useAuth } from '../../../context/AuthContext';
import { getBackendOrigin } from '../../../utils/api';
import VrdcDispatchFields, { validateVrdcDispatch } from '../../floor-pipeline/components/VrdcDispatchFields';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import {
  cancelDraftScrapChallan,
  dispatchScrapChallan,
  downloadScrapChallanPdf,
  fetchScrapChallan,
} from '../scrapChallanApi';

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

export default function ScrapChallanDetailPage() {
  const { challanNumber: raw } = useParams();
  const challanNumber = decodeURIComponent(raw || '');
  const navigate = useNavigate();
  const { user } = useAuth();
  const canMutate = WAREHOUSE_ROLES.has(user?.role);

  const [loading, setLoading] = useState(true);
  const [challan, setChallan] = useState(null);
  const [shipBy, setShipBy] = useState('');
  const [dispatchFields, setDispatchFields] = useState({});
  const [technicians, setTechnicians] = useState([]);
  const [busy, setBusy] = useState(false);
  const [whSignerName, setWhSignerName] = useState('');
  const [pendingWhEsign, setPendingWhEsign] = useState(null);
  const [activeSign, setActiveSign] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [ewayBillNumber, setEwayBillNumber] = useState('');
  const [ewayBillDate, setEwayBillDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchScrapChallan(challanNumber);
      const row = data.data || null;
      setChallan(row);
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
      setWhSignerName(row?.warehouse_dispatch_signer_name || user?.name || user?.email || '');
      setEwayBillNumber(row?.eway_bill_number || '');
      setEwayBillDate(row?.eway_bill_date ? String(row.eway_bill_date).slice(0, 10) : '');
      setPendingWhEsign(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load scrap challan');
      setChallan(null);
    } finally {
      setLoading(false);
    }
  }, [challanNumber, user?.name, user?.email]);

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
    const esign = pendingWhEsign || challan?.warehouse_dispatch_esign_url;
    if (!esign) {
      toast.error('Warehouse e-signature is required');
      return;
    }
    setBusy(true);
    try {
      await dispatchScrapChallan(challanNumber, {
        ship_by: shipBy,
        ...dispatchFields,
        warehouse_esign: pendingWhEsign || undefined,
        warehouse_signer_name: whSignerName.trim(),
        eway_bill_number: ewayBillNumber || undefined,
        eway_bill_date: ewayBillDate || undefined,
      });
      toast.success('Scrap challan dispatched');
      setPendingWhEsign(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Dispatch failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this draft scrap challan? Parts return to the discarded pool.')) return;
    setBusy(true);
    try {
      await cancelDraftScrapChallan(challanNumber);
      toast.success('Draft cancelled');
      navigate('/inventory-management/discarded-parts');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePdf = async () => {
    setPdfBusy(true);
    try {
      await downloadScrapChallanPdf(challanNumber);
      toast.success('PDF downloaded');
    } catch (e) {
      toast.error(e.response?.data?.message || 'PDF download failed');
    } finally {
      setPdfBusy(false);
    }
  };

  if (loading) {
    return <div className="p-10 text-center text-slate-400"><Loader2 className="inline w-6 h-6 animate-spin" /></div>;
  }
  if (!challan) {
    return (
      <div className="p-6">
        <Link to="/inventory-management/scrap-challans" className="text-blue-700">← Back</Link>
        <p className="mt-4 text-slate-500">Scrap challan not found</p>
      </div>
    );
  }

  const isDraft = challan.status === 'draft';

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title={challan.challan_number}
        subtitle={`${challan.recipient_name || '—'} · ${String(challan.status || '').replace(/_/g, ' ')}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link
              to="/inventory-management/scrap-challans"
              className="inline-flex items-center gap-1 h-9 px-3 border rounded-lg text-sm hover:bg-slate-50"
            >
              <ArrowLeft className="w-4 h-4" /> List
            </Link>
            <Button type="button" variant="secondary" disabled={pdfBusy} onClick={handlePdf}>
              {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              PDF
            </Button>
            {isDraft && canMutate ? (
              <Button type="button" variant="danger" disabled={busy} onClick={handleCancel}>
                Cancel draft
              </Button>
            ) : null}
          </div>
        )}
      />

      <div className="grid sm:grid-cols-2 gap-3 text-sm border rounded-xl p-4 bg-white">
        <div>
          <p className="text-xs text-slate-500">Recipient</p>
          <p className="font-medium">{challan.recipient_name}</p>
          <p className="text-slate-600 whitespace-pre-wrap mt-1">{challan.recipient_address}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Contact</p>
          <p>{challan.contact_person || '—'} · {challan.contact_mobile || '—'}</p>
          {challan.remarks ? (
            <p className="mt-2 text-slate-600"><span className="text-xs text-slate-500">Remarks:</span> {challan.remarks}</p>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto border rounded-xl bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">PRT-ID</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2">Serial</th>
              <th className="px-3 py-2">Unit cost</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {(challan.items || []).map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-3 py-2 font-mono">{item.prt_id}</td>
                <td className="px-3 py-2">{item.part_name || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{item.serial_number || '—'}</td>
                <td className="px-3 py-2">
                  {item.unit_cost != null ? `₹${Number(item.unit_cost).toLocaleString('en-IN')}` : '—'}
                </td>
                <td className="px-3 py-2 capitalize">{item.instance_status || '—'}</td>
                <td className="px-3 py-2">{item.item_remarks || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isDraft && canMutate ? (
        <div className="border rounded-xl bg-white p-4 space-y-4">
          <h3 className="font-semibold text-slate-900">Dispatch</h3>
          <VrdcDispatchFields
            shipBy={shipBy}
            onShipByChange={setShipBy}
            fields={dispatchFields}
            onFieldsChange={setDispatchFields}
            deliveryTechnicians={technicians}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">E-way bill number</span>
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={ewayBillNumber}
                onChange={(e) => setEwayBillNumber(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-600">E-way bill date</span>
              <input
                type="date"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={ewayBillDate}
                onChange={(e) => setEwayBillDate(e.target.value)}
              />
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <EsignBox
              label="Warehouse signature"
              url={challan.warehouse_dispatch_esign_url}
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
            Dispatch Scrap Challan
          </Button>
        </div>
      ) : null}

      {!isDraft ? (
        <div className="border rounded-xl bg-white p-4 text-sm space-y-1">
          <p><span className="text-slate-500">Ship by:</span> {challan.ship_by || '—'}</p>
          <p><span className="text-slate-500">Dispatched at:</span> {challan.dispatched_at ? new Date(challan.dispatched_at).toLocaleString('en-IN') : '—'}</p>
          {challan.courier_name ? <p><span className="text-slate-500">Courier:</span> {challan.courier_name} · {challan.awb_number || '—'}</p> : null}
          {challan.eway_bill_number ? <p><span className="text-slate-500">E-way:</span> {challan.eway_bill_number}</p> : null}
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
