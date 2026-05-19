import React, { useState, useEffect, useContext, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate, useParams, useLocation } from 'react-router-dom';

import Inventory from './components/Inventory';
import CustomerInventory from './components/CustomerInventory';
import SupportApp from './components/support/SupportApp';
import PartsInventory from './components/PartsInventory';

import Reports from './components/Reports';
import Procurement from './components/Procurement';
import Warehouse from './components/Warehouse';
import Dispatch from './components/Dispatch';
import BarcodeScanner from './components/BarcodeScanner';
import DiagnosisForm from './components/DiagnosisForm';
import SoftwareChecklist from './components/SoftwareChecklist';
import QC1Form from './components/QC1Form';
import ChipLevelRepairPanel from './components/ChipLevelRepairPanel';
import Sales from './components/Sales';
import LeadList from './components/LeadList';
import LeadDetail from './components/LeadDetail';
import QuotationAccept from './components/QuotationAccept';
import FollowUps from './components/FollowUps';
import ManagerDashboard from './components/ManagerDashboard';
import Orders from './components/Orders';
import QCOrders from './components/QCOrders';
import Customers from './components/Customers';
import Barcode from 'react-barcode';
import {
  Package, Users, ClipboardList, BarChart3, Building2,
  LogOut, Menu, X, Plus, Search, ArrowRight,
  CheckCircle, Clock, Laptop, Archive, Scan, Briefcase, Truck, Pencil, Headphones
} from 'lucide-react';
import './App.css';

import api from './utils/api';
import { AuthProvider, useAuth, AuthContext } from './context/AuthContext';
import { isSupportUser, isSupportTechnician, canAccessCustomerInventory, postLoginPath } from './utils/supportAccess';

// Login Component

