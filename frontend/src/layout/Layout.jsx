// Layout Component

import { useState, useEffect } from 'react';

import { useAuth } from '../context/AuthContext';

import { useNavigate, Link, NavLink, useLocation } from 'react-router-dom';

import {

  BarChart3,

  CheckCircle,

  Archive,

  ClipboardList,

  Briefcase,

  Clock,

  Users,

  Package,

  Truck,

  Headphones,

  Building2,

  Laptop,

  X,

  Menu,

  LogOut,

  Store,

  ChevronDown

} from 'lucide-react';

import { isSupportUser } from '../utils/supportAccess';
import { useQcStatusCounts } from '../features/qc-management/hooks/useQcStatusCounts';



/** Vendor submenu — paths match VendorManagementApp nested routes */

const vendorAccordionChildren = [

  { label: 'Vendors', path: '/vendor-management/vendors' },

  { label: 'Purchase order', path: '/vendor-management/purchase-orders' },

  { label: 'Spare parts PO', path: '/vendor-management/spare-parts-po' },

  { label: 'Update serial number', path: '/vendor-management/serial-numbers' },

  { label: 'Replaced product', path: '/vendor-management/replaced-products' },

  { type: 'subheader', label: 'Billing' },

  { label: 'Vendor billing', path: '/vendor-management/billing/vendor-overview' },

  { label: 'Monthly pending', path: '/vendor-management/billing/pending' },

  { label: 'Monthly approved', path: '/vendor-management/billing/approved' },

  { label: 'Monthly completed', path: '/vendor-management/billing/completed' }

];

/** QC submenu — paths match QCManagementApp nested routes */

const qcAccordionChildren = [

  { label: 'QC Processing List', path: '/qc-management/processing', countKey: 'pending' },

  { label: 'QC Passed List', path: '/qc-management/passed', countKey: 'passed' },

  { label: 'QC Failed List', path: '/qc-management/failed', countKey: 'failed' },

  { label: 'Dead Assets List', path: '/qc-management/dead-assets', countKey: 'dead' },

  { label: 'Require For Parts', path: '/qc-management/require-for-parts', countKey: 'require_for_parts' },

  { label: 'Bundle Management', path: '/qc-management/bundle' }

];



function canSeeVendorAccordion(user) {

  if (!user) return false;

  const roles = ['manager', 'admin', 'procurement'];

  const permOk = Array.isArray(user.permissions) && user.permissions.includes('vendor_management_access');

  return roles.includes(user.role) || permOk;

}



function canSeeQcAccordion(user) {

  if (!user) return false;

  const roles = ['manager', 'admin', 'floor_manager', 'qc'];

  const permOk = Array.isArray(user.permissions) && user.permissions.includes('qc_access');

  return roles.includes(user.role) || permOk;

}



