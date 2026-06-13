import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import DispatchModal from '../components/DispatchModal';
import EInvoicePanel from '../components/EInvoicePanel';
import QcStatusBadge from '../components/QcStatusBadge';
import {
  createDcQcTickets, getDC, getDcQcStatus, getSalesOrderFull,
  markDelivered, markRejected, sendDeliveryOtp, verifyDeliveryOtp, updateDC,
} from '../salesPipelineApi';
import {
  DC_STATUS_STYLES, formatConfig, formatCurrency, formatDateTime,
  parseSerials, statusLabel,
} from '../salesPipelineUtils';
import { getBackendOrigin } from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import DcEditModal from '../components/DcEditModal';

const TABS = ['details', 'qc', 'dispatch', 'einvoice'];

function dcPdfUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${getBackendOrigin().replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export default function DeliveryChallanDetailPage() {
  const { dcNumber } = useParams();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [tab, setTab] = useState('details');
  const [lines, setLines] = useState([]);
  const [qc, setQc] = useState(null);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [ttsplDrawer, setTtsplDrawer] = useState(null);
  const [otpModal, setOtpModal] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const head = lines[0] || {};
  const isSale = head.entity_code === 'gorefurbo' || head.quotation_type === 'sale' || head.quotation_type === 'sales';

  const loadQc = useCallback(async () => {
    try {
      const res = await getDcQcStatus(dcNumber);
      setQc(res.data);
    } catch {
      setQc(null);
    }
  }, [dcNumber]);

  const load = useCallback(async () => {
    try {
      const res = await getDC(dcNumber);
      setLines(res.data?.lines || []);
      if (res.data?.lines?.[0]?.sales_order_number) {
        const soRes = await getSalesOrderFull(res.data.lines[0].sales_order_number);
        setPaymentSummary(soRes.data?.summary);
      }
    } catch {
      toast.error('DC not found');
    }
    await loadQc();
  }, [dcNumber, loadQc]);

  useEffect(() => { load(); }, [load]);

  const initiateQc = async () => {
    try {
      const res = await createDcQcTickets(dcNumber);
      toast.success(`${res.data?.tickets_created || 0} QC tickets created`);
      loadQc();
    } catch (err) {
      toast.error(err.response?.data?.message || 'QC initiation failed');
    }
  };

  const handleSendOtp = async () => {
    try {
      await sendDeliveryOtp(dcNumber, {});
      toast.success('OTP sent to customer');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'OTP send failed');
    }
  };

  const handleVerifyDeliver = async () => {
    try {
      await verifyDeliveryOtp(dcNumber, { otp: otpValue });
      await markDelivered(dcNumber, {});
      toast.success('Delivered ✓');
      setOtpModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Verification failed');
    }
  };

  const handleReject = async () => {
    try {
      await markRejected(dcNumber, { rejection_reason: rejectReason });
      toast.success('Marked rejected');
      setRejectModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const specStr = (d) => [d.processor, d.generation, d.ram, d.storage, d.gpu, d.screen_size]
    .filter(Boolean).join(' · ');
  const laptops = lines.flatMap((l) => (
    (l.serials_detail && l.serials_detail.length)
      ? l.serials_detail.map((d) => ({ ttspl: d.ttspl, config: `${d.brand} ${d.model} · ${specStr(d)}`.trim() }))
      : parseSerials(l.serial_number).map((s) => {
        const parts = String(s).split('|');
        return { ttspl: parts[2] || parts[1] || parts[0], config: formatConfig(l) };
      })
  ));
  const allUnits = lines.flatMap((l) => l.serials_detail || []);

  const qcBanner = () => {
    if (!qc?.total_count) return null;
    if (qc.any_failed) return <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{qc.tickets?.filter((t) => t.status === 'qc_failed').length} laptop(s) failed QC. Cannot dispatch until resolved.</div>;
    if (qc.all_passed) return <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">All laptops have passed QC. Ready to dispatch.</div>;
    return <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">{qc.pending_count} of {qc.total_count} laptops pending QC.</div>;
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <Link to="/sales-pipeline/delivery-challans" className="text-sm text-blue-600">← Back</Link>
          <h1 className="text-2xl font-semibold font-mono mt-1">{dcNumber}</h1>
          <p className="text-gray-600">{head.customer_name || '—'} · SO: <Link className="text-blue-600" to={`/sales-pipeline/sales-orders/${head.sales_order_number}`}>{head.sales_order_number}</Link></p>
          <div className="flex flex-wrap gap-2 mt-2 items-center">
            <span className={`px-2 py-0.5 rounded-full text-xs ${DC_STATUS_STYLES[head.status || 'pending']}`}>{statusLabel(head.status || 'pending')}</span>
            {head.entity_code && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${head.entity_code === 'gorefurbo' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                {head.entity_code === 'gorefurbo' ? 'Gorefurbo' : 'Rentfoxxy'}
              </span>
            )}
            <QcStatusBadge allPassed={qc?.all_passed} pendingCount={qc?.pending_count} failedCount={qc?.tickets?.filter((t) => t.status === 'qc_failed').length} totalCount={qc?.total_count} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dcPdfUrl(head.pdf_path) && (
            <a href={dcPdfUrl(head.pdf_path)} target="_blank" rel="noreferrer"
              className="px-3 py-1.5 text-sm border rounded-lg text-gray-700 hover:bg-gray-50">Download PDF</a>
          )}
          {isSuperAdmin && (
            <button type="button" onClick={() => setEditOpen(true)}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg">Edit DC</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-2 border-b overflow-x-auto">
            {TABS.filter((t) => t !== 'einvoice' || isSale).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px whitespace-nowrap ${tab === t ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500'}`}>
                {t === 'qc' ? 'Pre-Dispatch QC' : t === 'einvoice' ? 'E-Invoice' : t}
              </button>
            ))}
          </div>

          {tab === 'details' && (
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">TTSPL</th>
                      <th className="px-3 py-2 text-left">Brand</th>
                      <th className="px-3 py-2 text-left">Model</th>
                      <th className="px-3 py-2 text-left">Processor</th>
                      <th className="px-3 py-2 text-left">Gen</th>
                      <th className="px-3 py-2 text-left">RAM</th>
                      <th className="px-3 py-2 text-left">Storage</th>
                      <th className="px-3 py-2 text-left">GPU</th>
                      <th className="px-3 py-2 text-left">Screen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {allUnits.length === 0 ? (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No laptops attached</td></tr>
                    ) : allUnits.map((d, i) => (
                      <tr key={d.ttspl || i}>
                        <td className="px-3 py-2 font-mono text-xs text-blue-700">{d.ttspl}</td>
                        <td className="px-3 py-2">{d.brand || '—'}</td>
                        <td className="px-3 py-2">{d.model || '—'}</td>
                        <td className="px-3 py-2">{d.processor || '—'}</td>
                        <td className="px-3 py-2">{d.generation || '—'}</td>
                        <td className="px-3 py-2">{d.ram || '—'}</td>
                        <td className="px-3 py-2">{d.storage || '—'}</td>
                        <td className="px-3 py-2">{d.gpu || '—'}</td>
                        <td className="px-3 py-2">{d.screen_size || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 text-sm border-t space-y-1">
                <p>Courier: {head.courier_name || '—'} · AWB: {head.awb_number || '—'}</p>
                <p>Security: {formatCurrency(head.security_amount)} · Shipping: {formatCurrency(head.shiping_charges)}</p>
              </div>
            </div>
          )}

          {tab === 'qc' && (
            <div className="bg-white border rounded-xl p-4 space-y-4">
              <div>
                <h2 className="font-semibold">Pre-Dispatch Quality Check</h2>
                <p className="text-sm text-gray-500">All laptops must pass QC before dispatch</p>
              </div>
              {qcBanner()}
              {!qc?.total_count ? (
                <PermissionGate section="dispatch_ops" action="edit">
                  <button type="button" onClick={initiateQc} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Initiate Pre-Dispatch QC</button>
                </PermissionGate>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="text-left py-2">TTSPL</th>
                        <th className="text-left py-2">Ticket</th>
                        <th className="text-left py-2">Stage</th>
                        <th className="text-left py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(qc.tickets || []).map((t) => (
                        <tr key={t.ticket_id}>
                          <td className="py-2 font-mono text-blue-700">{t.ttspl_id}</td>
                          <td className="py-2"><Link to={`/floor-pipeline/tickets/${t.ticket_id}`} className="text-blue-600">#{t.ticket_id}</Link></td>
                          <td className="py-2">{t.stage_name || '—'}</td>
                          <td className="py-2 capitalize">{t.status?.replace('_', ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" onClick={loadQc} className="text-sm text-blue-600">Refresh QC Status</button>
                </>
              )}
            </div>
          )}

          {tab === 'dispatch' && (
            <div className="bg-white border rounded-xl p-4 space-y-4">
              <h2 className="font-semibold">Dispatch Information</h2>
              {head.status !== 'in_transit' && head.status !== 'delivered' && (
                <>
                  {!qc?.all_passed && qc?.total_count > 0 && (
                    <p className="text-amber-700 text-sm">⚠ Complete pre-dispatch QC before dispatching</p>
                  )}
                  <PermissionGate section="dispatch_ops" action="edit">
                    <button type="button" onClick={() => setDispatchOpen(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Dispatch Now</button>
                  </PermissionGate>
                </>
              )}
              {head.status === 'in_transit' && (
                <div className="text-sm space-y-2">
                  <p>Mode: {head.dispatch_mode || head.ship_by}</p>
                  {head.dispatch_mode === 'inhouse' || head.ship_by === 'by_hand' ? (
                    <>
                      <p>OTP: {head.delivery_otp_sent_at ? 'Sent' : 'Not Sent'}</p>
                      <button type="button" onClick={handleSendOtp} className="px-3 py-1 border rounded-lg text-xs">Send OTP</button>
                      <button type="button" onClick={() => setOtpModal(true)} className="ml-2 px-3 py-1 bg-blue-600 text-white rounded-lg text-xs">Verify & Deliver</button>
                    </>
                  ) : (
                    <PermissionGate section="dispatch_ops" action="edit">
                      <button type="button" onClick={() => markDelivered(dcNumber, {}).then(load).then(() => toast.success('Delivered'))} className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs">Mark Delivered</button>
                    </PermissionGate>
                  )}
                  <button type="button" onClick={() => setRejectModal(true)} className="ml-2 px-3 py-1 text-red-700 border border-red-200 rounded-lg text-xs">Mark Rejected</button>
                </div>
              )}
              {head.status === 'delivered' && (
                <div className="text-sm">
                  <p>Delivered at: {formatDateTime(head.delivered_at)}</p>
                  <p>Location: {head.delivery_location || '—'}</p>
                  {head.pod_image_url && <img src={head.pod_image_url} alt="POD" className="mt-2 h-32 rounded border" />}
                </div>
              )}
              {head.status === 'rejected' && (
                <div className="text-sm">
                  <p className="text-red-700">Reason: {head.rejection_reason}</p>
                  <button type="button" onClick={() => setDispatchOpen(true)} className="mt-2 px-3 py-1 border rounded-lg text-xs">Re-attempt Delivery</button>
                </div>
              )}
            </div>
          )}

          {tab === 'einvoice' && isSale && (
            <EInvoicePanel dcNumber={dcNumber} dcLine={head} customerEmail={head.email} onReload={load} />
          )}
        </div>

        <aside className="space-y-4">
          <div className="bg-white border rounded-xl p-4 text-sm">
            <h3 className="font-semibold mb-2">Customer</h3>
            <p>{head.customer_name}</p>
            <p className="text-gray-500">{head.email}</p>
            <p className="text-gray-500">{head.GST_number || head.gst_number}</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-sm">
            <h3 className="font-semibold mb-2">Laptops in this DC</h3>
            {laptops.map((l, i) => (
              <button key={i} type="button" onClick={() => setTtsplDrawer(l.ttspl)} className="block w-full text-left py-1 text-blue-700 font-mono text-xs hover:underline">
                {l.ttspl} — {l.config}
              </button>
            ))}
          </div>
          {paymentSummary && (
            <div className="bg-white border rounded-xl p-4 text-sm">
              <h3 className="font-semibold mb-2">Payment Status</h3>
              <p>Total: {formatCurrency(paymentSummary.total_value)}</p>
              <p>Paid: {formatCurrency(paymentSummary.total_paid)}</p>
              <p className={paymentSummary.balance_due > 0 ? 'text-red-600 font-medium' : 'text-emerald-700'}>Balance: {formatCurrency(paymentSummary.balance_due)}</p>
            </div>
          )}
        </aside>
      </div>

      <DispatchModal open={dispatchOpen} dcNumber={dcNumber} qcBlocked={qc?.total_count > 0 && !qc?.all_passed} onClose={() => setDispatchOpen(false)} onDispatched={load} />

      {otpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setOtpModal(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-3">Verify OTP</h3>
            <input className="w-full border rounded-lg px-3 py-2 mb-3" value={otpValue} onChange={(e) => setOtpValue(e.target.value)} placeholder="Enter OTP" />
            <button type="button" onClick={handleVerifyDeliver} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm">Verify & Deliver</button>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setRejectModal(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-3">Rejection Reason</h3>
            <textarea className="w-full border rounded-lg px-3 py-2 mb-3" rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <button type="button" onClick={handleReject} className="w-full py-2 bg-red-600 text-white rounded-lg text-sm">Confirm Reject</button>
          </div>
        </div>
      )}

      <TtsplHistoryDrawer ttsplId={ttsplDrawer} open={Boolean(ttsplDrawer)} onClose={() => setTtsplDrawer(null)} />

      {editOpen && (
        <DcEditModal
          dcNumber={dcNumber}
          head={head}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load(); }}
        />
      )}
    </div>
  );
}
