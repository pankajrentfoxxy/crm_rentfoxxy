import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { Button } from '../../../components/ui/primitives';
import PaymentModal from '../components/PaymentModal';
import DCForm from '../components/DCForm';
import SoSerialPanel from '../components/SoSerialPanel';
import SoDeliveryAddressPanel from '../components/SoDeliveryAddressPanel';
import { cancelSalesOrder, getQuotation, getSalesOrderFull, listPayments, regenerateSalesOrderPdf } from '../salesPipelineApi';
import { getBackendOrigin } from '../../../utils/api';
import { formatConfig, formatCurrency, formatDate, TYPE_STYLES, typeLabel, deliveryChallanDetailPath, parseDeliveryAddress, formatSupplyStateLabel, resolveSupplyStateFromShipping } from '../salesPipelineUtils';

function resolveSoNumber(params) {
  const raw = params['*'] ?? params.soNumber ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function ConfigCard({ line }) {
  const title = [line.brand, line.model_name || line.model].filter(Boolean).join(' - ');
  const specs = [line.processor, line.generation, line.ram, line.storage, line.gpu].filter(Boolean).join(' | ');
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm min-w-[220px]">
      <h5 className="font-semibold text-gray-900 leading-snug">
        {title || '—'}
        {line.screen_size ? <span className="font-normal text-gray-600"> | {line.screen_size}</span> : null}
      </h5>
      {specs ? <p className="mt-1 text-xs text-gray-600">{specs}</p> : null}
    </div>
  );
}

