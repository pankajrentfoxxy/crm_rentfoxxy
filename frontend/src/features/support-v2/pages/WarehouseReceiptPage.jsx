import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, PageHeader } from '../../../components/ui/supportPrimitives';
import { getWorkOrder, listWorkOrders, submitWarehouseReceipt } from '../supportV2Api';
import { SUPPORT_V2_BASE } from '../supportV2Utils';
import CameraScanner from '../../../components/CameraScanner';

export default function WarehouseReceiptPage() {
  const { woId } = useParams();
  const nav = useNavigate();
  const [queue, setQueue] = useState([]);
  const [data, setData] = useState(null);
  const [scanned, setScanned] = useState([]);
  const [manual, setManual] = useState('');
  const [cam, setCam] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (woId) {
      getWorkOrder(woId).then((r) => setData(r.data)).catch(() => toast.error('Work order not found'));
      return;
    }
    listWorkOrders({ wo_type: 'RETURN_PICKUP', limit: 40 })
      .then((r) => setQueue((r.data?.rows || []).filter((w) => w.status === 'COMPLETED')))
      .catch(() => setQueue([]));
  }, [woId]);

  const expected = data?.assets || [];
  const match = (value) => expected.find((a) => (
    String(a.ttspl_id || '') === value
    || String(a.serial_number || '') === value
    || String(a.serial_id || '') === value
  ));

  const addScan = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    const hit = match(value);
    if (!hit) {
      toast.error('Not on this work order');
      return;
    }
    setScanned((cur) => (cur.includes(hit.serial_id) ? cur : [...cur, hit.serial_id]));
    setManual('');
  };

  const missing = useMemo(
    () => expected.filter((a) => a.serial_id && !scanned.includes(a.serial_id)),
    [expected, scanned]
  );

  const submit = async () => {
    if (missing.length && !reason.trim()) {
      toast.error('Give a short-shipment reason for unscanned serials');
      return;
    }
    setSaving(true);
    try {
      await submitWarehouseReceipt(data.wo.wo_id, {
        serial_ids: scanned,
        scanned: missing.length === 0,
        short_shipment_reason: missing.length ? reason : null,
      });
      toast.success('Warehouse receipt recorded');
      nav(`${SUPPORT_V2_BASE}/jobs/${data.wo.wo_id}`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Receipt failed');
    } finally {
      setSaving(false);
    }
  };

  if (!woId) {
    return (
      <div className="p-4 max-w-2xl mx-auto space-y-3">
        <PageHeader title="Warehouse receipt" subtitle="Scan returned units against the expected list." />
        {queue.map((w) => (
          <button
            key={w.wo_id}
            type="button"
            className="block w-full text-left bg-white rounded-[10px] border border-sup-lineSoft p-3"
            onClick={() => nav(`${SUPPORT_V2_BASE}/returns/receipt/${w.wo_id}`)}
          >
            <div className="font-mono font-semibold">{w.wo_number}</div>
            <div className="text-[12px] text-sup-muted">{w.customer_name} · {w.document_number || 'no DC'}</div>
          </button>
        ))}
        {!queue.length && <p className="text-sm text-sup-muted">No completed return pickups waiting.</p>}
      </div>
    );
  }

  if (!data?.wo) return <p className="p-4 text-sm text-sup-muted">Loading…</p>;

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-3">
      <PageHeader title={`Receive ${data.wo.wo_number}`} subtitle={`${scanned.length} scanned · ${missing.length} missing · ${expected.length} expected`} />
      <div className="flex gap-1">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addScan(manual); }}
          placeholder="Scan or type serial"
          className="flex-1 border rounded px-2 py-1.5 text-[13px]"
        />
        <Button size="sm" onClick={() => addScan(manual)}>OK</Button>
        <Button size="sm" variant="secondary" onClick={() => setCam((v) => !v)}>Camera</Button>
      </div>
      {cam && <CameraScanner onScan={(v) => { setCam(false); addScan(v); }} />}
      <div className="bg-white rounded-[10px] border border-sup-lineSoft divide-y">
        {expected.map((a) => {
          const ok = scanned.includes(a.serial_id);
          return (
            <div key={a.serial_id || a.line_id} className="px-3 py-2 text-[13px] flex justify-between">
              <span className="font-mono">{a.ttspl_id || a.serial_number}</span>
              <span className={ok ? 'text-sup-ok' : 'text-sup-muted'}>{ok ? 'Scanned' : 'Expected'}</span>
            </div>
          );
        })}
      </div>
      {missing.length > 0 && (
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Short-shipment reason (required if anything is unscanned)"
          className="w-full border rounded px-2 py-1.5 text-[13px]"
          rows={2}
        />
      )}
      <Button size="touch" loading={saving} onClick={submit}>Submit receipt</Button>
    </div>
  );
}