export default function Layout({ children }) {

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const location = useLocation();

  const { user, logout } = useAuth();

  const navigate = useNavigate();

  const showQcAccordion = canSeeQcAccordion(user);

  const { counts: qcCounts } = useQcStatusCounts(showQcAccordion);



  const [vendorAccordionOpen, setVendorAccordionOpen] = useState(() =>

    location.pathname.startsWith('/vendor-management')

  );

  const [qcAccordionOpen, setQcAccordionOpen] = useState(() =>

    location.pathname.startsWith('/qc-management')

  );



  useEffect(() => {

    if (location.pathname.startsWith('/vendor-management')) {

      setVendorAccordionOpen(true);

    }

    if (location.pathname.startsWith('/qc-management')) {

      setQcAccordionOpen(true);

    }

  }, [location.pathname]);



  const handleLogout = () => {

    logout();

    navigate('/login');

  };



  const menuItems = [

    {

      icon: BarChart3,

      label: 'Dashboard',

      path: '/dashboard',

      roles: ['team_member', 'team_lead', 'manager', 'admin', 'floor_manager', 'sales']

    },

    {

      icon: Archive,

      label: 'Inventory',

      path: '/inventory',

      roles: ['manager', 'admin', 'floor_manager'],

      permission: 'inventory_read',

      permissionAny: ['inventory_read', 'inventory_write', 'inventory_access']

    },

    {

      icon: ClipboardList,

      label: 'Tickets',

      path: '/tickets',

      roles: ['team_member', 'team_lead', 'manager', 'admin', 'floor_manager']

    },

    {

      icon: Briefcase,

      label: 'Leads',

      path: '/leads',

      roles: ['manager', 'admin', 'sales'],

      permission: 'sales_access'

    },

    {

      icon: Briefcase,

      label: 'Sales Orders',

      path: '/sales',

      roles: ['manager', 'admin', 'sales'],

      permission: 'sales_access'

    },

    {

      icon: Clock,

      label: 'Follow-ups',

      path: '/follow-ups',

      roles: ['manager', 'admin', 'sales'],

      permission: 'sales_access'

    },

    {

      icon: ClipboardList,

      label: 'Lead Orders',

      path: '/lead-orders',

      roles: ['manager', 'admin', 'sales'],

      permission: 'orders_access'

    },

    {

      icon: Users,

      label: 'Customers',

      path: '/customers',

      roles: ['manager', 'admin', 'sales'],

      permission: 'sales_access'

    },

    {

      icon: BarChart3,

      label: 'Manager Dashboard',

      path: '/manager-dashboard',

      roles: ['manager', 'admin'],

      permission: 'reports_access'

    },

    {

      icon: BarChart3,

      label: 'Reports',

      path: '/reports',

      roles: ['manager', 'admin', 'floor_manager'],

      permission: 'reports_access'

    },

    {

      icon: Package,

      label: 'Parts',

      path: '/parts',

      roles: ['manager', 'admin', 'floor_manager'],

      permission: 'parts_access'

    },

    {

      icon: Truck,

      label: 'Procurement',

      path: '/procurement',

      roles: ['manager', 'admin', 'procurement'],

      permission: 'procurement_access'

    },

    {

      type: 'vendorAccordion'

    },

    {

      icon: Package,

      label: 'Warehouse',

      path: '/warehouse',

      roles: ['manager', 'admin', 'warehouse'],

      permission: 'warehouse_access'

    },

    {

      type: 'qcAccordion'

    },

    {

      icon: Truck,

      label: 'Dispatch',

      path: '/dispatch',

      roles: ['manager', 'admin', 'floor_manager', 'dispatch'],

      permission: 'dispatch_access'

    },

    { type: 'section', label: 'Support' },

    {

      icon: Headphones,

      label: 'Support tickets',

      path: '/support/tickets',

      roles: ['admin', 'support_lead', 'support_tech']

    },

    {

      icon: Building2,

      label: 'Customer Inventory',

      path: '/customer-inventory',

      roles: ['manager', 'admin', 'floor_manager', 'support_lead', 'support_tech'],

      permissionAny: ['customer_inventory_access']

    },

    { type: 'section', label: 'Team' },

    { icon: Users, label: 'Teams', path: '/teams', roles: ['manager', 'admin'] }

  ];



  function itemAllowed(item) {

    if (item.type === 'section') {

      if (item.label === 'Support') {

        return user && (['manager', 'admin', 'floor_manager', 'support_lead', 'support_tech'].includes(user.role) || isSupportUser(user));

      }

      return user && ['manager', 'admin'].includes(user.role);

    }

    if (item.type === 'vendorAccordion') {

      return canSeeVendorAccordion(user);

    }

    if (item.type === 'qcAccordion') {

      return canSeeQcAccordion(user);

    }

    const permMatch = item.permissionAny

      ? item.permissionAny.some((p) => user?.permissions?.includes(p))

      : item.permission && user?.permissions?.includes(item.permission);

    return (

      !item.roles || (user && (item.roles.includes(user.role) || permMatch))

    );

  }



  return (

    <div className="min-h-screen bg-gray-50">

      {sidebarOpen && (

        <div

          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"

          onClick={() => setSidebarOpen(false)}

        />

      )}



      <aside

        className={`

          fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-gray-200 transform transition-transform duration-200

          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0

        `}

      >

        <div className="p-4 border-b">

          <div className="flex items-center justify-between">

            <div className="flex items-center gap-2">

              <Laptop className="w-8 h-8 text-orange-600" />

              <span className="font-bold text-lg">Rentfoxxy</span>

            </div>

            <button type="button" onClick={() => setSidebarOpen(false)} className="lg:hidden">

              <X className="w-6 h-6" />

            </button>

          </div>

        </div>



        <nav className="p-3 space-y-0.5 overflow-y-auto max-h-[calc(100vh-8rem)]">

          {menuItems.filter(itemAllowed).map((item) => {

            if (item.type === 'section') {

              return (

                <div key={`section-${item.label}`} className="px-3 pt-3 pb-1">

                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{item.label}</span>

                </div>

              );

            }



            if (item.type === 'vendorAccordion') {

              return (

                <div key="vendor-accordion" className="space-y-0.5">

                  <button

                    type="button"

                    onClick={() => setVendorAccordionOpen((o) => !o)}

                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${location.pathname.startsWith('/vendor-management') ? 'text-orange-700 bg-orange-50/60' : 'text-gray-800'

                      }`}

                  >

                    <Store className="w-5 h-5 text-gray-600 shrink-0" />

                    <span className="flex-1">Vendor Management</span>

                    <ChevronDown

                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${vendorAccordionOpen ? 'rotate-180' : ''

                        }`}

                    />

                  </button>

                  {vendorAccordionOpen && (

                    <div className="mt-1 ml-2 pl-3 border-l border-orange-100 space-y-0.5">

                      {vendorAccordionChildren.map((child) => {

                        if (child.type === 'subheader') {

                          return (

                            <p key={`sub-${child.label}`} className="px-2 pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">

                              {child.label}

                            </p>

                          );

                        }

                        return (

                          <NavLink

                            key={child.path}

                            to={child.path}

                            end={child.end ?? false}

                            onClick={() => setSidebarOpen(false)}

                            className={({ isActive }) =>

                              [

                                'block px-2 py-1.5 rounded-md text-xs transition-colors',

                                isActive

                                  ? 'bg-orange-100 text-orange-900 font-semibold'

                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'

                              ].join(' ')

                            }

                          >

                            {child.label}

                          </NavLink>

                        );

                      })}

                    </div>

                  )}

                </div>

              );

            }



            if (item.type === 'qcAccordion') {

              return (

                <div key="qc-accordion" className="space-y-0.5">

                  <button

                    type="button"

                    onClick={() => setQcAccordionOpen((o) => !o)}

                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${location.pathname.startsWith('/qc-management') ? 'text-teal-700 bg-teal-50/60' : 'text-gray-800'

                      }`}

                  >

                    <CheckCircle className="w-5 h-5 text-gray-600 shrink-0" />

                    <span className="flex-1">QC Management</span>

                    <ChevronDown

                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${qcAccordionOpen ? 'rotate-180' : ''

                        }`}

                    />

                  </button>

                  {qcAccordionOpen && (

                    <div className="mt-1 ml-2 pl-3 border-l border-teal-100 space-y-0.5">

                      {qcAccordionChildren.map((child) => {

                        const badge =
                          child.countKey && qcCounts && qcCounts[child.countKey] != null
                            ? qcCounts[child.countKey]
                            : null;

                        return (

                        <NavLink

                          key={child.path}

                          to={child.path}

                          onClick={() => setSidebarOpen(false)}

                          className={({ isActive }) =>

                            [

                              'flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs transition-colors',

                              isActive

                                ? 'bg-teal-100 text-teal-900 font-semibold'

                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'

                            ].join(' ')

                          }

                        >

                          <span>{child.label}</span>

                          {badge != null ? (
                            <span className="shrink-0 rounded-full bg-teal-100 text-teal-900 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                              {badge}
                            </span>
                          ) : null}

                        </NavLink>

                      );})}

                    </div>

                  )}

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



        <div className="absolute bottom-0 left-0 right-0 p-4 border-t text-xs text-gray-500 bg-white">

          Powered by Rentfoxxy Ops

        </div>

      </aside>



      <div className="lg:ml-64">

        <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30">

          <div className="flex items-center justify-between">

            <button

              type="button"

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

                type="button"

                onClick={handleLogout}

                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"

              >

                <LogOut className="w-4 h-4" />

                <span>Logout</span>

              </button>

            </div>

          </div>

        </header>



        <main className="p-4 lg:p-6">{children}</main>

      </div>

    </div>

  );

}


