import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import QuotationForm from '../components/QuotationForm';
import { listQuotations, updateQuotationStatus } from '../salesPipelineApi';
import { formatCurrency, formatDate, QUOTE_STATUS_STYLES, typeLabel, TYPE_STYLES } from '../salesPipelineUtils';

const TABS = ['all', 'draft', 'sent', 'approved', 'rejected'];

export default function QuotationListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [prefill, setPrefill] = useState({});
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (location.state?.openForm) {
      setFormOpen(true);
      setPrefill(location.state.prefill || {});
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (tab !== 'all') params.status = tab === 'draft' ? 'pending' : tab;
      const res = await listQuotations(params);
      setRows(res.data?.quotations || []);
    } catch {
      toast.error('Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    total: rows.length,
    draft: rows.filter((r) => r.status === 'pending' || r.status === 'draft').length,
    sent: rows.filter((r) => r.status === 'sent').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
  }), [rows]);

  const onResend = async (qn) => {
    try {
      await updateQuotationStatus(qn, { status: 'sent' });
      toast.success('Quotation sent');
      load();
    } catch {
      toast.error('Send failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Quotations</h1>
          <p className="text-sm text-gray-500">EST-* series</p>
        </div>
        <PermissionGate section="sales_quotations" action="create">
          <button type="button" onClick={() => setFormOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Create Quotation
          </button>
        </PermissionGate>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[
          ['Total', stats.total], ['Draft', stats.draft], ['Sent', stats.sent],
          ['Approved', stats.approved], ['Rejected', stats.rejected],
        ].map(([label, val]) => (
          <div key={label} className="bg-white border rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-lg font-semibold">{val}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3">Quote #</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No quotations</td></tr>
            ) : rows.map((row) => (
              <React.Fragment key={row.quotation_number}>
                <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(expanded === row.quotation_number ? null : row.quotation_number)}>
                  <td className="px-4 py-3 font-mono text-blue-700">{row.quotation_number}</td>
                  <td className="px-4 py-3">{formatDate(row.created_at)}</td>
                  <td className="px-4 py-3">{row.customer_name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_STYLES[row.quotation_type] || 'bg-gray-100'}`}>{typeLabel(row.quotation_type)}</span>
                  </td>
                  <td className="px-4 py-3">{formatCurrency(row.total_value || row.line_total)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${QUOTE_STATUS_STYLES[row.status] || 'bg-gray-100'}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-3 space-x-2" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="text-blue-600 text-xs" onClick={() => navigate(`/sales-pipeline/quotations/${row.quotation_number}`)}>View</button>
                    {row.status === 'approved' && (
                      <Link to="/sales-pipeline/sales-orders" state={{ fromQuote: row.quotation_number }} className="text-xs text-emerald-700">Create SO</Link>
                    )}
                    <button type="button" className="text-xs text-gray-600" onClick={() => onResend(row.quotation_number)}>Send Email</button>
                  </td>
                </tr>
                {expanded === row.quotation_number && row.lines?.length > 0 && (
                  <tr><td colSpan={7} className="px-4 py-2 bg-gray-50 text-xs text-gray-600">
                    {row.lines.map((l, i) => <span key={i} className="mr-3">{l.brand} {l.model_name} ×{l.quantity}</span>)}
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <QuotationForm
        open={formOpen}
        prefill={prefill}
        onClose={() => { setFormOpen(false); setPrefill({}); }}
        onSaved={load}
      />
    </div>
  );
}