// Login Component
function Login() {
  const [mode, setMode] = useState('email'); // 'email' or 'barcode'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [barcode, setBarcode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(email, password);
      navigate(postLoginPath(data.user));
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Login failed';
      setError(msg === 'Network Error' ? 'Cannot reach server. Check if backend is running.' : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleBarcodeLogin = async (e) => {
    e.preventDefault();
    if (!barcode) return;
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login-barcode', { barcode });
      localStorage.setItem('token', data.token);
      window.location.href = '/dashboard'; // Hard reload to refresh context or use context login setter
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid barcode');
      setBarcode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="grid min-h-screen lg:grid-cols-2">
        <div className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            <div className="mb-8">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-orange-100 rounded-xl">
                  <Laptop className="w-8 h-8 text-orange-600" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-slate-900">Rentfoxxy</h1>
                  <p className="text-slate-500 text-sm">Refurbishment Operations Suite</p>
                </div>
              </div>
              <p className="text-slate-600 mt-4">
                Sign in to manage refurbishment flow, QC, inventory, and dispatch in one place.
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="flex border-b border-gray-200 mb-6">
              <button
                onClick={() => setMode('email')}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${mode === 'email' ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                Email Login
              </button>
              <button
                onClick={() => setMode('barcode')}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${mode === 'barcode' ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                Barcode Login
              </button>
            </div>

            {mode === 'email' ? (
              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Work Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="Enter your email"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="••••••••"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-slate-900 text-white py-3 rounded-lg font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Logging in...' : 'Sign In'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleBarcodeLogin} className="space-y-4">
                <div className="text-left mb-2">
                  <p className="text-sm text-slate-500">Scan your ID badge or enter code</p>
                </div>
                <div>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      className="flex-1 px-4 py-3 border-2 border-orange-400 rounded-lg focus:ring-2 focus:ring-orange-500 text-center font-mono text-xl tracking-widest"
                      placeholder="SCAN CODE HERE"
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowScanner(!showScanner)}
                      className="bg-gray-100 px-3 rounded-lg hover:bg-gray-200"
                      title="Toggle Camera"
                    >
                      <Scan className="w-6 h-6 text-gray-700" />
                    </button>
                  </div>

                  {showScanner && (
                    <div className="mb-4 border rounded p-2">
                      <BarcodeScanner
                        onScanSuccess={(code) => {
                          setBarcode(code);
                          setShowScanner(false);
                        }}
                      />
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-slate-900 text-white py-3 rounded-lg font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Verifying...' : 'Login with Barcode'}
                </button>
              </form>
            )}

          </div>
        </div>

        <div className="hidden lg:block relative">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-orange-600"></div>
          <div className="absolute inset-0 opacity-20">
            <div className="w-full h-full bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.25),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.2),transparent_35%),radial-gradient(circle_at_50%_80%,rgba(255,255,255,0.15),transparent_40%)]"></div>
          </div>
          <div className="relative h-full flex items-end p-12">
            <div className="text-white max-w-md">
              <p className="text-sm uppercase tracking-widest text-orange-200 mb-3">Rentfoxxy Operations</p>
              <h2 className="text-4xl font-bold leading-tight mb-4">
                Professional laptop rental & refurbishment workflow.
              </h2>
              <p className="text-orange-100">
                Track every device from intake to inventory with QC-driven quality and clear accountability.
              </p>
              <div className="mt-8 grid grid-cols-3 gap-4 text-xs text-orange-100">
                <div className="bg-white/10 rounded-lg p-3">QC1/QC2 Controls</div>
                <div className="bg-white/10 rounded-lg p-3">Inventory Ready</div>
                <div className="bg-white/10 rounded-lg p-3">Sales Dispatch</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Layout Component
function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const menuItems = [
    { icon: BarChart3, label: 'Dashboard', path: '/dashboard', roles: ['team_member', 'team_lead', 'manager', 'admin', 'floor_manager', 'sales'] },
    { icon: Archive, label: 'Inventory', path: '/inventory', roles: ['manager', 'admin', 'floor_manager'], permission: 'inventory_read', permissionAny: ['inventory_read', 'inventory_write', 'inventory_access'] },
    { icon: ClipboardList, label: 'Tickets', path: '/tickets', roles: ['team_member', 'team_lead', 'manager', 'admin', 'floor_manager'] },
    { icon: Briefcase, label: 'Leads', path: '/leads', roles: ['manager', 'admin', 'sales'], permission: 'sales_access' },
    { icon: Briefcase, label: 'Sales Orders', path: '/sales', roles: ['manager', 'admin', 'sales'], permission: 'sales_access' },
    { icon: Clock, label: 'Follow-ups', path: '/follow-ups', roles: ['manager', 'admin', 'sales'], permission: 'sales_access' },
    { icon: ClipboardList, label: 'Lead Orders', path: '/lead-orders', roles: ['manager', 'admin', 'sales'], permission: 'orders_access' },
    { icon: Users, label: 'Customers', path: '/customers', roles: ['manager', 'admin', 'sales'], permission: 'sales_access' },
    { icon: BarChart3, label: 'Manager Dashboard', path: '/manager-dashboard', roles: ['manager', 'admin'], permission: 'reports_access' },
    { icon: BarChart3, label: 'Reports', path: '/reports', roles: ['manager', 'admin', 'floor_manager'], permission: 'reports_access' },
    { icon: Package, label: 'Parts', path: '/parts', roles: ['manager', 'admin', 'floor_manager'], permission: 'parts_access' },
    { icon: Truck, label: 'Procurement', path: '/procurement', roles: ['manager', 'admin', 'procurement'], permission: 'procurement_access' },
    { icon: Package, label: 'Warehouse', path: '/warehouse', roles: ['manager', 'admin', 'warehouse'], permission: 'warehouse_access' },
    { icon: CheckCircle, label: 'QC Orders', path: '/qc-orders', roles: ['manager', 'admin', 'floor_manager', 'qc'], permission: 'qc_access' },
    { icon: Truck, label: 'Dispatch', path: '/dispatch', roles: ['manager', 'admin', 'floor_manager', 'dispatch'], permission: 'dispatch_access' },
    { type: 'section', label: 'Support' },
    { icon: Headphones, label: 'Support tickets', path: '/support/tickets', roles: ['admin', 'support_lead', 'support_tech'] },
    { icon: Building2, label: 'Customer Inventory', path: '/customer-inventory', roles: ['manager', 'admin', 'floor_manager', 'support_lead', 'support_tech'], permissionAny: ['customer_inventory_access'] },
    { type: 'section', label: 'Team' },
    { icon: Users, label: 'Teams', path: '/teams', roles: ['manager', 'admin'] },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-gray-200 transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
      `}>
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Laptop className="w-8 h-8 text-orange-600" />
              <span className="font-bold text-lg">Rentfoxxy</span>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <nav className="p-3 space-y-0.5 overflow-y-auto">
          {menuItems.filter(item => {
            if (item.type === 'section') {
              if (item.label === 'Support') {
                return user && (['manager', 'admin', 'floor_manager', 'support_lead', 'support_tech'].includes(user.role) || isSupportUser(user));
              }
              const hasTeamAccess = user && ['manager', 'admin'].includes(user.role);
              return hasTeamAccess;
            }
            const permMatch = item.permissionAny
              ? item.permissionAny.some(p => user.permissions?.includes(p))
              : (item.permission && user.permissions?.includes(item.permission));
            return !item.roles ||
              (user && (
                item.roles.includes(user.role) ||
                permMatch
              ));
          }).map((item) => {
            if (item.type === 'section') {
              return (
                <div key={`section-${item.label}`} className="px-3 pt-3 pb-1">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{item.label}</span>
                </div>
              );
            }
            const { icon: Icon, label, path } = item;
            return (
              <Link
                key={path}
                to={path}
                onClick={() => setSidebarOpen(false)}
                className="flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors text-sm"
              >
                <Icon className="w-5 h-5 text-gray-600 shrink-0" />
                <span className="font-medium">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t text-xs text-gray-500">
          Powered by Rentfoxxy Ops
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:ml-64">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="flex-1 lg:flex-none">
              <h1 className="text-xl font-bold text-slate-900">Rentfoxxy</h1>
              <p className="text-xs text-slate-500">Refurbishment Ops</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                  <span className="font-bold text-orange-600">{user?.name?.[0]}</span>
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-slate-800">{user?.name}</p>
                  <p className="text-xs text-slate-500">{user?.role}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

// Dashboard Component
function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const { data } = await api.get('/analytics/dashboard');
      setStats(data.stats);
    } catch (error) {
      console.error('Load stats error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading dashboard...</div>;
  }

  const statCards = [
    { label: 'Total Laptop on Floor', value: stats?.totalTickets || 0, icon: ClipboardList, color: 'blue' },
    { label: 'Active Users', value: stats?.activeUsers || 0, icon: Users, color: 'green' },
    { label: 'Avg. Hour', value: stats?.avgCompletionHours || 0, icon: Clock, color: 'yellow' },
    { label: 'Completed', value: stats?.ticketsByStatus?.find(s => s.status === 'completed')?.count || 0, icon: CheckCircle, color: 'purple' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Dashboard</h2>
        <p className="text-gray-600">Overview of your refurbishment operations</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, idx) => (
          <div key={idx} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-lg bg-${stat.color}-100`}>
                <stat.icon className={`w-6 h-6 text-${stat.color}-600`} />
              </div>
            </div>
            <h3 className="text-3xl font-bold mb-1">{stat.value}</h3>
            <p className="text-gray-600 text-sm">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Tickets by Stage */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-bold mb-4">Tickets by Stage</h3>
        <div className="space-y-3">
          {stats?.ticketsByStage?.map((stage, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-bold text-blue-600">
                  {stage.stage_order}
                </div>
                <span className="font-medium">{stage.stage_name}</span>
              </div>
              <span className="px-3 py-1 bg-gray-100 rounded-full text-sm font-semibold">
                {stage.count} tickets
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Tickets */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-bold mb-4">Recent Tickets</h3>
        <div className="space-y-3">
          {stats?.recentTickets?.slice(0, 5).map((ticket) => (
            <div key={ticket.ticket_id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium">{ticket.serial_number}</p>
                <p className="text-sm text-gray-500">{ticket.brand} {ticket.model}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-blue-600">{ticket.stage_name}</p>
                <p className="text-xs text-gray-500">{new Date(ticket.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Bulk Move Modal Component
function BulkMoveModal({ stages, onClose, onConfirm }) {
  const [currentStageId, setCurrentStageId] = useState('');
  const [targetStageId, setTargetStageId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentStageId || !targetStageId) return alert('Please select both stages');

    setLoading(true);
    await onConfirm(currentStageId, targetStageId);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <ArrowRight className="w-5 h-5 text-blue-600" />
          Bulk Move Tickets
        </h3>
        <p className="text-gray-600 text-sm mb-6">Move ALL tickets from one stage to another. This action cannot be undone easily.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Stage (Source)</label>
            <select
              value={currentStageId}
              onChange={(e) => setCurrentStageId(e.target.value)}
              className="w-full border rounded-lg p-2"
              required
            >
              <option value="">Select Source Stage</option>
              {stages.map(s => <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>)}
            </select>
          </div>

          <div className="flex justify-center text-gray-400">
            <ArrowRight className="w-6 h-6 transform rotate-90 md:rotate-0" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Stage (Target)</label>
            <select
              value={targetStageId}
              onChange={(e) => setTargetStageId(e.target.value)}
              className="w-full border rounded-lg p-2"
              required
            >
              <option value="">Select Target Stage</option>
              {stages.map(s => <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>)}
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Moving...' : 'Move Tickets'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Tickets List Component
function TicketsList() {
  const { user } = useContext(AuthContext); // Access user from context
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [stages, setStages] = useState([]);
  const [users, setUsers] = useState([]);
  const [viewStatus, setViewStatus] = useState('in_progress'); // 'in_progress' or 'completed'
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [ticketPriorityAssign, setTicketPriorityAssign] = useState({}); // { ticketId: { user_id, stage_id } }
  const navigate = useNavigate();

  const loadStages = useCallback(async () => {
    try {
      const { data } = await api.get('/tickets/stages');
      setStages(data.stages);
    } catch (e) { console.error(e); }
  }, []);

  const loadUsers = useCallback(async () => {
    // Only for managers/admins
    if (['floor_manager', 'admin', 'manager'].includes(user?.role)) {
      try {
        const { data } = await api.get('/auth/users');
        setUsers(data.users);
      } catch (e) { console.error(e); }
    }
  }, [user]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      // Use general search endpoint which handles roles; view=completed includes tickets user moved
      let url = `/tickets?search=${search}&view=${viewStatus}`;
      if (stageFilter) url += `&stage_id=${stageFilter}`;

      const { data } = await api.get(url);
      setTickets(data.tickets);
    } catch (error) {
      console.error('Load tickets error:', error);
    } finally {
      setLoading(false);
    }
  }, [search, stageFilter, viewStatus]);

  useEffect(() => {
    loadStages();
  }, [loadStages]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const handleAssign = async (ticketId, userId) => {
    try {
      if (!userId) return;
      await api.post(`/tickets/${ticketId}/assign`, { user_id: userId });
      alert('Assigned successfully');
      loadTickets();
    } catch (error) {
      console.error(error);
      alert('Failed to assign');
    }
  };

  const handlePriorityAssign = async (ticketId) => {
    const sel = ticketPriorityAssign[ticketId];
    if (!sel?.user_id || !sel?.stage_id) return;
    try {
      await api.post(`/tickets/${ticketId}/assign`, { user_id: sel.user_id, target_stage_id: parseInt(sel.stage_id, 10) });
      alert('Assigned and moved successfully');
      setTicketPriorityAssign(prev => ({ ...prev, [ticketId]: {} }));
      loadTickets();
    } catch (error) {
      console.error(error);
      alert('Failed to assign');
    }
  };

  const handleClaim = async (ticketId) => {
    try {
      await api.post(`/tickets/${ticketId}/claim`);
      alert('Ticket claimed successfully!');
      // Reload to reflect changes
      loadTickets();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || 'Failed to claim ticket');
    }
  };

  const handleBulkMove = async (currentStageId, targetStageId) => {
    try {
      const { data } = await api.post('/tickets/bulk-move', {
        current_stage_id: currentStageId,
        target_stage_id: targetStageId
      });
      alert(data.message);
      setShowBulkModal(false);
      loadTickets();
    } catch (error) {
      console.error('Bulk move error:', error);
      alert(error.response?.data?.message || 'Failed to move tickets');
    }
  };

  const filteredTickets = tickets.filter(t => {
    // Backend returns correct set per view; only apply search filter client-side
    const matchesSearch =
      t.serial_number?.toLowerCase().includes(search.toLowerCase()) ||
      t.brand?.toLowerCase().includes(search.toLowerCase()) ||
      t.model?.toLowerCase().includes(search.toLowerCase()) ||
      (t.ttspl_id && t.ttspl_id.toLowerCase().includes(search.toLowerCase()));

    return matchesSearch;
  });

  const getStatusColor = (status) => {
    const colors = {
      in_progress: 'bg-blue-100 text-blue-700',
      completed: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
      on_hold: 'bg-yellow-100 text-yellow-700'
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return <div className="text-center py-12">Loading tickets...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold mb-1">Tickets</h2>
            <p className="text-gray-600">Manage refurbishment tickets</p>
          </div>

          <div className="flex items-center gap-4">
            {/* View Status Tabs */}
            <div className="flex bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setViewStatus('in_progress')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewStatus === 'in_progress'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                In Progress
              </button>
              <button
                onClick={() => setViewStatus('completed')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewStatus === 'completed'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                Completed
              </button>
            </div>

            {['floor_manager', 'admin', 'manager'].includes(user?.role) && (
              <Link
                to="/tickets/create"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden sm:inline">Create Ticket</span>
              </Link>
            )}

            {/* Bulk Action Button */}
            {['floor_manager', 'manager', 'admin'].includes(user?.role) && (
              <button
                onClick={() => setShowBulkModal(true)}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm font-medium"
              >
                <ArrowRight className="w-4 h-4" />
                <span className="hidden sm:inline">Bulk Actions</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadTickets()}
            placeholder="Search by serial number, brand, or model..."
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Stage Filter (Manager only) */}
        {['floor_manager', 'admin', 'manager'].includes(user?.role) && (
          <div className="w-full md:w-64">
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="w-full h-full border border-gray-300 rounded-lg px-3 py-3 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Stages</option>
              {stages.map(s => (
                <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tickets Grid */}
      {filteredTickets.length === 0 && !loading ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No {viewStatus.replace('_', ' ')} tickets found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTickets.map((ticket) => {
            const isPriority = ticket.stage_name === 'Floor Manager' && ['high', 'urgent'].includes(ticket.priority);
            return (
            <div
              key={ticket.ticket_id}
              onClick={() => navigate(`/tickets/${ticket.ticket_id}`)}
              className={`rounded-xl shadow-sm p-6 cursor-pointer hover:shadow-md transition-shadow relative ${
                isPriority
                  ? 'bg-slate-800 border-2 border-amber-500 text-white [&_.text-gray-600]:text-slate-300 [&_.text-gray-500]:text-slate-400'
                  : 'bg-white border border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">#{ticket.ticket_id}{ticket.ttspl_id ? ` • ${ticket.ttspl_id}` : ''}{ticket.machine_number ? ` • ${ticket.machine_number}` : ''}</p>
                  <h3 className="font-bold text-lg">{ticket.serial_number}</h3>
                  <p className="text-sm text-gray-600">{ticket.brand} {ticket.model}</p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${isPriority ? 'bg-amber-500/30 text-amber-100' : getStatusColor(ticket.status)}`}>
                  {isPriority ? 'Priority' : ticket.status}
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Stage:</span>
                  <span className="font-medium">{ticket.stage_name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Assignee:</span>
                  <span className={`font-medium ${!ticket.assigned_user_id ? 'text-orange-600' : ''}`}>
                    {ticket.assigned_user_name || 'Unassigned'}
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t flex flex-col gap-2">
                {/* Manager Assignment */}
                {['floor_manager', 'admin', 'manager'].includes(user?.role) && (
                  <div className="flex flex-col gap-2 mb-2" onClick={e => e.stopPropagation()}>
                    {isPriority ? (
                      <>
                        <div className="flex gap-2 min-w-0">
                          <select
                            className="text-xs bg-slate-700 border border-amber-500/50 text-slate-100 rounded p-1.5 flex-1 min-w-0 focus:ring-1 focus:ring-amber-500/50 [&>option]:bg-slate-800 [&>option]:text-slate-100"
                            value={ticketPriorityAssign[ticket.ticket_id]?.user_id ?? ''}
                            onChange={(e) => setTicketPriorityAssign(prev => ({ ...prev, [ticket.ticket_id]: { ...prev[ticket.ticket_id], user_id: e.target.value } }))}
                          >
                            <option value="">-- Name --</option>
                            {users
                              .filter(u => ['team_member', 'floor_manager'].includes(u.role))
                              .map(u => (
                                <option key={u.user_id} value={u.user_id} title={`${u.name} (${u.team_name || '-'})`}>
                                  {u.name} ({u.team_name || '-'})
                                </option>
                              ))}
                          </select>
                          <select
                            className="text-xs bg-slate-700 border border-amber-500/50 text-slate-100 rounded p-1.5 flex-1 min-w-0 focus:ring-1 focus:ring-amber-500/50 [&>option]:bg-slate-800 [&>option]:text-slate-100"
                            value={ticketPriorityAssign[ticket.ticket_id]?.stage_id ?? ''}
                            onChange={(e) => setTicketPriorityAssign(prev => ({ ...prev, [ticket.ticket_id]: { ...prev[ticket.ticket_id], stage_id: e.target.value } }))}
                          >
                            <option value="">-- Stage --</option>
                            {stages.map(s => (
                              <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePriorityAssign(ticket.ticket_id); }}
                          disabled={!ticketPriorityAssign[ticket.ticket_id]?.user_id || !ticketPriorityAssign[ticket.ticket_id]?.stage_id}
                          className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 rounded disabled:opacity-50 w-full"
                        >
                          Assign & Move
                        </button>
                      </>
                    ) : (
                      <select
                        className="text-xs border border-gray-300 rounded p-1 w-full"
                        value={ticket.assigned_user_id || ''}
                        onChange={(e) => handleAssign(ticket.ticket_id, e.target.value)}
                      >
                        <option value="">-- Assign User --</option>
                        {users
                          .filter(u => ['team_member', 'floor_manager'].includes(u.role))
                          .filter(u => {
                            if (ticket.stage_name === 'Floor Manager') return true;
                            if (!ticket.assigned_team_id) return false;
                            const userTeamIds = u.team_ids?.length ? u.team_ids : (u.team_id != null ? [u.team_id] : []);
                            return userTeamIds.some(tid => tid == ticket.assigned_team_id);
                          })
                          .map(u => (
                            <option key={u.user_id} value={u.user_id}>
                              {u.name} ({u.team_name})
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end">
                  {!ticket.assigned_user_id &&
                    !['floor_manager', 'admin', 'manager'].includes(user?.role) &&
                    ticket.assigned_team_id === user?.team_id ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClaim(ticket.ticket_id);
                      }}
                      className="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-orange-700 flex items-center gap-1 shadow-sm z-10"
                    >
                      <CheckCircle className="w-4 h-4" /> Pick Ticket
                    </button>
                  ) : (
                    <div className="flex items-center text-blue-600 font-medium text-sm">
                      View Details <ArrowRight className="w-4 h-4 ml-1" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
          })}
        </div>
      )}

      {/* Bulk Move Modal */}
      {showBulkModal && (
        <BulkMoveModal
          stages={stages}
          onClose={() => setShowBulkModal(false)}
          onConfirm={handleBulkMove}
        />
      )}
    </div>
  );
}

// Create Ticket Component
function CreateTicket() {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    serial_number: '',
    ttspl_id: '',
    brand: '',
    model: '',
    initial_condition: '',
    priority: 'normal',
    initial_cost: '',
    assigned_team_id: '',
    assigned_user_id: '',
    processor: '',
    ram: '',
    storage: ''
  });
  const [loading, setLoading] = useState(false);
  const [scanTerm, setScanTerm] = useState('');
  const [scanning, setScanning] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [teams, setTeams] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const navigate = useNavigate();

  const pickBestInventoryMatch = (items, term) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    const normalized = term.trim().toLowerCase();
    const exact = items.find(item =>
      (item.machine_number || '').toLowerCase() === normalized ||
      (item.serial_number || '').toLowerCase() === normalized
    );
    return exact || items[0];
  };

  const ticketEligibilityFromInventory = (item) => {
    const st = item.stock_type || '';
    if (st !== 'Cooling Period' && st !== 'Ready') {
      return { ok: false, message: `Cannot create ticket: stock type is '${st || '—'}'. Only Cooling Period or Ready machines can start a repair ticket.` };
    }
    const stat = item.status || '';
    if (stat === 'Reserved') {
      return { ok: false, message: 'Cannot create ticket: this machine is reserved for a sales order. Unassign or cancel the order line first.' };
    }
    if (stat === 'Outward') {
      return { ok: false, message: 'Cannot create ticket: machine is marked Outward. Record the customer return in Inventory first.' };
    }
    if (stat === 'In Repair') {
      return { ok: false, message: 'Cannot create ticket: machine is marked In Repair (e.g. swap/rework). Resolve that state in warehouse/QC first.' };
    }
    return { ok: true };
  };

  useEffect(() => {
    // Fetch teams for assignment (ordered by stage, excludes QC/Dispatch/Procurement)
    if (user && (user.role === 'floor_manager' || user.role === 'admin')) {
      api.get('/teams?for_assignment=1').then(({ data }) => setTeams(data.teams)).catch(console.error);
    }
  }, [user]);

  useEffect(() => {
    // Fetch members when team selected
    if (formData.assigned_team_id) {
      api.get(`/teams/${formData.assigned_team_id}/members`).then(({ data }) => setTeamMembers(data.members)).catch(console.error);
    } else {
      setTeamMembers([]);
    }
  }, [formData.assigned_team_id]);

  const handleScan = async (e) => {
    if (e) e.preventDefault();
    if (!scanTerm.trim()) return;

    setScanning(true);
    try {
      const term = scanTerm.trim();

      const { data } = await api.get(`/inventory/search?term=${term}`);
      const item = pickBestInventoryMatch(data.items, term);
      if (!item) {
        alert('Item not found in inventory.');
        return;
      }

      const elig = ticketEligibilityFromInventory(item);
      if (!elig.ok) {
        alert(elig.message);
        setScanning(false);
        return;
      }

      setFormData({
        ...formData,
        serial_number: item.serial_number,
        brand: item.brand,
        model: item.model,
        processor: item.processor || '',
        ram: item.ram || '',
        storage: item.storage || '',
      });
      alert('Inventory item found! Details auto-filled.');
      setShowScanner(false);
    } catch (error) {
      console.error('Scan error:', error);
      alert('Item not found in inventory or error scanning.');
    } finally {
      setScanning(false);
    }
  };

  const onBarcodeWithScanner = (decodedText) => {
    setScanTerm(decodedText);
    // Direct API call to avoid state sync issues
    api.get(`/inventory/search?term=${decodedText}`)
      .then(({ data }) => {
        const item = pickBestInventoryMatch(data.items, decodedText);
        if (!item) {
          alert(`Scanned ${decodedText} but item not found.`);
          return;
        }
        const elig = ticketEligibilityFromInventory(item);
        if (!elig.ok) {
          alert(elig.message);
          return;
        }
        setFormData(prev => ({
          ...prev,
          serial_number: item.serial_number,
          brand: item.brand,
          model: item.model,
          processor: item.processor || '',
          ram: item.ram || '',
          storage: item.storage || '',
        }));
        alert(`Scanned: ${decodedText}. Details auto-filled.`);
        setShowScanner(false);
      })
      .catch(err => {
        console.error(err);
        alert(`Scanned ${decodedText} but item not found or error.`);
      });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/tickets', formData);
      navigate('/tickets');
    } catch (error) {
      console.error('Create ticket error:', error);
      alert(error.response?.data?.message || 'Failed to create ticket');
    } finally {
      setLoading(false);
    }
  };

  // Check if Floor Manager or Admin
  const canAssign = user && (user.role === 'floor_manager' || user.role === 'admin');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-blue-100 rounded-full">
            <ClipboardList className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Create New Ticket</h2>
            <p className="text-gray-600">Start repair process for a laptop</p>
          </div>
        </div>

        {/* Scan Section */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">Scan Machine # or Search (Serial/Brand)</label>

          {showScanner ? (
            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-gray-700">Scan Barcode</h3>
                <button
                  onClick={() => setShowScanner(false)}
                  className="text-gray-500 hover:text-gray-700"
                  type="button"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <BarcodeScanner
                onScanSuccess={onBarcodeWithScanner}
                onScanFailure={() => {}}
              />
            </div>
          ) : (
            <form onSubmit={handleScan} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={scanTerm}
                  onChange={(e) => setScanTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Click here & Scan with Gun (or type serial)..."
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={scanning || !scanTerm}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {scanning ? 'Searching...' : 'Go'}
              </button>
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 flex items-center gap-2"
                title="Use Webcam"
              >
                <Scan className="w-4 h-4" />
                <span className="hidden sm:inline">Camera</span>
              </button>
            </form>
          )}

          <div className="mt-2 flex flex-col gap-1 text-xs text-gray-500">
            <p className="font-medium text-blue-600">* Finds Cooling Period or Ready stock and auto-fills details (not Reserved / Outward / In Repair).</p>
            <p>💡 <strong>Physical Scanner:</strong> Click the input box above and scan. It will auto-submit.</p>
            <p>📷 <strong>Mobile/Webcam:</strong> Click the "Camera" button to scan visibly.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">TTSPL ID</label>
              <input
                type="text"
                value={formData.ttspl_id}
                onChange={(e) => setFormData({ ...formData, ttspl_id: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="TTSPL-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Serial Number *</label>
              <input
                type="text"
                required
                value={formData.serial_number}
                onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="LAP001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Initial Cost ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.initial_cost}
                onChange={(e) => setFormData({ ...formData, initial_cost: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Brand</label>
              <input
                type="text"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Dell"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Model</label>
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Latitude 5420"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Processor</label>
              <input
                type="text"
                value={formData.processor}
                onChange={(e) => setFormData({ ...formData, processor: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="i5-1135G7"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">RAM</label>
              <input
                type="text"
                value={formData.ram}
                onChange={(e) => setFormData({ ...formData, ram: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="16GB"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Storage</label>
              <input
                type="text"
                value={formData.storage}
                onChange={(e) => setFormData({ ...formData, storage: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="512GB SSD"
              />
            </div>
          </div>

          {canAssign && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-purple-50 rounded-lg border border-purple-100">
              <div className="col-span-2 text-sm font-bold text-purple-800 mb-1">
                Floor Manager Assignment
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign Team</label>
                <select
                  value={formData.assigned_team_id}
                  onChange={(e) => setFormData({ ...formData, assigned_team_id: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">Default (Warehouse)</option>
                  {teams.map(team => (
                    <option key={team.team_id} value={team.team_id}>{team.team_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign Member</label>
                <select
                  value={formData.assigned_user_id}
                  onChange={(e) => setFormData({ ...formData, assigned_user_id: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  disabled={!formData.assigned_team_id}
                >
                  <option value="">Any / Unassigned</option>
                  {teamMembers.map(member => (
                    <option key={member.user_id} value={member.user_id}>{member.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
            <select
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Initial Condition</label>
            <textarea
              value={formData.initial_condition}
              onChange={(e) => setFormData({ ...formData, initial_condition: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              rows="4"
              placeholder="Describe the laptop's condition..."
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => navigate('/tickets')}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div >
  );
}

// Placeholder Components
// function Parts() {
//   return <div className="bg-white rounded-xl shadow-sm border p-6"><h2 className="text-2xl font-bold">Parts Inventory</h2><p className="text-gray-600 mt-2">Coming soon...</p></div>;
// }

// Teams Component
function Teams() {
  const { user } = React.useContext(AuthContext); // Access user from context
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [teamFilter, setTeamFilter] = useState('all');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    mobile_no: '',
    role: 'team_member',
    team_ids: []
  });
  const [permissionModal, setPermissionModal] = useState(null);
  const [mobileEditModal, setMobileEditModal] = useState(null);
  const [teamsEditModal, setTeamsEditModal] = useState(null);
  const canManageUsers = user && ['admin', 'manager'].includes(user.role);
  const PERMISSIONS = [
    { key: 'inventory_read', label: 'Inventory View (see & search)' },
    { key: 'inventory_write', label: 'Inventory Edit (add, upload, CSV)' },
    { key: 'parts_access', label: 'Parts' },
    { key: 'reports_access', label: 'Reports' },
    { key: 'sales_access', label: 'Sales' },
    { key: 'orders_access', label: 'Orders' },
    { key: 'procurement_access', label: 'Procurement (Orders)' },
    { key: 'qc_access', label: 'QC Orders' },
    { key: 'dispatch_access', label: 'Dispatch' },
    { key: 'warehouse_access', label: 'Warehouse' },
    { key: 'customers_access', label: 'Customers (View)' },
    { key: 'customers_edit', label: 'Customers (Edit)' },
    { key: 'support_access', label: 'Support module' },
    { key: 'customer_inventory_access', label: 'Customer Inventory (Support tech)' }
  ];

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [teamsRes, usersRes] = await Promise.all([
        api.get('/teams'),
        api.get('/auth/users')
      ]);
      setTeams(teamsRes.data.teams);
      setUsers(usersRes.data.users);

      if (teamsRes.data.teams.length > 0) {
        setFormData(prev => ({ ...prev, team_ids: [teamsRes.data.teams[0].team_id] }));
      }
    } catch (error) {
      console.error('Load data error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setCreating(true);
    setMessage({ type: '', text: '' });

    try {
      const payload = { ...formData };
      if (['team_member', 'team_lead', 'floor_manager'].includes(formData.role) && formData.team_ids?.length > 0) {
        payload.team_ids = formData.team_ids;
      } else if (['team_member', 'team_lead', 'floor_manager'].includes(formData.role) && formData.team_ids?.length === 0) {
        payload.team_id = teams[0]?.team_id || null;
      }
      await api.post('/auth/register', payload);
      setMessage({ type: 'success', text: 'User created successfully!' });
      setFormData({
        name: '',
        email: '',
        password: '',
        mobile_no: '',
        role: 'team_member',
        team_ids: teams[0] ? [teams[0].team_id] : []
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Failed to create user'
      });
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateMobile = async (userId, mobile_no) => {
    try {
      await api.put(`/auth/users/${userId}/mobile`, { mobile_no: mobile_no || null });
      setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, mobile_no: mobile_no || null } : u));
      setMobileEditModal(null);
    } catch (err) {
      console.error('Update mobile error:', err);
      alert(err.response?.data?.message || 'Failed to update mobile');
    }
  };

  const handleUpdateTeams = async (userId, team_ids) => {
    try {
      await api.put(`/auth/users/${userId}/teams`, { team_ids });
      setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, team_ids } : u));
      setTeamsEditModal(null);
      loadData();
    } catch (err) {
      console.error('Update teams error:', err);
      alert(err.response?.data?.message || 'Failed to update teams');
    }
  };

  const handleGenerateBarcode = async (userId) => {
    const code = 'USR-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    try {
      await api.put(`/auth/users/${userId}/barcode`, { barcode: code });
      // Update local state
      setUsers(users.map(u => u.user_id === userId ? { ...u, barcode: code } : u));
      alert(`Barcode generated: ${code}`);
    } catch (e) {
      alert('Failed to generate barcode');
    }
  };

  const handleDeleteUser = async (targetUser) => {
    if (!targetUser?.user_id) return;
    const confirmed = window.confirm(`Delete user "${targetUser.name}" (${targetUser.email})?`);
    if (!confirmed) return;
    try {
      await api.delete(`/auth/users/${targetUser.user_id}`);
      setUsers((prev) => prev.filter((u) => u.user_id !== targetUser.user_id));
      setMessage({ type: 'success', text: 'User deleted successfully' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Failed to delete user'
      });
    }
  };

  const filteredUsers = users.filter(u => {
    if (teamFilter === 'all') return true;
    const userTeamIds = u.team_ids && u.team_ids.length > 0 ? u.team_ids : (u.team_id ? [u.team_id] : []);
    if (teamFilter === 'unassigned') return userTeamIds.length === 0;
    return userTeamIds.includes(parseInt(teamFilter));
  });

  if (loading) return <div className="text-center py-12">Loading teams...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-blue-100 rounded-full">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">User Management</h2>
            <p className="text-gray-600">Create accounts and control access</p>
          </div>
        </div>

        {message.text && (
          <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
            {message.text}
          </div>
        )}

        {/* Create User Form - Admin/Manager Only */}
        {canManageUsers && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="john@refurb.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Mobile No</label>
                <input
                  type="tel"
                  value={formData.mobile_no}
                  onChange={e => setFormData({ ...formData, mobile_no: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. 9876543210"
                />
                <p className="mt-1 text-xs text-gray-500">For future WhatsApp/SMS integration</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                <input
                  type="password"
                  required
                  minLength="6"
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="••••••••"
                />
              </div>



              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                <select
                  value={formData.role}
                  onChange={e => {
                    const role = e.target.value;
                    const noTeamRequired = ['admin', 'sales', 'qc', 'dispatch', 'procurement', 'warehouse', 'support_lead', 'support_tech'].includes(role);
                    setFormData(prev => ({
                      ...prev,
                      role,
                      team_ids: noTeamRequired ? [] : (prev.team_ids?.length ? prev.team_ids : [teams[0]?.team_id].filter(Boolean))
                    }));
                  }}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="team_member">Team Member</option>
                  <option value="sales">Sales</option>
                  <option value="floor_manager">Floor Manager</option>
                  <option value="procurement">Procurement</option>
                  <option value="warehouse">Warehouse</option>
                  <option value="qc">QC</option>
                  <option value="dispatch">Dispatch</option>
                  <option value="team_lead">Team Lead</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                  <option value="support_lead">Support Team Lead</option>
                  <option value="support_tech">Support Technician</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign to Team(s) – select multiple for QC1+QC2, etc.</label>
                {['admin', 'sales', 'qc', 'dispatch', 'procurement', 'warehouse', 'support_lead', 'support_tech'].includes(formData.role) ? (
                  <p className="text-sm text-gray-500 py-2">No team required (standalone role)</p>
                ) : (
                  <div className="border border-gray-300 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                    {teams.map(team => (
                      <label key={team.team_id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={(formData.team_ids || []).includes(team.team_id)}
                          onChange={e => {
                            const ids = formData.team_ids || [];
                            const newIds = e.target.checked
                              ? [...ids, team.team_id]
                              : ids.filter(id => id !== team.team_id);
                            setFormData(prev => ({ ...prev, team_ids: newIds }));
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm">{team.team_name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200 flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {creating ? 'Creating...' : 'Create User Account'}
                {!creating && <ArrowRight className="w-5 h-5" />}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Team Members List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <h3 className="text-lg font-bold">Team Members</h3>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Team Filter</label>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Teams</option>
              <option value="unassigned">Unassigned</option>
              {teams.map(team => (
                <option key={team.team_id} value={team.team_id}>
                  {team.team_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b bg-gray-50 text-sm">
                <th className="p-3">Name</th>
                <th className="p-3">Role</th>
                <th className="p-3">Team</th>
                <th className="p-3">Mobile</th>
                <th className="p-3">Barcode</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredUsers.map(u => (
                <tr key={u.user_id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium">{u.name}<div className="text-xs text-gray-500">{u.email}</div></td>
                  <td className="p-3"><span className="px-2 py-1 bg-gray-100 rounded text-xs">{u.role}</span></td>
                  <td className="p-3">
                    {(() => {
                      const ids = u.team_ids && u.team_ids.length > 0 ? u.team_ids : (u.team_id ? [u.team_id] : []);
                      const names = ids.map(tid => teams.find(t => t.team_id === tid)?.team_name).filter(Boolean);
                      return names.length > 0 ? names.join(', ') : (u.team_name || '-');
                    })()}
                    {canManageUsers && ['team_member', 'team_lead', 'floor_manager'].includes(u.role) && (
                      <button
                        onClick={() => setTeamsEditModal({ userId: u.user_id, name: u.name, team_ids: u.team_ids || (u.team_id ? [u.team_id] : []) })}
                        className="ml-2 text-xs text-blue-600 hover:text-blue-800"
                        title="Edit teams"
                      >
                        <Pencil className="w-3.5 h-3.5 inline" />
                      </button>
                    )}
                  </td>
                  <td className="p-3">
                    <span>{u.mobile_no || '-'}</span>
                    {canManageUsers && (
                      <button
                        onClick={() => setMobileEditModal({ userId: u.user_id, name: u.name, mobile_no: u.mobile_no || '' })}
                        className="ml-2 text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                        title="Edit mobile"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                  <td className="p-3">
                    {u.barcode ? <Barcode value={u.barcode} height={30} width={1} fontSize={12} displayValue={true} /> : <span className="text-gray-400">Not set</span>}
                  </td>
                  <td className="p-3 text-right flex gap-2 justify-end">
                    {canManageUsers && (
                      <>
                        <button
                          onClick={() => setPermissionModal({ userId: u.user_id, name: u.name, permissions: u.permissions || [] })}
                          className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded hover:bg-slate-200"
                        >
                          Access
                        </button>
                        <button
                          onClick={() => handleGenerateBarcode(u.user_id)}
                          className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100"
                        >
                          {u.barcode ? 'Regenerate' : 'Generate'}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Edit Modal */}
      {mobileEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-1">Edit Mobile</h3>
            <p className="text-sm text-gray-500 mb-4">Update mobile for {mobileEditModal.name}</p>
            <input
              type="tel"
              value={mobileEditModal.mobile_no}
              onChange={e => setMobileEditModal(prev => ({ ...prev, mobile_no: e.target.value }))}
              placeholder="e.g. 9876543210"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setMobileEditModal(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUpdateMobile(mobileEditModal.userId, mobileEditModal.mobile_no)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Teams Edit Modal */}
      {teamsEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-1">Edit Team Access</h3>
            <p className="text-sm text-gray-500 mb-4">Select teams for {teamsEditModal.name}. User will see tickets in all selected stages.</p>
            <div className="max-h-60 overflow-y-auto space-y-2 mb-6">
              {teams.map(team => (
                <label key={team.team_id} className="flex items-center gap-3 p-2 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={(teamsEditModal.team_ids || []).includes(team.team_id)}
                    onChange={(e) => {
                      const ids = teamsEditModal.team_ids || [];
                      const newIds = e.target.checked ? [...ids, team.team_id] : ids.filter(id => id !== team.team_id);
                      setTeamsEditModal(prev => ({ ...prev, team_ids: newIds }));
                    }}
                    className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="text-sm font-medium">{team.team_name}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setTeamsEditModal(null)} className="flex-1 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={() => handleUpdateTeams(teamsEditModal.userId, teamsEditModal.team_ids || [])}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permission Modal */}
      {permissionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-1">Access Control</h3>
            <p className="text-sm text-gray-500 mb-4">Enable modules for {permissionModal.name}</p>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {PERMISSIONS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={permissionModal.permissions.includes(key)}
                    onChange={(e) => {
                      const newPerms = e.target.checked
                        ? [...permissionModal.permissions, key]
                        : permissionModal.permissions.filter(p => p !== key);
                      setPermissionModal(prev => ({ ...prev, permissions: newPerms }));
                    }}
                    className="h-5 w-5 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPermissionModal(null)}
                className="flex-1 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await api.put(`/auth/users/${permissionModal.userId}/permissions`, { permissions: permissionModal.permissions });
                    alert('Permissions updated');
                    setPermissionModal(null);
                    loadData(); // Reload users
                  } catch (e) {
                    alert('Failed to update permissions');
                  }
                }}
                className="flex-1 py-2 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-bold mb-4">Teams Directory</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map(team => (
            <div key={team.team_id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
              <div className="font-semibold text-slate-900">{team.team_name}</div>
              <div className="text-xs text-gray-500">{team.description || 'No description'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Diagnosis Checklist Component
/*
// function DiagnosisChecklist({ active, initialData, onSave }) {
//   const [data, setData] = useState(initialData || {
screen_condition: 'Good',
  battery_health: 100,
    storage_health: 'Good',
      ram_verified: false,
        issues_found: ''
  });

const handleChange = (field, value) => {
  setData(prev => ({ ...prev, [field]: value }));
};

const handleSubmit = (e) => {
  e.preventDefault();
  onSave(data);
};

if (!active) return null;

return (
  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
    <h3 className="text-lg font-bold mb-4">Diagnosis Checklist</h3>
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Screen Condition</label>
          <select
            value={data.screen_condition}
            onChange={(e) => handleChange('screen_condition', e.target.value)}
            className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="Good">Good</option>
            <option value="Scratched">Scratched</option>
            <option value="Broken">Broken</option>
            <option value="Dead Pixels">Dead Pixels</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Battery Health (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            value={data.battery_health}
            onChange={(e) => handleChange('battery_health', parseInt(e.target.value))}
            className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Storage Health</label>
          <select
            value={data.storage_health}
            onChange={(e) => handleChange('storage_health', e.target.value)}
            className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="Good">Good</option>
            <option value="Warning">Warning</option>
            <option value="Bad">Bad</option>
          </select>
        </div>
        <div className="flex items-center space-x-2 pt-6">
          <input
            type="checkbox"
            id="ram_verified"
            checked={data.ram_verified}
            onChange={(e) => handleChange('ram_verified', e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="ram_verified" className="text-sm font-medium text-gray-700">RAM Configuration Verified</label>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Issues Found</label>
        <textarea
          value={data.issues_found}
          onChange={(e) => handleChange('issues_found', e.target.value)}
          rows="3"
          className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          placeholder="Describe any hardware issues..."
        ></textarea>
      </div>
      <button
        type="submit"
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 font-medium"
      >
        Save & Continue
      </button>
    </form>
  </div>
);
}

*/
// Cost Components
function CostSummary({ ticket }) {
  if (!ticket) return null;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
        <BarChart3 className="w-5 h-5" /> Cost Breakdown
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-500">Initial Cost</div>
          <div className="text-xl font-bold">${parseFloat(ticket.initial_cost).toFixed(2)}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-500">Parts Total</div>
          <div className="text-xl font-bold">${parseFloat(ticket.parts_total).toFixed(2)}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-500">Services</div>
          <div className="text-xl font-bold">${parseFloat(ticket.services_total).toFixed(2)}</div>
        </div>
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
          <div className="text-sm text-blue-600 font-bold">Grand Total</div>
          <div className="text-2xl font-bold text-blue-700">${parseFloat(ticket.grand_total).toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

/*
// function PartRequestForm({ ticketId, onAdded }) {
//   const [partName, setPartName] = useState('');
const [description, setDescription] = useState('');
const [loading, setLoading] = useState(false);

const handleSubmit = async (e) => {
  e.preventDefault();
  setLoading(true);
  try {
    await api.post(`/tickets/${ticketId}/part-request`, { part_name: partName, description });
    setPartName('');
    setDescription('');
    onAdded();
    alert('Part requested successfully');
  } catch (error) {
    alert('Failed to request part');
  } finally {
    setLoading(false);
  }
};

return (
  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
    <h3 className="text-lg font-bold mb-4">Request Parts</h3>
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        value={partName}
        onChange={(e) => setPartName(e.target.value)}
        placeholder="Part Name (e.g. 16GB RAM)"
        className="w-full border rounded-lg p-2"
        required
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description / Specs"
        className="w-full border rounded-lg p-2"
      />
      <button disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded-lg w-full">
        {loading ? 'Requesting...' : 'Submit Request'}
      </button>
    </form>
  </div>
);
}

*/
function PartFulfillment({ ticketId, requests, onFulfilled }) {
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [partId, setPartId] = useState(''); // Would ideally be a dropdown
  const [loading, setLoading] = useState(false);

  const handleFulfill = async (reqId) => {
    if (!partId) return alert('Please enter Part ID from inventory');
    setLoading(true);
    try {
      await api.post(`/tickets/${ticketId}/fulfill-part`, {
        request_id: reqId,
        part_id: parseInt(partId),
        quantity: 1,
        notes: 'Fulfilled via Procurement'
      });
      onFulfilled();
      alert('Part fulfilled');
      setSelectedRequest(null);
      setPartId('');
    } catch (error) {
      alert('Failed to fulfill part');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
      <h3 className="text-lg font-bold mb-4">Pending Part Requests</h3>
      <div className="space-y-4">
        {requests.filter(r => r.status === 'pending').length === 0 && <p className="text-gray-500">No pending requests.</p>}
        {requests.filter(r => r.status === 'pending').map(req => (
          <div key={req.request_id} className="border p-4 rounded-lg flex justify-between items-center">
            <div>
              <div className="font-bold">{req.part_name}</div>
              <div className="text-sm text-gray-600">{req.description}</div>
              <div className="text-xs text-gray-500">Requested by: {req.requested_by_name}</div>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Part ID to Assign"
                className="border p-1 rounded w-32"
                value={selectedRequest === req.request_id ? partId : ''}
                onChange={(e) => {
                  setSelectedRequest(req.request_id);
                  setPartId(e.target.value);
                }}
              />
              <button
                onClick={() => handleFulfill(req.request_id)}
                disabled={loading || selectedRequest !== req.request_id}
                className="bg-green-600 text-white px-3 py-1 rounded text-sm"
              >
                Fulfill
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinalTestingPanel({ ticketId, ticketParts, onUpdated, onSubmitNext, processing }) {
  const [parts, setParts] = useState([]);
  const [partId, setPartId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [verification, setVerification] = useState({
    diagnosis_verified: false,
    software_verified: false,
    hardware_verified: false
  });
  const [finalNotes, setFinalNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadParts = async () => {
      try {
        const { data } = await api.get('/parts');
        setParts(data.parts || []);
      } catch (e) {
        console.error('Load parts error:', e);
      }
    };
    loadParts();
  }, []);

  const handleAddPart = async (e) => {
    e.preventDefault();
    if (!partId) return alert('Select a part');
    if (!quantity || quantity < 1) return alert('Quantity must be at least 1');

    setLoading(true);
    try {
      await api.post(`/tickets/${ticketId}/parts`, {
        part_id: parseInt(partId),
        quantity_used: parseInt(quantity),
        notes: notes || 'Added during Final Testing'
      });
      setPartId('');
      setQuantity(1);
      setNotes('');
      onUpdated();
    } catch (e) {
      alert(e.response?.data?.message || 'Failed to attach part');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitFinal = () => {
    if (!verification.diagnosis_verified || !verification.software_verified || !verification.hardware_verified) {
      return alert('Please verify Diagnosis, Software, and Hardware checks before submitting.');
    }
    if (!finalNotes.trim()) {
      return alert('Please add final testing notes.');
    }
    onSubmitNext(
      {
        diagnosis_verified: true,
        software_verified: true,
        hardware_verified: true
      },
      null,
      `Final Testing Completed: ${finalNotes}`
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-bold mb-4">Final Testing - Attach Parts</h3>
      <p className="text-sm text-gray-600 mb-4">
        If a defect is found during Final Testing, select the required part and attach it to the ticket.
      </p>

      <form onSubmit={handleAddPart} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">Part</label>
          <select
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-3 focus:ring-2 focus:ring-orange-500"
          >
            <option value="">Select part</option>
            {parts.map(p => (
              <option key={p.part_id} value={p.part_id}>
                {p.part_name} (Qty: {p.quantity})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Qty</label>
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-3 focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 text-white py-3 rounded-lg font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? 'Attaching...' : 'Attach Part'}
          </button>
        </div>
        <div className="md:col-span-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-3 focus:ring-2 focus:ring-orange-500"
            placeholder="Describe the issue and fix..."
          />
        </div>
      </form>

      {ticketParts?.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Parts Attached to Ticket</h4>
          <div className="space-y-2">
            {ticketParts.map(part => (
              <div key={part.id || `${part.part_id}-${part.added_at}`} className="flex items-center justify-between text-sm">
                <div className="text-gray-700">{part.part_name}</div>
                <div className="text-gray-500">Qty: {part.quantity_used}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 border-t pt-6">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Final Testing Verification</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {[
            { key: 'diagnosis_verified', label: 'Diagnosis Verified' },
            { key: 'software_verified', label: 'Software Verified' },
            { key: 'hardware_verified', label: 'Hardware Verified' }
          ].map(item => (
            <label key={item.key} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={verification[item.key]}
                onChange={(e) => setVerification(prev => ({ ...prev, [item.key]: e.target.checked }))}
                className="h-5 w-5 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
              />
              <span className="text-sm font-medium text-gray-700">{item.label}</span>
            </label>
          ))}
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Final Testing Notes</label>
          <textarea
            value={finalNotes}
            onChange={(e) => setFinalNotes(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-orange-500"
            rows="3"
            placeholder="Describe final verification, issues resolved, and readiness..."
          />
        </div>
        <button
          onClick={handleSubmitFinal}
          disabled={processing}
          className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50"
        >
          {processing ? 'Processing...' : 'Submit Final Testing & Move Next'}
        </button>
      </div>
    </div>
  );
}

// Work Timer Component
function WorkTimer({ ticketId, serialNumber, machineNumber, assignedUserId, onStatusChange }) {
  const { user } = useContext(AuthContext);
  const [activeLog, setActiveLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showScanner, setShowScanner] = useState(false);

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [note, setNote] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [manualCode, setManualCode] = useState('');

  const checkStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/tickets/${ticketId}/work/active`);
      if (data.active) {
        setActiveLog(data.log);
        onStatusChange('active');
      } else {
        setActiveLog(null);
        onStatusChange('idle');
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [ticketId, onStatusChange]);

  // Check status on mount
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Timer interval
  useEffect(() => {
    let interval;
    if (activeLog && !activeLog.end_time) {
      let startTime;
      if (activeLog.start_time_epoch) {
        // Use server-provided epoch (ms) for absolute accuracy
        startTime = parseFloat(activeLog.start_time_epoch);
      } else {
        // Fallback: Fix Timezone manually
        const timeStr = activeLog.start_time;
        startTime = new Date(timeStr.endsWith('Z') ? timeStr : timeStr + 'Z').getTime();
      }

      interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } else {
      setElapsed(0);
    }
    return () => clearInterval(interval);
  }, [activeLog]);

  const handleScan = async (decodedText) => {
    setShowScanner(false);

    // Determine mode based on activeLog status
    // If we have an active log, we are ENDING work.
    // If not, we are STARTING work.
    const isEnding = !!activeLog;

    if (!isEnding) {
      // START WORK LOGIC
      // Validate barcode: Prefer Machine Number, fallback to Serial
      const expected = machineNumber || serialNumber;
      if (decodedText !== expected) {
        alert(`Barcode Mismatch! Scanned: ${decodedText}. Expected: ${expected}`);
        return;
      }

      try {
        await api.post(`/tickets/${ticketId}/work/start`);
        alert('Work Started! Timer detected.');
        checkStatus();
        setManualCode('');
      } catch (e) {
        alert(e.response?.data?.message || 'Failed to start work');
      }
    } else {
      // END WORK LOGIC
      // Validate barcode: Prefer Machine Number, fallback to Serial
      const expected = machineNumber || serialNumber;
      if (decodedText !== expected) {
        alert(`Barcode Mismatch! Scanned: ${decodedText}. Expected: ${expected}`);
        return;
      }
      // Open Note Modal
      setShowNoteModal(true);
      setManualCode('');
    }
  };

  const submitEndWork = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post(`/tickets/${ticketId}/work/end`, { notes: note });
      alert('Work Ended. ' + (data.ready_for_next_stage ? 'Moving to next stage...' : ''));
      setActiveLog(null);
      setShowNoteModal(false);
      setNote('');
      onStatusChange('completed', data.ready_for_next_stage); // Trigger move next if ready
    } catch (e) {
      alert(e.response?.data?.message || 'Failed to end work');
    }
  };

  const formatTime = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Only show for assigned user or manager overrides
  // Note: user.user_id is int, assignedUserId might be string/int. Compare loosely.
  // Requirement: "Team member of any team can move ticket"
  // So we allow any logged in user to see the timer if they are on the page.
  // Ideally, maybe restriction to team? But user said "Team member of ANY team".
  if (!user) return null;

  if (loading) return <div className="text-sm">Loading timer...</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-orange-200 p-4 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Clock className="w-5 h-5 text-orange-600" />
          Work Timer
        </h3>
        <div className="font-mono text-xl font-bold text-orange-600">
          {activeLog ? formatTime(elapsed) : '00:00:00'}
        </div>
      </div>

      {!activeLog ? (
        // Start Work UI
        <div>
          <p className="text-sm text-gray-600 mb-3">Scan machine ({machineNumber || serialNumber}) to START working.</p>
          {showScanner ? (
            <div className="border rounded p-2">
              <div className="flex justify-between mb-2">
                <span className="font-bold text-xs">Scanning...</span>
                <button onClick={() => setShowScanner(false)}><X className="w-4 h-4" /></button>
              </div>
              <BarcodeScanner onScanSuccess={handleScan} />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Manual / Physical Scanner Input */}
              <form onSubmit={(e) => { e.preventDefault(); handleScan(manualCode); }} className="flex gap-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Click here & Scan with Gun"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  autoFocus
                />
                <button type="submit" disabled={!manualCode} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-bold">Go</button>
              </form>

              <button
                onClick={() => { setShowScanner(true); }}
                className="w-full bg-blue-100 text-blue-800 py-3 rounded-lg font-bold hover:bg-blue-200 flex justify-center items-center gap-2 border border-blue-200"
              >
                <Scan className="w-5 h-5" /> Or Use Camera
              </button>
            </div >
          )}
        </div >
      ) : (
        // End Work UI
        <div>
          <p className="text-sm text-green-600 mb-3 font-medium">Work in progress...</p>
          {showScanner ? (
            <div className="border rounded p-2">
              <div className="flex justify-between mb-2">
                <span className="font-bold text-xs">Scan to END...</span>
                <button onClick={() => setShowScanner(false)}><X className="w-4 h-4" /></button>
              </div>
              <BarcodeScanner onScanSuccess={handleScan} />
            </div>
          ) : (

            <div className="space-y-3">
              {/* Manual / Physical Scanner Input */}
              <form onSubmit={(e) => { e.preventDefault(); handleScan(manualCode); }} className="flex gap-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Click here & Scan to END"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  autoFocus
                />
                <button type="submit" disabled={!manualCode} className="bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-bold">End</button>
              </form>

              <button
                onClick={() => { setShowScanner(true); }}
                className="w-full bg-red-100 text-red-800 py-3 rounded-lg font-bold hover:bg-red-200 flex justify-center items-center gap-2 border border-red-200"
              >
                <Scan className="w-5 h-5" /> Or Use Camera
              </button>
            </div>
          )}
        </div>
      )
      }

      {/* End Work Note Modal */}
      {
        showNoteModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md">
              <h3 className="text-xl font-bold mb-4">Work Completion Note</h3>
              <form onSubmit={submitEndWork}>
                <label className="block text-sm font-medium text-gray-700 mb-2">What did you do? (Mandatory)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full border rounded-lg p-3 mb-4 focus:ring-2 focus:ring-blue-500"
                  rows="3"
                  required
                  placeholder="Replaced thermal paste, cleaned fan..."
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowNoteModal(false)}
                    className="flex-1 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700"
                  >
                    Submit & Finish
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
      }
    </div >
  );
}

// Ticket Details Component
function TicketDetails() {
  const { id } = useParams();
  const { user } = useContext(AuthContext); // Access user from context
  const [ticket, setTicket] = useState(null);
  const [activities, setActivities] = useState([]);
  const [partRequests, setPartRequests] = useState([]);
  const [ticketParts, setTicketParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [note, setNote] = useState('');
  const [stages, setStages] = useState([]); // State for stages
  const [workStatus, setWorkStatus] = useState('idle'); // idle, active, completed
  const [users, setUsers] = useState([]);

  const handleWorkStatusChange = (status, shouldMove = false) => {
    setWorkStatus(status);
    if (status === 'completed') {
      if (shouldMove) {
        handleNextStage(); // Auto-move
      } else {
        loadTicketDetails();
      }
    }
  };

  const loadStages = useCallback(async () => {
    try {
      const { data } = await api.get('/tickets/stages');
      setStages(data.stages);
    } catch (error) {
      console.error("Failed to load stages", error);
    }
  }, []);

  const loadTicketDetails = useCallback(async () => {
    try {
      const { data } = await api.get(`/tickets/${id}`);
      setTicket(data.ticket);
      setActivities(data.activities);
      setPartRequests(data.part_requests || []);
      setTicketParts(data.parts || []);
    } catch (error) {
      console.error('Load ticket error:', error);
      alert('Failed to load ticket details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadUsers = useCallback(async () => {
    if (['floor_manager', 'admin', 'manager'].includes(user?.role)) {
      try {
        const { data } = await api.get('/auth/users');
        setUsers(data.users || []);
      } catch (e) { console.error(e); }
    }
  }, [user?.role]);

  const handleAssign = async (userId) => {
    if (!userId) return;
    try {
      await api.post(`/tickets/${id}/assign`, { user_id: userId });
      alert('Assigned successfully');
      loadTicketDetails();
    } catch (e) {
      alert(e.response?.data?.message || 'Failed to assign');
    }
  };

  useEffect(() => {
    loadTicketDetails();
    loadStages(); // Fetch stages on mount
    loadUsers();
  }, [loadTicketDetails, loadStages, loadUsers]);

  const handleNextStage = async (checklistData = null, targetStageId = null, notes = null) => {
    const action = targetStageId ? 'jump to the selected' : 'move this ticket to the next';
    if (!window.confirm(`Are you sure you want to ${action} stage?`)) return;

    setProcessing(true);
    try {
      await api.post(`/tickets/${id}/next-stage`, {
        checklist_data: checklistData,
        target_stage_id: targetStageId,
        notes: notes
      });
      await loadTicketDetails(); // Reload to get new stage
      alert(`Ticket ${targetStageId ? 'jumped' : 'moved'} successfully`);
    } catch (error) {
      console.error('Next stage error:', error);
      alert('Failed to change stage');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;

    setProcessing(true);
    try {
      await api.post(`/tickets/${id}/notes`, { notes: note });
      setNote('');
      await loadTicketDetails(); // Reload to get new activity
    } catch (error) {
      alert('Failed to add note');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <div className="text-center py-12">Loading ticket details...</div>;
  if (!ticket) return <div className="text-center py-12">Ticket not found</div>;

  return (
    <div className="space-y-4">
      {ticket && <WorkTimer ticketId={ticket.ticket_id} serialNumber={ticket.serial_number} machineNumber={ticket.machine_number} assignedUserId={ticket.assigned_user_id} onStatusChange={handleWorkStatusChange} />}
      <CostSummary ticket={ticket} />
      {/* Header - compact */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            {ticket.ttspl_id && <div className="text-xs font-medium text-gray-500 mb-0.5">TTSPL ID: {ticket.ttspl_id}</div>}
            {ticket.machine_number && <div className="text-xs font-medium text-gray-500 mb-0.5">Machine No: {ticket.machine_number}</div>}
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-medium text-gray-500">Ticket #{ticket.ticket_id}</span>
            </div>
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-xl font-bold">{ticket.serial_number}</h1>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                {ticket.status}
              </span>
            </div>
            <p className="text-sm text-gray-600">{ticket.brand} {ticket.model} • Created {new Date(ticket.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
          </div>
          <div className="flex flex-col items-end gap-3">
            {/* Floor Manager / Admin / Manager Jump Controls */}
            {user && (['admin', 'floor_manager', 'manager'].includes(user.role)) && (
              <div className="flex items-center gap-2 bg-purple-50 p-2 rounded-lg border border-purple-100">
                <select
                  className="text-sm border-gray-300 rounded-md shadow-sm focus:border-purple-500 focus:ring-purple-500"
                  id="stage-jump-select"
                >
                  <option value="">Select Stage to Jump...</option>
                  {stages.map(stage => (
                    <option key={stage.stage_id} value={stage.stage_id}>
                      {stage.stage_order}. {stage.stage_name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const select = document.getElementById('stage-jump-select');
                    if (select.value) handleNextStage(null, select.value);
                  }}
                  disabled={processing || ticket.status === 'completed'}
                  className="bg-purple-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-purple-700 disabled:opacity-50"
                >
                  Jump
                </button>
              </div>
            )}

            {/* Standard Next Stage Button - Hidden for Team Members (Scan Only) */}
            {((ticket.stage_name !== 'Diagnosis' && ticket.stage_name !== 'Assembly & Software' && ticket.stage_name !== 'Chip Level Repair') || (user && user.role === 'admin')) && user && !['team_member'].includes(user.role) && (
              <button
                onClick={() => handleNextStage()}
                disabled={processing || ticket.status === 'completed' || workStatus === 'active'}
                className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {processing ? 'Processing...' : (workStatus === 'active' ? 'Finish Work First' : 'Move to Next Stage')}
                <ArrowRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          {(() => {
            const totalStages = stages.length || 13;
            return (
              <>
                <div className="flex items-center justify-between text-xs font-medium text-gray-600 mb-1">
                  <span>Stage: {ticket.stage_name}</span>
                  <span>Step {ticket.stage_order} of {totalStages}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${(ticket.stage_order / totalStages) * 100}%` }}
                  ></div>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-bold mb-3">Ticket Information</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 text-sm">
              {ticket.machine_number && (
                <div>
                  <dt className="text-xs font-medium text-gray-500">Machine No</dt>
                  <dd className="mt-0.5 text-gray-900 text-sm font-mono">{ticket.machine_number}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium text-gray-500">Brand</dt>
                <dd className="mt-0.5 text-gray-900 text-sm">{ticket.brand}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Model</dt>
                <dd className="mt-0.5 text-gray-900 text-sm">{ticket.model}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Priority</dt>
                <dd className="mt-0.5 text-gray-900 text-sm capitalize">{ticket.priority}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Processor</dt>
                <dd className="mt-0.5 text-gray-900 text-sm">{ticket.processor || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">RAM</dt>
                <dd className="mt-0.5 text-gray-900 text-sm">{ticket.ram || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Storage</dt>
                <dd className="mt-0.5 text-gray-900 text-sm">{ticket.storage || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Current Assignee</dt>
                {['floor_manager', 'admin', 'manager'].includes(user?.role) ? (
                  <select
                    value={ticket.assigned_user_id || ''}
                    onChange={(e) => handleAssign(e.target.value)}
                    className="mt-0.5 text-sm border border-gray-300 rounded px-2 py-1 w-full max-w-xs"
                  >
                    <option value="">-- Assign User --</option>
                    {users
                      .filter(u => ['team_member', 'floor_manager'].includes(u.role))
                      .filter(u => {
                        if (!ticket.assigned_team_id) return false;
                        const userTeamIds = u.team_ids?.length ? u.team_ids : (u.team_id != null ? [u.team_id] : []);
                        return userTeamIds.some(tid => tid == ticket.assigned_team_id);
                      })
                      .map(u => (
                        <option key={u.user_id} value={u.user_id}>
                          {u.name} ({u.team_name})
                        </option>
                      ))}
                  </select>
                ) : (
                  <span className="mt-0.5 block text-gray-900 text-sm">{ticket.assigned_user_name || ticket.team_name}</span>
                )}
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-gray-500">Initial Condition</dt>
                <dd className="mt-0.5 text-gray-900 text-sm">{ticket.initial_condition}</dd>
              </div>
            </dl>
          </div>


          {/* Diagnosis Form (Visible in Diagnosis, Assembly, Procurement, Dismantle, Chip Level Repair) */}
          {/* For Diagnosis stage: Only clickable after team member scans machine to START work */}
          {(['Diagnosis', 'Assembly & Software', 'Repair', 'Procurement', 'Dismantle', 'Chip Level Repair', 'Final Testing'].includes(ticket.stage_name)) && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              {ticket.stage_name === 'Diagnosis' && user?.role === 'team_member' && workStatus !== 'active' ? (
                <div className="text-center py-8 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-amber-800 font-medium">Scan machine ({ticket.machine_number || ticket.ttspl_id || ticket.serial_number}) to START working.</p>
                  <p className="text-sm text-amber-700 mt-1">Laptop Diagnosis will become available after you start work.</p>
                </div>
              ) : (
                <DiagnosisForm
                  api={api}
                  ticket={ticket}
                  onComplete={loadTicketDetails}
                  readOnly={ticket.stage_name !== 'Diagnosis'}
                />
              )}
            </div>
          )}

          {/* QC1 / QC2 Checklist */}
          {(ticket.stage_name === 'QC1' || ticket.stage_name === 'QC2') && (
            <QC1Form
              ticket={ticket}
              qcStage={ticket.stage_name}
              onComplete={loadTicketDetails}
            />
          )}

          {/* Assembly & Software Checklist */}
          {ticket.stage_name === 'Assembly & Software' && (['admin'].includes(user?.role) || user?.team_id === ticket.assigned_team_id) && (
            <SoftwareChecklist
              onSubmit={(checks, notes) => handleNextStage(checks, null, notes)}
              processing={processing}
            />
          )}

          {/* Chip Level Repair (L3) */}
          {ticket.stage_name === 'Chip Level Repair' && (
            <ChipLevelRepairPanel
              ticketId={id}
              partRequests={partRequests}
              ticketParts={ticketParts}
              onUpdated={loadTicketDetails}
              processing={processing}
            />
          )}

          {/* Procurement (Fulfill Requests) */}
          {(ticket.stage_name === 'Procurement' || (user?.team_name || '').toLowerCase().includes('procurement')) && partRequests.length > 0 && (
            <PartFulfillment
              ticketId={id}
              requests={partRequests}
              onFulfilled={loadTicketDetails}
            />
          )}

          {/* Final Testing - Parts Attachment */}
          {ticket.stage_name === 'Final Testing' && (
            <FinalTestingPanel
              ticketId={id}
              ticketParts={ticketParts}
              onUpdated={loadTicketDetails}
              onSubmitNext={handleNextStage}
              processing={processing}
            />
          )}

          {/* Activity Timeline - Admin/Manager/Final Testing Team */}
          {user && (user.role === 'admin' || user.role === 'manager' || user.team_id === ticket.assigned_team_id || ticket.stage_name === 'Final Testing') && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold mb-4">Activity Timeline</h3>
              <div className="space-y-6">
                {activities.map((activity) => (
                  <div key={activity.activity_id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                        <Clock className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="w-0.5 flex-1 bg-gray-100 my-1"></div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4 flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-gray-900">{activity.user_name}</span>
                        <span className="text-xs text-gray-500">{new Date(activity.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                      </div>
                      {(() => {
                        // Parse notes to extract checklist items
                        const notes = activity.notes || '';
                        const checklistMatch = notes.match(/\| Checklist: (.+?)(?:\||$)/);
                        const mainNote = checklistMatch ? notes.split('| Checklist:')[0].trim() : notes;
                        const checklistItems = checklistMatch ? checklistMatch[1].split(',').map(item => item.trim()) : [];

                        return (
                          <>
                            <p className="text-sm text-gray-600 mb-1">{mainNote}</p>
                            {checklistItems.length > 0 && (
                              <div className="mt-2 bg-blue-50 rounded-md p-3 border border-blue-100">
                                <div className="text-xs font-semibold text-blue-800 mb-1">Tasks Completed:</div>
                                <ul className="text-sm text-blue-900 space-y-1">
                                  {checklistItems.map((item, idx) => (
                                    <li key={idx} className="flex items-start gap-2">
                                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      <span className="text-xs font-medium px-2 py-0.5 bg-gray-200 rounded text-gray-600 capitalize">
                        {activity.action.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-bold mb-4">Quick Actions</h3>
            <form onSubmit={handleAddNote}>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-3"
                rows="3"
                placeholder="Add a note..."
              ></textarea>
              <button
                type="submit"
                disabled={processing || !note.trim()}
                className="w-full bg-gray-900 text-white py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
              >
                Add Note
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// Protected Route - allows access by role OR by permission
function ProtectedRoute({ children, allowedRoles, allowedPermissions }) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" />;
  const perms = Array.isArray(user?.permissions) ? user.permissions : [];
  const hasRole = !allowedRoles || (user && allowedRoles.includes(user.role));
  const hasPermission = !allowedPermissions || allowedPermissions.some(p => perms.includes(p));
  if (!hasRole && !hasPermission) {
    return <Navigate to="/dashboard" />;
  }
  if (isSupportTechnician(user)) {
    const customerInvOk = location.pathname.startsWith('/customer-inventory') && canAccessCustomerInventory(user);
    if (!location.pathname.startsWith('/support') && !customerInvOk) {
      return <Navigate to="/support/my-tickets" replace />;
    }
  }
  return children;
}

function SupportProtectedRoute({ children, leadOnly }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (!isSupportUser(user)) return <Navigate to="/dashboard" />;
  if (leadOnly && user.role === 'support_tech') return <Navigate to="/support/my-tickets" replace />;
  return children;
}

// Main App
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/quotation/accept/:token" element={<QuotationAccept />} />
          <Route path="/" element={<Navigate to="/dashboard" />} />
          <Route path="/dashboard" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'floor_manager']} allowedPermissions={['reports_access']}><Layout><Reports api={api} /></Layout></ProtectedRoute>} />
          <Route path="/inventory" element={
            <ProtectedRoute allowedRoles={['manager', 'admin', 'floor_manager']} allowedPermissions={['inventory_read', 'inventory_write', 'inventory_access']}>
              <Layout>
                <div className="p-6">
                  <Inventory api={api} />
                </div>
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/customer-inventory" element={
            <ProtectedRoute allowedRoles={['manager', 'admin', 'floor_manager', 'support_lead', 'support_tech']} allowedPermissions={['customer_inventory_access']}>
              <Layout>
                <div className="p-6">
                  <CustomerInventory api={api} />
                </div>
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/support/*" element={
            <SupportProtectedRoute>
              <SupportApp />
            </SupportProtectedRoute>
          } />
          <Route path="/tickets" element={<ProtectedRoute><Layout><TicketsList /></Layout></ProtectedRoute>} />
          <Route path="/tickets/:id" element={<ProtectedRoute><Layout><TicketDetails /></Layout></ProtectedRoute>} />
          <Route path="/tickets/create" element={
            <ProtectedRoute allowedRoles={['admin', 'manager', 'floor_manager']}>
              <Layout><CreateTicket /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/parts" element={<ProtectedRoute><Layout><PartsInventory /></Layout></ProtectedRoute>} />
          <Route path="/sales" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><Sales api={api} /></Layout></ProtectedRoute>} />
          <Route path="/leads" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><LeadList api={api} /></Layout></ProtectedRoute>} />
          <Route path="/leads/:id" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><LeadDetail api={api} /></Layout></ProtectedRoute>} />
          <Route path="/follow-ups" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><FollowUps api={api} /></Layout></ProtectedRoute>} />
          <Route path="/lead-orders" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><Orders api={api} /></Layout></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><Customers api={api} /></Layout></ProtectedRoute>} />
          <Route path="/manager-dashboard" element={<ProtectedRoute allowedRoles={['admin', 'manager']}><Layout><ManagerDashboard api={api} /></Layout></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'sales']}><Layout><Orders api={api} /></Layout></ProtectedRoute>} />
          <Route path="/procurement" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'procurement']} allowedPermissions={['procurement_access']}><Layout><Procurement api={api} /></Layout></ProtectedRoute>} />
          <Route path="/warehouse" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'warehouse']} allowedPermissions={['warehouse_access']}><Layout><Warehouse api={api} /></Layout></ProtectedRoute>} />
          <Route path="/qc-orders" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'floor_manager', 'qc']} allowedPermissions={['qc_access']}><Layout><QCOrders api={api} /></Layout></ProtectedRoute>} />
          <Route path="/dispatch" element={<ProtectedRoute allowedRoles={['admin', 'manager', 'floor_manager', 'dispatch']} allowedPermissions={['dispatch_access']}><Layout><Dispatch api={api} /></Layout></ProtectedRoute>} />
          <Route path="/teams" element={<ProtectedRoute><Layout><Teams /></Layout></ProtectedRoute>} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