function pdfUrl(p) {
  if (!p) return null;
  if (p.startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
}

const TABS = ['overview', 'laptops', 'addresses', 'payments', 'dcs', 'quote'];

export default function SalesOrderDetailPage() {
  const params = useParams();
  const soNumber = resolveSoNumber(params);
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [payments, setPayments] = useState([]);
  const [quote, setQuote] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [dcOpen, setDcOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getSalesOrderFull(soNumber);
      setData(res.data);
      const payRes = await listPayments(soNumber);
      setPayments(payRes.data?.payments || []);
      const qn = res.data?.lines?.[0]?.quotation_number;
      if (qn) {
        getQuotation(qn).then((qr) => setQuote(qr.data)).catch(() => {});
      }
    } catch {
      toast.error('Failed to load sales order');
    }
  }, [soNumber]);

  useEffect(() => { load(); }, [load]);

  const lines = data?.lines || [];
  const head = lines[0] || {};
  const summary = data?.summary || {};
  const totals = data?.totals || {};
  const dcs = data?.delivery_challans || [];
  const attachedCount = Number(data?.attached_count || 0);
  const hasAttachedLaptops = attachedCount > 0;
  const hasDc = dcs.length > 0;
  const halfGst = (Number(totals.gst_rate) || 18) / 2;
  const shippingAddr = parseDeliveryAddress(head.customer_shipping_address);
  const supplyStateLabel = formatSupplyStateLabel(
    resolveSupplyStateFromShipping(shippingAddr, head.supply_state)
  );
  const isCancelled = String(data?.status || head.status || '').toLowerCase() === 'cancelled';

  const handleCancel = useCallback(async () => {
    if (!window.confirm(`Cancel sales order ${soNumber}? Attached laptops will be released back to inventory. This cannot be undone.`)) return;
    try {
      const res = await cancelSalesOrder(soNumber);
      toast.success(res.data?.message || 'Sales order cancelled');
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to cancel sales order');
    }
  }, [soNumber, load]);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <Link to="/sales-pipeline/sales-orders" className="text-sm text-blue-600">← Back</Link>
          <h1 className="text-2xl font-semibold font-mono mt-1">{soNumber}</h1>
          <p className="text-gray-600">{head.customer_name}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${TYPE_STYLES[head.quotation_type]}`}>{typeLabel(head.quotation_type)}</span>
            {isCancelled && (
              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Cancelled</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={async () => {
            try {
              let url = pdfUrl(head.pdf_path);
              if (!url) {
                const r = await regenerateSalesOrderPdf(soNumber);
                url = pdfUrl(r.data?.pdf_path);
              }
              if (url) window.open(url, '_blank');
              else toast.error('PDF not available');
            } catch { toast.error('Could not open PDF'); }
          }}>Download PDF</Button>
          {!isCancelled && hasAttachedLaptops && (
            <PermissionGate section={['sales_orders_doc', 'delivery_challans']} action="create">
              <Button variant="secondary" onClick={() => setDcOpen(true)}>Create DC</Button>
            </PermissionGate>
          )}
          <PermissionGate section="payment_records" action="create">
            <Button onClick={() => setPaymentOpen(true)}>Record Payment</Button>
          </PermissionGate>
          {!isCancelled && !hasDc && (
            <PermissionGate section="sales_orders_doc" action="edit">
              <Button variant="danger" onClick={handleCancel}>Cancel SO</Button>
            </PermissionGate>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500'}`}>
            {t === 'dcs' ? 'Delivery Challans' : t === 'quote' ? 'Linked Quotation' : t === 'laptops' ? 'Laptops & QC' : t === 'addresses' ? 'Delivery Addresses' : t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border rounded-xl p-4 text-sm space-y-2">
            <p><span className="text-gray-500">Date:</span> {formatDate(head.created_at)}</p>
            <p><span className="text-gray-500">Shipping State (GST):</span> {supplyStateLabel}</p>
            <p><span className="text-gray-500">Remarks:</span> {head.remarks || '—'}</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><strong>{formatCurrency(totals.subtotal)}</strong></div>
            {totals.gst_type === 'inter' ? (
              <div className="flex justify-between"><span className="text-gray-500">IGST ({totals.gst_rate || 18}%)</span><strong>{formatCurrency(totals.igst)}</strong></div>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-gray-500">CGST ({halfGst}%)</span><strong>{formatCurrency(totals.cgst)}</strong></div>
                <div className="flex justify-between"><span className="text-gray-500">SGST ({halfGst}%)</span><strong>{formatCurrency(totals.sgst)}</strong></div>
              </>
            )}
            {Number(totals.shipping) > 0 && (
              <div className="flex justify-between"><span className="text-gray-500">Shipping Charges</span><strong>{formatCurrency(totals.shipping)}</strong></div>
            )}
            <div className="flex justify-between"><span className="text-gray-500">Security Deposit</span><strong>{formatCurrency(totals.security ?? summary.security_amount)}</strong></div>
            <div className="flex justify-between border-t pt-1.5 mt-1"><span className="font-semibold text-gray-900">Grand Total</span><strong>{formatCurrency(totals.grand_total)}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">Total Collected</span><strong>{formatCurrency(summary.total_paid)}</strong></div>
            <div className={`flex justify-between ${summary.balance_due > 0 ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}`}>
              <span>Balance Due</span><span>{formatCurrency(summary.balance_due)}</span>
            </div>
          </div>
          <div className="lg:col-span-2 bg-white border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Brand</th>
                  <th className="px-4 py-2 text-left">Config</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{l.brand}</td>
                    <td className="px-4 py-2"><ConfigCard line={l} /></td>
                    <td className="px-4 py-2 text-right">{l.main_qty || l.quantity}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(l.rate)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency((l.main_qty || l.quantity || 0) * (l.rate || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'laptops' && <SoSerialPanel soNumber={soNumber} />}

      {tab === 'addresses' && <SoDeliveryAddressPanel soNumber={soNumber} />}

      {tab === 'payments' && (
        <div className="bg-white border rounded-xl p-4">
          <PermissionGate section="payment_records" action="create">
            <button type="button" onClick={() => setPaymentOpen(true)} className="mb-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">+ Record Payment</button>
          </PermissionGate>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">Type</th>
                <th className="text-right py-2">Amount</th>
                <th className="text-left py-2">Mode</th>
                <th className="text-left py-2">Reference</th>
                <th className="text-left py-2">Recorded By</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => (
                <tr key={p.payment_id}>
                  <td className="py-2">{formatDate(p.payment_date)}</td>
                  <td className="py-2">{p.payment_type}</td>
                  <td className="py-2 text-right">{formatCurrency(p.amount)}</td>
                  <td className="py-2">{p.payment_mode}</td>
                  <td className="py-2">{p.reference_number || '—'}</td>
                  <td className="py-2">{p.recorded_by_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'dcs' && (
        <div>
          {isCancelled ? (
            <p className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
              This sales order is cancelled. New delivery challans cannot be created.
            </p>
          ) : hasAttachedLaptops ? (
            <PermissionGate section={['sales_orders_doc', 'delivery_challans']} action="create">
              <button type="button" onClick={() => setDcOpen(true)} className="mb-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">+ Create DC</button>
            </PermissionGate>
          ) : (
            <p className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
              Attach at least one laptop before creating a delivery challan.
            </p>
          )}
          <table className="w-full text-sm bg-white border rounded-xl overflow-hidden">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">DC #</th>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Dispatch</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {dcs.map((dc) => (
                <tr key={dc.dc_number}>
                  <td className="px-4 py-2 font-mono text-blue-700">
                    <Link to={deliveryChallanDetailPath(dc.dc_number)}>{dc.dc_number}</Link>
                  </td>
                  <td className="px-4 py-2">{formatDate(dc.created_at)}</td>
                  <td className="px-4 py-2">{dc.dispatch_mode || '—'}</td>
                  <td className="px-4 py-2">{dc.status || 'pending'}</td>
                  <td className="px-4 py-2">
                    <Link to={deliveryChallanDetailPath(dc.dc_number)} className="text-blue-600 text-xs">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'quote' && quote && (
        <div className="bg-white border rounded-xl p-4 text-sm">
          <p className="font-mono text-blue-700 mb-2">
            <Link to={`/sales-pipeline/quotations/${quote.quotation_number}`}>{quote.quotation_number}</Link>
          </p>
          {(quote.lines || []).map((l, i) => (
            <p key={i} className="text-gray-600">{l.brand} {formatConfig(l)} ×{l.quantity} @ {formatCurrency(l.rate)}</p>
          ))}
        </div>
      )}

      <PaymentModal open={paymentOpen} soNumber={soNumber} onClose={() => setPaymentOpen(false)} onSaved={load} />
      <DCForm open={dcOpen} onClose={() => setDcOpen(false)} prefillSo={soNumber} />
    </div>
  );
}
