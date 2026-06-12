import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Users, Clock, CheckCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import api from '../utils/api';
import { getSalesDashboard } from '../features/reporting/reportingApi';
import { getFinanceDashboard } from '../features/finance-overview/financeOverviewApi';
import MetricCard from '../features/reporting/components/MetricCard';

const ROLE_REDIRECTS = {
  admin: '/reports/manager-dashboard',
  manager: '/reports/manager-dashboard',
};

const SUPPORT_ROLES = ['support', 'support_lead', 'support_tech'];
const FLOOR_ROLES = ['warehouse', 'floor_manager', 'technician', 'qc', 'team_member', 'team_lead'];

function SalesDashboard() {
  const [data, setData] = useState(null);
  const [leads, setLeads] = useState([]);

  useEffect(() => {
    getSalesDashboard().then((r) => setData(r.data?.data || r.data)).catch(() => setData(null));
    api.get('/leads', { params: { limit: 5, sort: 'updated_at' } })
      .then((r) => setLeads((r.data?.leads || r.data?.data || []).slice(0, 5)))
      .catch(() => setLeads([]));
  }, []);

  const leadsData = data?.my_leads || {};
  const conv = data?.conversions || {};

  const pipelineLinks = [
    { label: 'Hot Leads', path: '/lead-crm/leads?status=Hot', color: 'bg-red-50 text-red-700 border-red-100' },
    { label: 'Warm Leads', path: '/lead-crm/leads?status=Warm', color: 'bg-amber-50 text-amber-700 border-amber-100' },
    { label: 'Follow-ups', path: '/lead-crm/follow-ups', color: 'bg-blue-50 text-blue-700 border-blue-100' },
    { label: 'Quotations', path: '/sales-pipeline/quotations', color: 'bg-purple-50 text-purple-700 border-purple-100' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Sales Dashboard</h2>
        <p className="text-sm text-gray-500">Your leads and pipeline at a glance</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Active Leads" value={leadsData.total || 0} color="purple" />
        <MetricCard title="Follow-ups Today" value={leadsData.follow_up_today || 0} color="blue" />
        <MetricCard title="Follow-ups Overdue" value={leadsData.follow_up_overdue || 0} color="red" />
        <MetricCard title="Converted This Month" value={conv.this_month || 0} color="green" />
      </div>
      <div className="flex flex-wrap gap-3">
        {pipelineLinks.map((l) => (
          <Link key={l.path} to={l.path} className={`px-4 py-2 rounded-lg border text-sm font-medium ${l.color}`}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Leads</h3>
        {leads.length ? (
          <ul className="divide-y divide-gray-50">
            {leads.map((lead) => (
              <li key={lead.leadId || lead.lead_id} className="py-2 flex justify-between items-center">
                <Link to={`/lead-crm/leads/${lead.leadId || lead.lead_id}`} className="text-sm font-medium text-blue-600 hover:underline">
                  {lead.name || lead.company_name}
                </Link>
                <span className="text-xs text-gray-500">{lead.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No recent lead activity</p>
        )}
      </div>
    </div>
  );
}

function AccountsDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    getFinanceDashboard().then((r) => setData(r.data?.data || r.data)).catch(() => setData(null));
  }, []);

  const ci = data?.customer_invoices || {};
  const vb = data?.vendor_bills || {};

  const links = [
    { label: 'Customer Invoices', path: '/customer-billing/invoices' },
    { label: 'Vendor Bills', path: '/vendor-billing/bills' },
    { label: 'E-Invoice Queue', path: '/finance/einvoice-queue' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Finance Dashboard</h2>
        <p className="text-sm text-gray-500">Billing overview and action queues</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Draft Invoices" value={ci.draft?.count || 0} color="blue" />
        <MetricCard title="Sent Unpaid" value={ci.sent_unpaid?.count || 0} color="amber" />
        <MetricCard title="Vendor Bills Pending" value={vb.pending_approval?.count || 0} color="purple" />
        <MetricCard title="E-Invoice Queue" value={data?.einvoice_queue || 0} color="green" />
      </div>
      <div className="flex flex-wrap gap-3">
        {links.map((l) => (
          <Link key={l.path} to={l.path} className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            {l.label} <ArrowRight className="w-4 h-4" />
          </Link>
        ))}
      </div>
    </div>
  );
}

function SupportDashboardLanding() {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.get('/support/dashboard').then((r) => setSummary(r.data.summary || r.data)).catch(() => setSummary(null));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Support Dashboard</h2>
          <p className="text-sm text-gray-500">Ticket queue overview</p>
        </div>
        <Link to="/support/tickets/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          New Ticket
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Open Tickets" value={summary?.open_total ?? '—'} color="blue" />
        <MetricCard title="Overdue (>48h)" value={summary?.overdue_total ?? '—'} color="red" subtitle="Needs immediate attention" />
        <MetricCard title="Resolved Today" value={summary?.resolved_today ?? '—'} color="green" />
        <MetricCard title="Pending Pickups" value={summary?.pending_pickups ?? '—'} color="amber" />
      </div>
      <Link to="/support/overview" className="text-sm text-blue-600 hover:underline">View full support overview →</Link>
    </div>
  );
}

function FloorDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/analytics/dashboard')
      .then((r) => setStats(r.data.stats))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  const statCards = [
    { label: 'Active on Floor', value: stats?.totalTickets || 0, icon: ClipboardList, color: 'blue' },
    { label: 'Active Users', value: stats?.activeUsers || 0, icon: Users, color: 'green' },
    { label: 'Avg. Hours', value: stats?.avgCompletionHours || 0, icon: Clock, color: 'amber' },
    { label: 'Completed', value: stats?.ticketsByStatus?.find((s) => s.status === 'completed')?.count || 0, icon: CheckCircle, color: 'purple' },
  ];

  const quickLinks = [
    { label: 'Floor Pipeline', path: '/floor-pipeline/dashboard' },
    { label: 'QC Queue', path: '/floor-pipeline/tickets?stage=QC1,QC2' },
    { label: 'Inventory', path: '/inventory-management/universal-search' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Floor Dashboard</h2>
        <p className="text-sm text-gray-500">Refurbishment operations overview</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <MetricCard key={stat.label} title={stat.label} value={stat.value} color={stat.color} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {quickLinks.map((l) => (
          <Link key={l.path} to={l.path} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">
            {l.label}
          </Link>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Tickets by Stage</h3>
        <div className="space-y-3">
          {(stats?.ticketsByStage || []).map((stage) => (
            <div key={stage.stage_name} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-bold text-blue-600">
                  {stage.stage_order}
                </div>
                <span className="font-medium text-gray-800">{stage.stage_name}</span>
              </div>
              <span className="px-3 py-1 bg-gray-100 rounded-full text-sm font-semibold">{stage.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { canView } = usePermission();
  const navigate = useNavigate();
  const role = user?.role;
  const redirectTarget = ROLE_REDIRECTS[role];
  const shouldRedirect = redirectTarget && canView('analytics_dashboard');

  useEffect(() => {
    if (shouldRedirect) {
      navigate(redirectTarget, { replace: true });
    }
  }, [shouldRedirect, redirectTarget, navigate]);

  if (shouldRedirect) return null;

  if (role === 'sales') return <SalesDashboard />;
  if (role === 'accounts') return <AccountsDashboard />;
  if (SUPPORT_ROLES.includes(role)) return <SupportDashboardLanding />;
  return <FloorDashboard />;
}
