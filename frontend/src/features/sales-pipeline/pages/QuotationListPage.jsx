import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Plus, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { PageHeader, StatCard, Button } from '../../../components/ui/primitives';
import QuotationForm from '../components/QuotationForm';
import { listQuotations, sendQuotationEmail } from '../salesPipelineApi';
import { formatCurrency, formatDate, QUOTE_STATUS_STYLES, quoteStatusLabel, typeLabel, TYPE_STYLES } from '../salesPipelineUtils';

const TABS = ['all', 'draft', 'sent', 'accepted', 'approved', 'rejected'];

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
    accepted: rows.filter((r) => r.status === 'accepted').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
  }), [rows]);

  const onResend = async (row) => {
    try {
      await sendQuotationEmail(row.quotation_number, { email: row.customer_email });
      toast.success('Quotation sent from sales@rentfoxxy.com');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Send failed');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Quotations"
        subtitle="EST-* series"
        icon={FileText}
        actions={(
          <PermissionGate section="sales_quotations" action="create">
            <Button icon={Plus} onClick={() => setFormOpen(true)}>Create Quotation</Button>
          </PermissionGate>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-4">
        <StatCard label="Total" value={stats.total} tone="gray" />
        <StatCard label="Draft" value={stats.draft} tone="amber" />
        <StatCard label="Sent" value={stats.sent} tone="blue" />
        <StatCard label="Accepted" value={stats.accepted} tone="green" />
        <StatCard label="Approved" value={stats.approved} tone="green" />
        <StatCard label="Rejected" value={stats.rejected} tone="red" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 min-h-[36px] rounded-full text-xs font-medium capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Mobile cards */}
      <div className="grid gap-3 sm:hidden mb-4">
        {loading ? (
          <p className="text-center text-sm text-gray-500 py-8">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">No quotations</p>
        ) : rows.map((row) => (
          <div key={row.quotation_number} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-blue-700 font-semibold">{row.quotation_number}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs ${QUOTE_STATUS_STYLES[row.status] || 'bg-gray-100'}`}>{quoteStatusLabel(row.status)}</span>
            </div>
            <p className="font-medium text-slate-800">{row.customer_name}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{formatDate(row.created_at)}</span>
              <span className={`px-2 py-0.5 rounded-full ${TYPE_STYLES[row.quotation_type] || 'bg-gray-100'}`}>{typeLabel(row.quotation_type)}</span>
              <span className="font-semibold text-slate-700">{formatCurrency(row.total_value || row.line_total)}</span>
            </div>
            {row.lines?.length > 0 && (
              <p className="text-xs text-slate-500">{row.lines.map((l) => `${l.brand || ''} ${l.model_name || ''} ×${l.quantity}`).join(', ')}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
              <button type="button" className="text-blue-600 text-sm font-semibold" onClick={() => navigate(`/sales-pipeline/quotations/${row.quotation_number}`)}>View</button>
              {['approved', 'accepted'].includes(row.status) && (
                <Link to="/sales-pipeline/sales-orders" state={{ fromQuote: row.quotation_number }} className="text-sm text-emerald-700 font-semibold">Create SO</Link>
              )}
              <button type="button" className="text-sm text-gray-600 font-semibold" onClick={() => onResend(row)}>Send Email</button>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block bg-white border rounded-xl overflow-x-auto">
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
                    <span className={`px-2 py-0.5 rounded-full text-xs ${QUOTE_STATUS_STYLES[row.status] || 'bg-gray-100'}`}>{quoteStatusLabel(row.status)}</span>
                  </td>
                  <td className="px-4 py-3 space-x-2" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="text-blue-600 text-xs" onClick={() => navigate(`/sales-pipeline/quotations/${row.quotation_number}`)}>View</button>
                    {['approved', 'accepted'].includes(row.status) && (
                      <Link to="/sales-pipeline/sales-orders" state={{ fromQuote: row.quotation_number }} className="text-xs text-emerald-700">Create SO</Link>
                    )}
                    <button type="button" className="text-xs text-gray-600" onClick={() => onResend(row)}>Send Email</button>
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
