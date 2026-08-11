import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Truck, PackageCheck } from 'lucide-react';
import {
  getPartReturnDc,
  receivePartReturnDc,
  updatePartReturnDcCourier,
} from '../supportPartsApi';
import { usePartsBase } from '../partsBase';

export default function PartReturnDcViewPage() {
  const { dcNumber } = useParams();
  const base = usePartsBase();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [courierName, setCourierName] = useState('');
  const [awbNumber, setAwbNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getPartReturnDc(decodeURIComponent(dcNumber));
      setData(res.data);
      const dcRow = res.data?.dc;
      setCourierName(dcRow?.courier_name || '');
      setAwbNumber(dcRow?.awb_number || '');
      setTrackingUrl(dcRow?.courier_tracking_url || '');
    } catch {
      toast.error('Return Part DC not found');
    }
  }, [dcNumber]);

  useEffect(() => { load(); }, [load]);

  const dc = data?.dc;
  const parts = data?.parts || [];

  const needsCourier = dc?.status === 'processing' && dc?.ship_by === 'by_courier' && !dc?.courier_name;

  const saveCourier = async () => {
    if (!courierName.trim()) return toast.error('Courier name required');
    setBusy(true);
    try {
      const { data: res } = await updatePartReturnDcCourier(decodeURIComponent(dcNumber), {
        courier_name: courierName.trim(),
        awb_number: awbNumber.trim() || null,
        courier_tracking_url: trackingUrl.trim() || null,
      });
      toast.success(res.message || 'Courier saved');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const receive = async () => {
    setBusy(true);
    try {
      const { data: res } = await receivePartReturnDc(decodeURIComponent(dcNumber));
      toast.success(res.message || 'Received');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  if (!dc) {
    return <div className="p-6 text-center text-gray-500">Loading Return Part DC…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-[#534AB7]" />
            Return Part DC — {dc.dc_number}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {dc.ticket_number} · {dc.customer_name}
          </p>
        </div>
        <Link to={`${base}/queue`} className="text-sm text-[#534AB7] hover:underline">← Queue</Link>
      </div>

      <div className="bg-white border rounded-xl p-4 space-y-3">
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
          dc.status === 'delivered' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
        }`}>
          {dc.status}
        </span>

        {(dc.courier_name || dc.awb_number) && (
          <p className="text-sm text-gray-600 flex items-center gap-1">
            <Truck className="w-4 h-4" />
            {dc.courier_name}{dc.awb_number ? ` · AWB ${dc.awb_number}` : ''}
          </p>
        )}

        {needsCourier && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
            <p className="text-sm font-semibold text-blue-900">Courier pickup — old part from customer</p>
            <input className="w-full border rounded-lg px-3 py-2 text-sm bg-white" placeholder="Courier name *" value={courierName} onChange={(e) => setCourierName(e.target.value)} />
            <input className="w-full border rounded-lg px-3 py-2 text-sm bg-white" placeholder="AWB" value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} />
            <input className="w-full border rounded-lg px-3 py-2 text-sm bg-white" placeholder="Tracking URL" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} />
            <button type="button" disabled={busy} onClick={saveCourier} className="px-3 py-2 bg-[#534AB7] text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              Save courier details
            </button>
          </div>
        )}

        <div className="divide-y">
          {parts.map((p) => (
            <div key={p.id} className="py-2 text-sm">
              <p className="font-medium">{p.part_name}</p>
              <p className="text-xs text-gray-500 font-mono">
                {p.old_part_prt_id ? `Old: ${p.old_part_prt_id}` : 'Expected old part'}
                {p.ttspl_id ? ` · ${p.ttspl_id}` : ''}
                {p.old_part_condition ? ` · ${p.old_part_condition}` : ''}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          {['in_transit', 'processing'].includes(dc.status) && (
            <button
              type="button"
              disabled={busy}
              onClick={receive}
              className="inline-flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              <FileText className="w-4 h-4" /> Receive at warehouse
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
