// Layout Component
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { BarChart3,CheckCircle, Archive, ClipboardList, Briefcase, Clock, Users, Package, Truck, Headphones, Building2, Laptop, X, Menu, LogOut } from 'lucide-react';
import { isSupportUser } from '../utils/supportAccess';
import { Link } from 'react-router-dom';

export default function Layout({ children }) {
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