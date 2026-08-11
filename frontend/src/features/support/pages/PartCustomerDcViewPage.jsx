import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Truck, Package } from 'lucide-react';
import {
  getPartCustomerDc,
  markPartCustomerDcDelivered,
  updatePartCustomerDcCourier,
} from '../supportPartsApi';
import { usePartsBase } from '../partsBase';

export default function PartCustomerDcViewPage() {
  const { dcNumber } = useParams();
  const base = usePartsBase();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [courierName, setCourierName] = useState('');
  const [awbNumber, setAwbNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getPartCustomerDc(decodeURIComponent(dcNumber));
      setData(res.data);
      const dcRow = res.data?.dc;
      setCourierName(dcRow?.courier_name || '');
      setAwbNumber(dcRow?.awb_number || '');
      setTrackingUrl(dcRow?.courier_tracking_url || '');
    } catch {
      toast.error('Part DC not found');
    }
  }, [dcNumber]);

  useEffect(() => { load(); }, [load]);

  const dc = data?.dc;
  const parts = data?.parts || [];
  const costs = data?.laptop_costs || [];

  const needsCourier = dc?.ship_by === 'by_courier'
    && ['processing', 'in_transit'].includes(dc?.status)
    && !dc?.courier_name;

  const markDelivered = async () => {
    setBusy(true);
    try {
      await markPartCustomerDcDelivered(decodeURIComponent(dcNumber));
      toast.success('Marked as delivered');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const saveCourier = async () => {
    if (!courierName.trim()) {
      toast.error('Courier name is required');
      return;
    }
    setBusy(true);
    try {
      const { data: res } = await updatePartCustomerDcCourier(decodeURIComponent(dcNumber), {
        courier_name: courierName.trim(),
        awb_number: awbNumber.trim() || null,
        courier_tracking_url: trackingUrl.trim() || null,
      });
      toast.success(res.message || 'Courier details saved');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save courier details');
    } finally {
      setBusy(false);
    }
  };

  if (!dc) {
    return <div className="p-6 text-center text-gray-500">Loading Part DC…</div>;
  }

  const pdfUrl = dc.pdf_path ? `/${String(dc.pdf_path).replace(/^\//, '')}` : null;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-[#534AB7]" />
            Part DC — {dc.dc_number}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {dc.ticket_number} · {dc.customer_name}
            {dc.sales_order_number && <> · SO: {dc.sales_order_number}</>}
          </p>
        </div>
        <Link to={`${base}/queue`} className="text-sm text-[#534AB7] hover:underline">← Queue</Link>
      </div>

      <div className="bg-white border rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`px-2 py-1 rounded-full font-medium ${
            dc.status === 'delivered' ? 'bg-green-100 text-green-800'
              : dc.status === 'processing' ? 'bg-blue-100 text-blue-800'
                : 'bg-amber-100 text-amber-800'
          }`}>
            {dc.status === 'processing' ? 'Awaiting courier details' : dc.status}
          </span>
          {parts[0]?.billing_type === 'under_warranty' ? (
            <span className="px-2 py-1 rounded-full bg-green-50 text-green-700 font-medium">Under warranty</span>
          ) : (
            <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 font-medium">Chargeable</span>
          )}
          {dc.ship_by === 'by_courier' && (
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 font-medium">Courier</span>
          )}
        </div>

        {(dc.courier_name || dc.awb_number) && (
          <p className="text-sm text-gray-600 flex items-center gap-1">
            <Truck className="w-4 h-4" />
            {dc.courier_name}{dc.awb_number ? ` · AWB ${dc.awb_number}` : ''}
          </p>
        )}

        {needsCourier && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
            <p className="text-sm font-semibold text-blue-900">Add courier details to dispatch</p>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
              placeholder="Courier name *"
              value={courierName}
              onChange={(e) => setCourierName(e.target.value)}
            />
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
              placeholder="AWB / tracking number"
              value={awbNumber}
              onChange={(e) => setAwbNumber(e.target.value)}
            />
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
              placeholder="Tracking URL (optional)"
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={saveCourier}
              className="px-3 py-2 bg-[#534AB7] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save courier & mark in transit'}
            </button>
          </div>
        )}

        <div className="divide-y">
          {parts.map((p) => (
            <div key={p.id} className="py-2 flex justify-between text-sm">
              <div>
                <p className="font-medium">{p.part_name}</p>
                <p className="text-xs text-gray-500 font-mono">{p.prt_id} · {p.ttspl_id}</p>
              </div>
              <span className="text-xs text-gray-500">{p.status}</span>
            </div>
          ))}
        </div>

        {costs.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Internal laptop costing</p>
            {costs.map((c) => (
              <p key={c.id} className="text-xs text-gray-600">
                {c.part_name} on {c.ttspl_id}: Rs. {Number(c.unit_cost || 0).toFixed(2)} ({c.billing_type})
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-2 bg-[#534AB7] text-white rounded-lg text-sm font-semibold"
            >
              <FileText className="w-4 h-4" /> Download Part DC PDF
            </a>
          )}
          {dc.status === 'in_transit' && (
            <button
              type="button"
              disabled={busy}
              onClick={markDelivered}
              className="px-3 py-2 border border-green-600 text-green-700 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Mark delivered'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
