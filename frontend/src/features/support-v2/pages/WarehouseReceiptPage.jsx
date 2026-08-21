import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, PageHeader, SerialScanInput } from '../../../components/ui/supportPrimitives';
import { getWorkOrder, listWorkOrders, submitWarehouseReceipt } from '../supportV2Api';
import { SUPPORT_V2_BASE } from '../supportV2Utils';
import { matchesAsset } from '../assetMatch';
import CameraScanner from '../../../components/CameraScanner';

export default function WarehouseReceiptPage() {
  const { woId } = useParams();
  const nav = useNavigate();
  const [queue, setQueue] = useState([]);
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [scanned, setScanned] = useState([]);
  const [manual, setManual] = useState('');
  const [cam, setCam] = useState(false);
  const [reason, setReason] = useState('');
  const [signer, setSigner] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (woId) {
      getWorkOrder(woId).then((r) => setData(r.data)).catch(() => toast.error('Work order not found'));
      return;
    }
    listWorkOrders({ status: 'COMPLETED', limit: 80, q })
      .then((r) => setQueue((r.data?.rows || []).filter((w) => ['REPAIR_PICKUP', 'RETURN_PICKUP'].includes(w.wo_type))))
      .catch(() => setQueue([]));
  }, [woId, q]);

  const expected = data?.assets || [];
  const addScan = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    const hit = expected.find((a) => matchesAsset(value, a));
    if (!hit) {
      toast.error('Not on this work order');
      return;
    }
    setScanned((cur) => (cur.includes(hit.serial_id || hit.line_id) ? cur : [...cur, hit.serial_id || hit.line_id]));
    setManual('');
  };

  const missing = useMemo(
    () => expected.filter((a) => !scanned.includes(a.serial_id || a.line_id)),
    [expected, scanned]
  );

  const submit = async () => {
    if (!signer.trim()) {
      toast.error('Sign the receipt before inventory can move');
      return;
    }
    if (missing.length && !reason.trim()) {
      toast.error('Give a short-shipment reason for unscanned serials');
      return;
    }
    setSaving(true);
    try {
      await submitWarehouseReceipt(data.wo.wo_id, {
        serial_ids: scanned.filter((x) => Number(x)),
        scanned: missing.length === 0,
        short_shipment_reason: missing.length ? reason : null,
        signer_name: signer,
      });
      toast.success('Warehouse receipt signed');
      nav(`${SUPPORT_V2_BASE}/warehouse/receipts`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Receipt failed');
    } finally {
      setSaving(false);
    }
  };

  if (!woId) {
    return (
      <div className="p-4 max-w-3xl mx-auto space-y-3">
        <PageHeader title="Warehouse receipt" subtitle={`${queue.length} awaiting`} />
        <SerialScanInput
          value={q}
          onChange={setQ}
          onSubmit={(v) => {
            const hit = queue.find((w) => (w.assets || []).some((a) => matchesAsset(v, a)) || String(w.wo_number).includes(v));
            if (hit) nav(`${SUPPORT_V2_BASE}/warehouse/receipts/${hit.wo_id}`);
            else setQ(v);
          }}
          placeholder="Scan or type TTSPL, serial, WO, AWB or customer"
        />
        {queue.map((w) => (
          <button
            key={w.wo_id}
            type="button"
            className="w-full text-left rounded-lg border border-sup-line bg-white p-3"
            onClick={() => nav(`${SUPPORT_V2_BASE}/warehouse/receipts/${w.wo_id}`)}
          >
            <div className="flex justify-between text-[13px] font-semibold">
              <span>{w.wo_number} · {w.wo_type.replace(/_/g, ' ')}</span>
              <span className="text-sup-muted font-normal">{w.document_number || 'no DC'}</span>
            </div>
            <p className="text-[12px] text-sup-muted">{w.customer_name}</p>
            {(w.assets || []).map((a) => (
              <p key={a.line_id} className="text-[12px]">{a.ttspl_id || '—'} · SN {a.serial_number || '—'} · {a.model || ''}</p>
            ))}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-3">
      <PageHeader title={`Receive ${data?.wo?.wo_number || ''}`} subtitle={`${expected.length - missing.length} of ${expected.length} received`} />
      <SerialScanInput value={manual} onChange={setManual} onSubmit={addScan} />
      <Button variant="ghost" onClick={() => setCam(true)}>Scan with camera</Button>
      {cam && <CameraScanner onResult={addScan} onClose={() => setCam(false)} />}
      {expected.map((a) => {
        const got = scanned.includes(a.serial_id || a.line_id);
        return (
          <div key={a.line_id} className={`rounded-lg border p-3 ${got ? 'border-sup-ok' : 'border-sup-line'}`}>
            <p className="text-[13px] font-medium">{got ? '✓ ' : '○ '}{a.ttspl_id || '—'} · SN {a.serial_number || '—'} · {a.model || '—'}</p>
          </div>
        );
      })}
      {missing.length > 0 && (
        <textarea className="w-full border rounded p-2" placeholder="Short-shipment reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      )}
      <input className="w-full border rounded p-2 min-h-[44px]" placeholder="Received by (type your name to sign)" value={signer} onChange={(e) => setSigner(e.target.value)} />
      <Button className="w-full min-h-[44px]" disabled={saving} onClick={submit}>Sign and receive</Button>
    </div>
  );
}
