import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { Button } from '../../../components/ui/primitives';
import PaymentModal from '../components/PaymentModal';
import DCForm from '../components/DCForm';
import SoSerialPanel from '../components/SoSerialPanel';
import SoDeliveryAddressPanel from '../components/SoDeliveryAddressPanel';
import SoLineRateEditModal from '../components/SoLineRateEditModal';
import SoLineHsnEditModal from '../components/SoLineHsnEditModal';
import SoShippingAddressEditModal from '../components/SoShippingAddressEditModal';
import SoActivityPanel from '../components/SoActivityPanel';
import { DispatchWorkflowCard } from '../../dispatch/components/DispatchWorkflowPanel';
import SoPartialCancelModal from '../components/SoPartialCancelModal';
import { cancelSalesOrder, getQuotation, getSalesOrderFull, logSoDocumentActivity, regenerateSalesOrderPdf } from '../salesPipelineApi';
import { getBackendOrigin } from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import { canEditSoLineRateConfig, canPartialCancelSalesOrder, canViewAnySection } from '../../../utils/permissionHelper';
import usePermission from '../../../hooks/usePermission';
import { formatConfig, formatCurrency, formatDate, salesOrderTypeLabel, salesOrderTypeStyle, salesOrderStatusLabel, deliveryChallanDetailPath, parseDeliveryAddress, formatDeliveryAddressLine, deliveryAddressPhone, formatSupplyStateLabel, resolveSupplyStateFromShipping } from '../salesPipelineUtils';
import { getSoScopeConfig, orderMatchesScope, salesOrderListPath, SO_SERIAL_EDIT_SECTIONS, SO_LAPTOPS_TAB_VIEW_SECTIONS } from '../salesOrderScope';

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

const TABS = ['overview', 'laptops', 'addresses', 'payments', 'dcs', 'activity', 'quote'];

