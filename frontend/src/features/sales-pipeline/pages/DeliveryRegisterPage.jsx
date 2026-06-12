import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import InhouseTechnicianBucket from '../components/InhouseTechnicianBucket';
import DispatchModal from '../components/DispatchModal';
import {
  listByStatus, markDelivered, markRejected, sendDeliveryOtp, verifyDeliveryOtp,
} from '../salesPipelineApi';
import { DISPATCH_MODE_STYLES, formatDate, statusLabel } from '../salesPipelineUtils';

const TABS = ['in-transit', 'delivered', 'rejected'];

export default function DeliveryRegisterPage() {
  const [tab, setTab] = useState('in-transit');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bucketView, setBucketView] = useState(false);
  const [otpDc, setOtpDc] = useState(null);
  const [otpValue, setOtpValue] = useState('');
  const [rejectDc, setRejectDc] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [dispatchDc, setDispatchDc] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listByStatus(tab, { limit: 100 });
      setRows(res.data?.rows || res.data?.deliveries || []);
    } catch {
      toast.error('Failed to load delivery register');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const buckets = useMemo(() => {
    const inhouse = rows.filter((r) => r.dispatch_mode === 'inhouse' || r.ship_by === 'by_hand');
    const map = {};
    inhouse.forEach((d) => {
      const key = d.delivery_person_name || d.technician_name || 'Unassigned';
      if (!map[key]) map[key] = { name: key, deliveries: [] };
      map[key].deliveries.push(d);
    });
    return Object.values(map);
  }, [rows]);

  const handleSendOtp = async (d) => {
    try {
      await sendDeliveryOtp(d.dc_number, {});
      toast.success('OTP sent to customer');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const handleVerify = async () => {
    try {
      await verifyDeliveryOtp(otpDc.dc_number, { otp: otpValue });
      await markDelivered(otpDc.dc_number, {});
      toast.success('Delivered ✓');
      setOtpDc(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Verify failed');
    }
  };

  const handleReject = async () => {
    try {
      await markRejected(rejectDc.dc_number, { rejection_reason: rejectReason });
      toast.success('Marked rejected');
      setRejectDc(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Delivery Register</h1>
          <p className="text-sm text-gray-500">Track in-transit and completed deliveries</p>
        </div>
        {tab === 'in-transit' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={bucketView} onChange={(e) => setBucketView(e.target.checked)} />
            Technician Bucket View
          </label>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
            {t.replace('-', ' ')}
          </button>
        ))}
      </div>

      {bucketView && tab === 'in-transit' ? (
        <InhouseTechnicianBucket
          buckets={buckets}
          onSendOtp={handleSendOtp}
          onVerifyOtp={setOtpDc}
          onReject={setRejectDc}
        />
      ) : (
        <div className="bg-white border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase text-left">
              <tr>
                <th className="px-4 py-3">DC #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">SO #</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                {tab === 'in-transit' && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
              ) : rows.map((row) => (
                <tr key={row.dc_number}>
                  <td className="px-4 py-3 font-mono text-blue-700">{row.dc_number}</td>
                  <td className="px-4 py-3">{row.customer_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.sales_order_number}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${DISPATCH_MODE_STYLES[row.dispatch_mode] || 'bg-gray-100'}`}>
                      {row.dispatch_mode || row.ship_by || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{formatDate(row.created_at || row.dispatched_at)}</td>
                  <td className="px-4 py-3">{statusLabel(row.status)}</td>
                  {tab === 'in-transit' && (
                    <td className="px-4 py-3 space-x-2">
                      {(row.dispatch_mode === 'inhouse' || row.ship_by === 'by_hand') && (
                        <>
                          <button type="button" className="text-xs text-blue-600" onClick={() => handleSendOtp(row)}>Send OTP</button>
                          <button type="button" className="text-xs text-emerald-700" onClick={() => setOtpDc(row)}>Verify & Deliver</button>
                        </>
                      )}
                      <button type="button" className="text-xs text-gray-700" onClick={() => markDelivered(row.dc_number, {}).then(load).then(() => toast.success('Delivered'))}>Mark Delivered</button>
                      <button type="button" className="text-xs text-red-700" onClick={() => setRejectDc(row)}>Reject</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {otpDc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setOtpDc(null)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-3">Verify OTP — {otpDc.dc_number}</h3>
            <input className="w-full border rounded-lg px-3 py-2 mb-3" value={otpValue} onChange={(e) => setOtpValue(e.target.value)} placeholder="OTP" />
            <button type="button" onClick={handleVerify} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm">Verify & Deliver</button>
          </div>
        </div>
      )}

      {rejectDc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setRejectDc(null)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-3">Reject — {rejectDc.dc_number}</h3>
            <textarea className="w-full border rounded-lg px-3 py-2 mb-3" rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <button type="button" onClick={handleReject} className="w-full py-2 bg-red-600 text-white rounded-lg text-sm">Confirm</button>
          </div>
        </div>
      )}

      <DispatchModal open={Boolean(dispatchDc)} dcNumber={dispatchDc} onClose={() => setDispatchDc(null)} onDispatched={load} />
    </div>
  );
}
