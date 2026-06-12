import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import PaymentModal from '../components/PaymentModal';
import SalesOrderForm from '../components/SalesOrderForm';
import DCForm from '../components/DCForm';
import { listSalesOrders } from '../salesPipelineApi';
import { formatCurrency, formatDate, TYPE_STYLES, typeLabel } from '../salesPipelineUtils';

export default function SalesOrderListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [soDrawer, setSoDrawer] = useState(false);
  const [dcDrawer, setDcDrawer] = useState(false);
  const [paymentSo, setPaymentSo] = useState(null);
  const [prefillQuote, setPrefillQuote] = useState(location.state?.fromQuote || null);
  const [prefillSo, setPrefillSo] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSalesOrders({ limit: 100 });
      setRows(res.data?.sales_orders || []);
    } catch {
      toast.error('Failed to load sales orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (location.state?.fromQuote) {
      setPrefillQuote(location.state.fromQuote);
      setSoDrawer(true);
    }
  }, [location.state]);

  const stats = useMemo(() => ({
    total: rows.length,
    pending: rows.filter((r) => !r.dc_count).length,
    withDc: rows.filter((r) => r.dc_count > 0).length,
  }), [rows]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Sales Orders</h1>
          <p className="text-sm text-gray-500">SO-* series</p>
        </div>
        <PermissionGate section="sales_orders_doc" action="create">
          <button type="button" onClick={() => setSoDrawer(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
            <Plus className="w-4 h-4" /> Create Sales Order
          </button>
        </PermissionGate>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Total</p><p className="text-lg font-semibold">{stats.total}</p></div>
        <div className="bg-white border rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Awaiting DC</p><p className="text-lg font-semibold">{stats.pending}</p></div>
        <div className="bg-white border rounded-lg p-3 text-center"><p className="text-xs text-gray-500">With DC</p><p className="text-lg font-semibold">{stats.withDc}</p></div>
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase text-left">
            <tr>
              <th className="px-4 py-3">SO #</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">DC</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.map((row) => (
              <tr key={row.sales_order_number} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-blue-700">{row.sales_order_number}</td>
                <td className="px-4 py-3">{formatDate(row.created_at)}</td>
                <td className="px-4 py-3">{row.customer_name}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_STYLES[row.quotation_type]}`}>{typeLabel(row.quotation_type)}</span></td>
                <td className="px-4 py-3">{formatCurrency(row.total_value)}</td>
                <td className="px-4 py-3"><span className="bg-gray-100 px-2 py-0.5 rounded-full text-xs">{row.dc_count || 0}</span></td>
                <td className="px-4 py-3 space-x-2">
                  <button type="button" className="text-blue-600 text-xs" onClick={() => navigate(`/sales-pipeline/sales-orders/${row.sales_order_number}`)}>View</button>
                  <PermissionGate section="delivery_challans" action="create">
                    <button type="button" className="text-xs text-teal-700" onClick={() => { setPrefillSo(row.sales_order_number); setDcDrawer(true); }}>Create DC</button>
                  </PermissionGate>
                  <PermissionGate section="payment_records" action="create">
                    <button type="button" className="text-xs text-gray-700" onClick={() => setPaymentSo(row.sales_order_number)}>Record Payment</button>
                  </PermissionGate>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SalesOrderForm open={soDrawer} onClose={() => setSoDrawer(false)} onSaved={load} prefillQuotation={prefillQuote} />
      <DCForm open={dcDrawer} onClose={() => { setDcDrawer(false); setPrefillSo(null); }} prefillSo={prefillSo} />
      <PaymentModal open={Boolean(paymentSo)} soNumber={paymentSo} onClose={() => setPaymentSo(null)} onSaved={load} />
    </div>
  );
}