export default function SalesOrderDetailPage({ scope: scopeProp }) {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const soNumber = resolveSoNumber(params);
  const { user, effectivePermissions } = useAuth();
  const { canView, canEdit } = usePermission();
  const canViewPayments = canView('payment_records');
  const canViewQuotations = canView('sales_quotations');
  const isSuperAdmin = user?.role === 'super_admin';
  const canEditLineRateConfig = canEditSoLineRateConfig(user, effectivePermissions);
  const canPartialCancel = canPartialCancelSalesOrder(user, effectivePermissions);
  const isDispatchUser = user?.role === 'dispatch';
  const canViewDispatchOps = isDispatchUser || isSuperAdmin
    || canEdit('dispatch_workflow') || canEdit('dispatch_pending_orders')
    || canEdit('sales_orders_replacement') || canEdit('replacement_so_laptop_qc')
    || canEdit('so_laptop_qc');
  const canViewLaptopsTab = canViewDispatchOps
    || canViewAnySection(user, effectivePermissions, SO_LAPTOPS_TAB_VIEW_SECTIONS);
  const canOverrideHsn = user?.role === 'admin' || user?.role === 'super_admin';
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [payments, setPayments] = useState([]);
  const [quote, setQuote] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [dcOpen, setDcOpen] = useState(false);
  const [editRateLine, setEditRateLine] = useState(null);
  const [editHsnLine, setEditHsnLine] = useState(null);
  const [editShippingOpen, setEditShippingOpen] = useState(false);
  const [partialCancelLine, setPartialCancelLine] = useState(null);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);

  const visibleTabs = useMemo(() => TABS.filter((t) => {
    if (t === 'payments') return canViewPayments;
    if (t === 'quote') return canViewQuotations;
    if (t === 'laptops') return canViewLaptopsTab;
    return true;
  }), [canViewPayments, canViewQuotations, canViewLaptopsTab]);

  const load = useCallback(async () => {
    try {
      const res = await getSalesOrderFull(soNumber);
      setData(res.data);
      setPayments(canViewPayments ? (res.data?.payments || []) : []);
      const qn = res.data?.lines?.[0]?.quotation_number;
      if (qn && canViewQuotations) {
        getQuotation(qn).then((qr) => setQuote(qr.data)).catch(() => {});
      } else {
        setQuote(null);
      }
      setActivityRefreshKey((k) => k + 1);
    } catch {
      toast.error('Failed to load sales order');
    }
  }, [soNumber, canViewPayments, canViewQuotations]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab('overview');
  }, [visibleTabs, tab]);

  const lines = data?.lines || [];
  const head = lines[0] || {};
  const summary = data?.summary || {};
  const totals = data?.totals || {};
  const dcs = data?.delivery_challans || [];
  const attachedCount = Number(data?.attached_count ?? summary.attached_count ?? 0);
  const deliveredCount = Number(data?.delivered_count ?? summary.delivered_count ?? 0);
  const dispatchedCount = Number(data?.dispatched_count ?? summary.dispatched_count ?? 0);
  const laptopQty = Number(data?.laptop_qty ?? summary.laptop_qty ?? lines.reduce(
    (sum, l) => sum + Number(l.main_qty || l.quantity || 0),
    0
  ));
  const pendingQty = Number(
    data?.pending_qty ?? summary.pending_qty
    ?? Math.max(0, laptopQty - deliveredCount - dispatchedCount - attachedCount)
  );
  const dispatchDate = data?.dispatch_date ?? summary.dispatch_date ?? null;
  const hasAttachedLaptops = attachedCount > 0;
  const hasDc = (deliveredCount + dispatchedCount) > 0;
  const halfGst = (Number(totals.gst_rate) || 18) / 2;
  const shippingAddr = parseDeliveryAddress(head.customer_shipping_address);
  const supplyStateLabel = formatSupplyStateLabel(
    resolveSupplyStateFromShipping(shippingAddr, head.supply_state)
  );
  const isCancelled = String(data?.status || head.status || '').toLowerCase() === 'cancelled';
  const resolvedScope = scopeProp
    || (data?.is_replacement_order ? 'replacement' : null)
    || (orderMatchesScope(head, 'sale') ? 'sale' : orderMatchesScope(head, 'rental') ? 'rental' : null);
  const scopeConfig = getSoScopeConfig(resolvedScope);
  const listPath = salesOrderListPath(resolvedScope);
  const cameFromElsewhere = Boolean(location.state?.from);

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
          <button
            type="button"
            onClick={() => (cameFromElsewhere ? navigate(-1) : navigate(listPath))}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back
          </button>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <h1 className="text-2xl font-semibold font-mono">{soNumber}</h1>
            {scopeConfig && (
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold text-white"
                style={{ backgroundColor: scopeConfig.brandColor }}
              >
                {scopeConfig.brandName}
              </span>
            )}
          </div>
          <p className="text-gray-600">{head.customer_name}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="inline-flex items-center gap-1 rounded-lg bg-blue-100 px-3 py-1 text-sm font-bold text-blue-900">
              <span className="font-medium opacity-75">Total</span> {laptopQty}
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800">
              <span className="font-medium opacity-75">Delivered</span> {deliveredCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-teal-100 px-3 py-1 text-sm font-bold text-teal-900">
              <span className="font-medium opacity-75">Attached</span> {attachedCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">
              <span className="font-medium opacity-75">Dispatched</span> {dispatchedCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1 text-sm font-bold text-slate-800">
              <span className="font-medium opacity-75">Pending</span> {pendingQty}
            </span>
            {dispatchDate ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-100 px-3 py-1 text-sm font-bold text-indigo-900">
                <span className="font-medium opacity-75">Dispatch Date</span> {formatDate(dispatchDate)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${salesOrderTypeStyle({ ...head, is_replacement_order: data?.is_replacement_order })}`}>
              {salesOrderTypeLabel({ ...head, is_replacement_order: data?.is_replacement_order })}
            </span>
            {isCancelled && (
              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Cancelled</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={async () => {
            try {
              const r = await regenerateSalesOrderPdf(soNumber);
              const url = pdfUrl(r.data?.pdf_path) || pdfUrl(head.pdf_path);
              if (url) {
                window.open(url, '_blank');
                logSoDocumentActivity(soNumber, { action: 'pdf_downloaded' }).catch(() => {});
              } else toast.error('PDF not available');
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
        {visibleTabs.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500'}`}>
            {t === 'dcs' ? 'Delivery Challans' : t === 'quote' ? 'Linked Quotation' : t === 'laptops' ? 'Laptops & QC' : t === 'addresses' ? 'Delivery Addresses' : t === 'activity' ? 'Activity' : t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border rounded-xl p-4 text-sm space-y-2">
            <p><span className="text-gray-500">Date:</span> {formatDate(head.created_at)}</p>
            <p><span className="text-gray-500">Dispatch date:</span> {formatDate(dispatchDate)}</p>
            <p><span className="text-gray-500">Status:</span> {salesOrderStatusLabel(data?.status || head.status)}</p>
            <p><span className="text-gray-500">Laptop quantity:</span> <strong className="text-blue-700">{laptopQty}</strong></p>
            <p><span className="text-gray-500">Delivered:</span> <strong className="text-emerald-700">{deliveredCount}</strong></p>
            <p><span className="text-gray-500">Attached:</span> <strong className="text-teal-700">{attachedCount}</strong></p>
            <p><span className="text-gray-500">Dispatched:</span> <strong className="text-amber-700">{dispatchedCount}</strong></p>
            <p><span className="text-gray-500">Pending:</span> <strong className="text-slate-800">{pendingQty}</strong></p>
            <p><span className="text-gray-500">Shipping State (GST):</span> {supplyStateLabel}</p>
            <div className="pt-1">
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-500 shrink-0">Shipping Address:</span>
                {isSuperAdmin && !isCancelled ? (
                  <button
                    type="button"
                    onClick={() => setEditShippingOpen(true)}
                    className="text-xs text-amber-700 hover:underline shrink-0"
                  >
                    Edit
                  </button>
                ) : null}
              </div>
              {shippingAddr ? (
                <div className="mt-1 text-gray-900">
                  <p>{shippingAddr.name || '—'}</p>
                  {shippingAddr.phone || deliveryAddressPhone(head.customer_shipping_address, head.customer_mobile) ? (
                    <p className="text-gray-600">
                      {shippingAddr.phone || deliveryAddressPhone(head.customer_shipping_address, head.customer_mobile)}
                    </p>
                  ) : null}
                  <p className="text-gray-600">{formatDeliveryAddressLine(head.customer_shipping_address) || '—'}</p>
                </div>
              ) : (
                <p className="mt-1 text-gray-500">—</p>
              )}
            </div>
            <p><span className="text-gray-500">Remarks:</span> {lines.map((l) => (l.remark || '').trim()).filter(Boolean).join(' · ') || '—'}</p>
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
            {canViewPayments && (
              <>
                <div className="flex justify-between"><span className="text-gray-500">Total Collected</span><strong>{formatCurrency(summary.total_paid)}</strong></div>
                <div className={`flex justify-between ${summary.balance_due > 0 ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}`}>
                  <span>Balance Due</span><span>{formatCurrency(summary.balance_due)}</span>
                </div>
              </>
            )}
          </div>
          {canViewDispatchOps ? (
            <DispatchWorkflowCard soNumber={soNumber} onRefresh={load} />
          ) : null}
          <div className="lg:col-span-2 bg-white border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Brand</th>
                  <th className="px-4 py-2 text-left">Config</th>
                  <th className="px-4 py-2 text-center">HSN/SAC</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  {isSuperAdmin || canOverrideHsn || canEditLineRateConfig || canPartialCancel ? <th className="px-4 py-2 text-right"> </th> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{l.brand}</td>
                    <td className="px-4 py-2"><ConfigCard line={l} /></td>
                    <td className="px-4 py-2 text-center font-mono text-xs">{l.hsn_code || '—'}</td>
                    <td className="px-4 py-2 text-right">{l.main_qty || l.quantity}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(l.rate)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency((l.main_qty || l.quantity || 0) * (l.rate || 0))}</td>
                    {isSuperAdmin || canOverrideHsn || canEditLineRateConfig || canPartialCancel ? (
                      <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                        {canPartialCancel && !isCancelled && String(l.status || '').toLowerCase() !== 'cancelled' ? (
                          <button
                            type="button"
                            onClick={() => setPartialCancelLine({ ...l, line_id: l.line_id || l.id })}
                            className="text-xs text-red-700 hover:underline"
                          >
                            Cancel units
                          </button>
                        ) : null}
                        {canOverrideHsn ? (
                          <button
                            type="button"
                            onClick={() => setEditHsnLine(l)}
                            className="text-xs text-teal-700 hover:underline"
                          >
                            Edit HSN
                          </button>
                        ) : null}
                        {canEditLineRateConfig ? (
                          <button
                            type="button"
                            onClick={() => setEditRateLine(l)}
                            className="text-xs text-amber-700 hover:underline"
                          >
                            Edit rate
                          </button>
                        ) : null}
                      </td>
                    ) : null}
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
                <th className="px-4 py-2 text-left">Created</th>
                <th className="px-4 py-2 text-left">Dispatch Date</th>
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
                  <td className="px-4 py-2 font-medium text-slate-800">{formatDate(dc.dispatched_at)}</td>
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

      {tab === 'activity' && <SoActivityPanel soNumber={soNumber} refreshKey={activityRefreshKey} />}

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
      <SoLineRateEditModal
        open={Boolean(editRateLine)}
        line={editRateLine}
        onClose={() => setEditRateLine(null)}
        onSaved={load}
      />
      <SoLineHsnEditModal
        open={Boolean(editHsnLine)}
        line={editHsnLine}
        onClose={() => setEditHsnLine(null)}
        onSaved={load}
      />
      <SoShippingAddressEditModal
        open={editShippingOpen}
        soNumber={soNumber}
        shippingRaw={head.customer_shipping_address}
        onClose={() => setEditShippingOpen(false)}
        onSaved={load}
      />
      <SoPartialCancelModal
        open={Boolean(partialCancelLine)}
        line={partialCancelLine}
        onClose={() => setPartialCancelLine(null)}
        onSaved={load}
      />
    </div>
  );
}
