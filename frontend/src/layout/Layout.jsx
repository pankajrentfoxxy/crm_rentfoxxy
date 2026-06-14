// Layout Component

import { useState, useEffect } from 'react';

import { useAuth } from '../context/AuthContext';

import { useNavigate, Link, NavLink, useLocation } from 'react-router-dom';

import {

  BarChart3,
  BarChart2,

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

  ShoppingCart,

  ChevronDown,

  Settings,
  Cog,
  ClipboardCheck,
  Wrench,
  DollarSign,
} from 'lucide-react';

import { isSupportUser } from '../utils/supportAccess';
import { useQcStatusCounts } from '../features/qc-management/hooks/useQcStatusCounts';
import { useInventoryListCounts } from '../features/inventory-management/hooks/useInventoryListCounts';
import usePermission from '../hooks/usePermission';
import { useOperationCounts } from '../features/operation-management/hooks/useOperationCounts';
import { useDeliveryRegisterCounts } from '../features/delivery-register-management/hooks/useDeliveryRegisterCounts';
import { useLeadCrmCounts } from '../features/lead-crm/hooks/useLeadCrmCounts';
import { useFinanceCounts } from '../features/finance-overview/hooks/useFinanceCounts';
import { useSupportCounts } from '../features/support-module/hooks/useSupportCounts';
import {
  FLAT_MENU_ITEMS,
  vendorAccordionChildren,
  leadCrmAccordionChildren,
  floorPipelineAccordionChildren,
  qcAccordionChildren,
  inventoryAccordionChildren,
  settingsAccordionChildren,
  operationAccordionChildren,
  salesPipelineAccordionChildren,
  financeMenuItems,
  reportsMenuItems,
  deliveryRegisterAccordionChildren,
  isMenuItemVisible,
  isSettingsChildVisible,
  isOperationChildVisible,
  isSalesPipelineChildVisible,
  isFinanceChildVisible,
  isReportsChildVisible,
  isDeliveryRegisterChildVisible,
  isLeadCrmChildVisible,
  isFloorPipelineChildVisible,
  isInventoryChildVisible,
} from '../config/menuConfig';



export default function Layout({ children }) {

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const location = useLocation();

  const { user, logout } = useAuth();
  const { canView } = usePermission();

  const navigate = useNavigate();

  const showQcAccordion = canView('qc_management');

  const showInventoryAccordion = canView('inventory_management');

  const showSalesPipelineAccordion =
    canView('sales_pipeline') ||
    canView('sales_quotations') ||
    canView('sales_orders_doc') ||
    canView('delivery_challans') ||
    canView('return_dc') ||
    canView('delivery_register_management');

  const showDeliveryRegisterAccordion =
    canView('delivery_register_management') || canView('technicians_bucket_list');

  const showFinanceAccordion =
    canView('customer_billing') ||
    canView('vendor_billing_mgmt') ||
    canView('credit_notes') ||
    canView('debit_notes') ||
    canView('security_deposits') ||
    canView('billing_dashboard') ||
    canView('einvoice_ewb');

  const showReportsAccordion =
    canView('analytics_dashboard') || canView('reports');

  const showSupportNav = canView('support_tickets');
  const { counts: supportCounts } = useSupportCounts(showSupportNav);

  const { counts: operationCounts } = useOperationCounts(showSalesPipelineAccordion);
  const { counts: financeCounts } = useFinanceCounts(showFinanceAccordion);

  const deliveryRegisterCounts = useDeliveryRegisterCounts(showDeliveryRegisterAccordion);

  const { counts: qcCounts } = useQcStatusCounts(showQcAccordion);

  const { counts: inventoryCounts } = useInventoryListCounts(showInventoryAccordion);

  const showLeadCrmAccordion = canView('leads') || canView('follow_ups') || canView('customers');
  const { counts: leadCrmCounts } = useLeadCrmCounts(showLeadCrmAccordion);

  const [leadCrmAccordionOpen, setLeadCrmAccordionOpen] = useState(() =>
    location.pathname.startsWith('/lead-crm')
  );

  const [vendorAccordionOpen, setVendorAccordionOpen] = useState(() =>

    location.pathname.startsWith('/vendor-management')

  );

  const [floorPipelineAccordionOpen, setFloorPipelineAccordionOpen] = useState(() =>

    location.pathname.startsWith('/floor-pipeline')

  );

  const [qcAccordionOpen, setQcAccordionOpen] = useState(() =>

    location.pathname.startsWith('/qc-management')

  );

  const [inventoryAccordionOpen, setInventoryAccordionOpen] = useState(() =>

    location.pathname.startsWith('/inventory-management')

  );

  const [settingsAccordionOpen, setSettingsAccordionOpen] = useState(() =>

    location.pathname.startsWith('/settings')

  );

  const [operationAccordionOpen, setOperationAccordionOpen] = useState(() =>
    location.pathname.startsWith('/operation-management')
  );

  const [salesPipelineAccordionOpen, setSalesPipelineAccordionOpen] = useState(() =>
    location.pathname.startsWith('/sales-pipeline')
  );

  const [deliveryRegisterAccordionOpen, setDeliveryRegisterAccordionOpen] = useState(() =>
    location.pathname.startsWith('/delivery-register-management')
  );

  const [financeAccordionOpen, setFinanceAccordionOpen] = useState(() =>
    location.pathname.startsWith('/customer-billing') ||
    location.pathname.startsWith('/vendor-billing') ||
    location.pathname.startsWith('/finance')
  );

  const [reportsAccordionOpen, setReportsAccordionOpen] = useState(() =>
    location.pathname.startsWith('/reports')
  );



  useEffect(() => {

    if (location.pathname.startsWith('/lead-crm')) {
      setLeadCrmAccordionOpen(true);
    }

    if (location.pathname.startsWith('/vendor-management')) {

      setVendorAccordionOpen(true);

    }

    if (location.pathname.startsWith('/qc-management')) {

      setQcAccordionOpen(true);

    }

    if (location.pathname.startsWith('/inventory-management')) {

      setInventoryAccordionOpen(true);

    }

    if (location.pathname.startsWith('/settings')) {

      setSettingsAccordionOpen(true);

    }

    if (location.pathname.startsWith('/operation-management')) {
      setOperationAccordionOpen(true);
    }

    if (location.pathname.startsWith('/sales-pipeline')) {
      setSalesPipelineAccordionOpen(true);
    }

    if (location.pathname.startsWith('/delivery-register-management')) {
      setDeliveryRegisterAccordionOpen(true);
    }

    if (location.pathname.startsWith('/reports')) {
      setReportsAccordionOpen(true);
    }

    if (
      location.pathname.startsWith('/customer-billing') ||
      location.pathname.startsWith('/vendor-billing') ||
      location.pathname.startsWith('/finance')
    ) {
      setFinanceAccordionOpen(true);
    }

  }, [location.pathname]);



  const handleLogout = () => {

    logout();

    navigate('/login');

  };



  const menuItems = FLAT_MENU_ITEMS;

  // Permission-filtered children for each accordion. The sidebar must only show
  // what the user can actually open (sections mirror the real route guards), so
  // every accordion is filtered and a group/header is hidden when it has none.
  const reportsVisibleChildren = reportsMenuItems.filter((c) => isReportsChildVisible(c, canView, user?.role));
  const leadCrmVisibleChildren = leadCrmAccordionChildren.filter((c) => isLeadCrmChildVisible(c, canView));
  const salesVisibleChildren = salesPipelineAccordionChildren.filter((c) => isSalesPipelineChildVisible(c, canView));
  const floorVisibleChildren = floorPipelineAccordionChildren.filter((c) => isFloorPipelineChildVisible(c, canView));
  const inventoryVisibleChildren = inventoryAccordionChildren.filter((c) => isInventoryChildVisible(c, canView));
  const financeVisibleChildren = financeMenuItems.filter((c) => isFinanceChildVisible(c, canView));
  const settingsVisibleChildren = settingsAccordionChildren.filter((c) => isSettingsChildVisible(c, canView));
  const showVendorAccordion = canView('vendor_management');
  const showSupportNav2 = canView('support_tickets') || isSupportUser(user) || canView('customer_inventory');

  // Whether each sidebar group has any content the user can reach.
  const groupHasContent = {
    reports: showReportsAccordion && reportsVisibleChildren.length > 0,
    master_data: canView('customers') || canView('vendor_management'),
    lead_crm: showLeadCrmAccordion && leadCrmVisibleChildren.length > 0,
    sales_pipeline: showSalesPipelineAccordion && salesVisibleChildren.length > 0,
    floor_quality: canView('floor_pipeline') && floorVisibleChildren.length > 0,
    inventory: inventoryVisibleChildren.length > 0,
    vendor: showVendorAccordion,
    finance: showFinanceAccordion && financeVisibleChildren.length > 0,
    support: showSupportNav2,
    settings: settingsVisibleChildren.length > 0,
  };

  const ACCORDION_GROUP = {
    reportsAccordion: 'reports',
    leadCrmAccordion: 'lead_crm',
    salesPipelineAccordion: 'sales_pipeline',
    floorPipelineAccordion: 'floor_quality',
    inventoryAccordion: 'inventory',
    vendorAccordion: 'vendor',
    financeAccordion: 'finance',
    settingsAccordion: 'settings',
  };

  function itemAllowed(item) {
    if (item.type === 'section') {
      return groupHasContent[item.groupKey] ?? isMenuItemVisible(item, canView);
    }
    if (ACCORDION_GROUP[item.type]) {
      return !!groupHasContent[ACCORDION_GROUP[item.type]];
    }
    if (item.label === 'Support') {
      return showSupportNav2;
    }
    return isMenuItemVisible(item, canView);
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



            if (item.type === 'leadCrmAccordion') {

              return (

                <div key="lead-crm-accordion" className="space-y-0.5">

                  <button

                    type="button"

                    onClick={() => setLeadCrmAccordionOpen((o) => !o)}

                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${location.pathname.startsWith('/lead-crm') ? 'text-blue-700 bg-blue-50/60' : 'text-gray-800'

                      }`}

                  >

                    <Users className="w-5 h-5 text-gray-600 shrink-0" />

                    <span className="flex-1">Lead & Sales CRM</span>

                    <ChevronDown

                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${leadCrmAccordionOpen ? 'rotate-180' : ''

                        }`}

                    />

                  </button>

                  {leadCrmAccordionOpen && (

                    <div className="mt-1 ml-2 pl-3 border-l border-blue-100 space-y-0.5">

                      {leadCrmAccordionChildren.filter((child) => isLeadCrmChildVisible(child, canView)).map((child) => {

                        const badge =
                          child.countKey && leadCrmCounts && leadCrmCounts[child.countKey] != null
                            ? leadCrmCounts[child.countKey]
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

                                ? 'bg-blue-100 text-blue-900 font-semibold'

                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'

                            ].join(' ')

                          }

                        >

                          <span>{child.label}</span>

                          {badge != null && badge > 0 && (

                            <span className="min-w-[1.25rem] text-center px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold">

                              {badge}

                            </span>

                          )}

                        </NavLink>

                        );

                      })}

                    </div>

                  )}

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



            if (item.type === 'floorPipelineAccordion') {

              return (

                <div key="floor-pipeline-accordion" className="space-y-0.5">

                  <button

                    type="button"

                    onClick={() => setFloorPipelineAccordionOpen((o) => !o)}

                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${location.pathname.startsWith('/floor-pipeline') ? 'text-blue-700 bg-blue-50/60' : 'text-gray-800'

                      }`}

                  >

                    <Wrench className="w-5 h-5 text-gray-600 shrink-0" />

                    <span className="flex-1">Production</span>

                    <ChevronDown

                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${floorPipelineAccordionOpen ? 'rotate-180' : ''

                        }`}

                    />

                  </button>

                  {floorPipelineAccordionOpen && (

                    <div className="mt-1 ml-2 pl-3 border-l border-blue-100 space-y-0.5">

                      {floorVisibleChildren.map((child) => (

                        <NavLink

                          key={child.path}

                          to={child.path}

                          onClick={() => setSidebarOpen(false)}

                          className={({ isActive }) =>

                            [

                              'block px-2 py-1.5 rounded-md text-xs transition-colors',

                              isActive

                                ? 'bg-blue-100 text-blue-900 font-semibold'

                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'

                            ].join(' ')

                          }

                        >

                          {child.label}

                        </NavLink>

                      ))}

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



            if (item.type === 'inventoryAccordion') {

              return (

                <div key="inventory-accordion" className="space-y-0.5">

                  <button

                    type="button"

                    onClick={() => setInventoryAccordionOpen((o) => !o)}

                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${location.pathname.startsWith('/inventory-management') ? 'text-sky-700 bg-sky-50/60' : 'text-gray-800'

                      }`}

                  >

                    <ShoppingCart className="w-5 h-5 text-gray-600 shrink-0" />

                    <span className="flex-1">Inventory Management</span>

                    <ChevronDown

                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${inventoryAccordionOpen ? 'rotate-180' : ''

                        }`}

                    />

                  </button>

                  {inventoryAccordionOpen && (

                    <div className="mt-1 ml-2 pl-3 border-l border-sky-100 space-y-0.5">

                      {inventoryVisibleChildren.map((child) => {

                        const badge =
                          child.countKey && inventoryCounts && inventoryCounts[child.countKey] != null
                            ? inventoryCounts[child.countKey]
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

                                ? 'bg-sky-100 text-sky-900 font-semibold'

                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'

                            ].join(' ')

                          }

                        >

                          <span>{child.label}</span>

                          {badge != null ? (
                            <span className="shrink-0 rounded-full bg-sky-100 text-sky-900 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
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



            if (item.type === 'deliveryRegisterAccordion') {
              return (
                <div key="delivery-register-accordion" className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => setDeliveryRegisterAccordionOpen((o) => !o)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${
                      location.pathname.startsWith('/delivery-register-management') ? 'text-teal-700 bg-teal-50/60' : 'text-gray-800'
                    }`}
                  >
                    <ClipboardCheck className="w-5 h-5 text-gray-600 shrink-0" />
                    <span className="flex-1">Delivery Register Manager</span>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${
                        deliveryRegisterAccordionOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {deliveryRegisterAccordionOpen && (
                    <div className="mt-1 ml-2 pl-3 border-l border-teal-100 space-y-0.5">
                      {deliveryRegisterAccordionChildren.filter((child) => isDeliveryRegisterChildVisible(child, canView)).map((child) => {
                        const badge =
                          child.countKey && deliveryRegisterCounts && deliveryRegisterCounts[child.countKey] != null
                            ? deliveryRegisterCounts[child.countKey]
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
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                              ].join(' ')
                            }
                          >
                            <span>{child.label}</span>
                            {badge != null ? (
                              <span className="shrink-0 rounded-full bg-sky-100 text-sky-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                                {badge}
                              </span>
                            ) : null}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            if (item.type === 'salesPipelineAccordion') {
              return (
                <div key="sales-pipeline-accordion" className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => setSalesPipelineAccordionOpen((o) => !o)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${
                      location.pathname.startsWith('/sales-pipeline') ? 'text-blue-700 bg-blue-50/60' : 'text-gray-800'
                    }`}
                  >
                    <ShoppingCart className="w-5 h-5 text-gray-600 shrink-0" />
                    <span className="flex-1">Sales Pipeline</span>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${
                        salesPipelineAccordionOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {salesPipelineAccordionOpen && (
                    <div className="mt-1 ml-2 pl-3 border-l border-blue-100 space-y-0.5">
                      {salesPipelineAccordionChildren.filter((child) => isSalesPipelineChildVisible(child, canView)).map((child) => {
                        const badge = child.countKey && operationCounts[child.countKey] != null
                          ? operationCounts[child.countKey]
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
                                  ? 'bg-blue-100 text-blue-900 font-semibold'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                              ].join(' ')
                            }
                          >
                            <span>{child.label}</span>
                            {badge != null ? (
                              <span className="shrink-0 rounded-full bg-sky-100 text-sky-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                                {badge}
                              </span>
                            ) : null}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            if (item.type === 'reportsAccordion' && showReportsAccordion) {
              return (
                <div key="reports-accordion" className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => setReportsAccordionOpen((o) => !o)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${
                      location.pathname.startsWith('/reports')
                        ? 'text-violet-700 bg-violet-50/60' : 'text-gray-800'
                    }`}
                  >
                    <BarChart2 className="w-5 h-5 text-gray-600 shrink-0" />
                    <span className="flex-1">Reports & Analytics</span>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${
                        reportsAccordionOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {reportsAccordionOpen && (
                    <div className="mt-1 ml-2 pl-3 border-l border-violet-100 space-y-0.5">
                      {reportsMenuItems
                        .filter((child) => isReportsChildVisible(child, canView, user?.role))
                        .map((child) => {
                          const Icon = child.icon;
                          return (
                            <NavLink
                              key={child.path}
                              to={child.path}
                              onClick={() => setSidebarOpen(false)}
                              className={({ isActive }) =>
                                [
                                  'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors',
                                  isActive
                                    ? 'bg-violet-100 text-violet-900 font-semibold'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                                ].join(' ')
                              }
                            >
                              {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" /> : null}
                              {child.label}
                            </NavLink>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            }

            if (item.type === 'financeAccordion') {
              return (
                <div key="finance-accordion" className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => setFinanceAccordionOpen((o) => !o)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${
                      location.pathname.startsWith('/customer-billing') ||
                      location.pathname.startsWith('/vendor-billing') ||
                      location.pathname.startsWith('/finance')
                        ? 'text-emerald-700 bg-emerald-50/60' : 'text-gray-800'
                    }`}
                  >
                    <DollarSign className="w-5 h-5 text-gray-600 shrink-0" />
                    <span className="flex-1">Finance</span>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${
                        financeAccordionOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {financeAccordionOpen && (
                    <div className="mt-1 ml-2 pl-3 border-l border-emerald-100 space-y-0.5">
                      {financeMenuItems.filter((child) => isFinanceChildVisible(child, canView)).map((child) => {
                        const badge = child.countKey && financeCounts[child.countKey] != null
                          ? financeCounts[child.countKey]
                          : null;
                        const Icon = child.icon;
                        return (
                          <NavLink
                            key={child.path}
                            to={child.path}
                            onClick={() => setSidebarOpen(false)}
                            className={({ isActive }) =>
                              [
                                'flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs transition-colors',
                                isActive
                                  ? 'bg-emerald-100 text-emerald-900 font-semibold'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                              ].join(' ')
                            }
                          >
                            <span className="flex items-center gap-1.5">
                              {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" /> : null}
                              {child.label}
                            </span>
                            {badge != null && badge > 0 ? (
                              <span className="shrink-0 rounded-full bg-sky-100 text-sky-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                                {badge}
                              </span>
                            ) : null}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            if (item.type === 'settingsAccordion') {
              return (
                <div key="settings-accordion" className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => setSettingsAccordionOpen((o) => !o)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left hover:bg-gray-100 ${
                      location.pathname.startsWith('/settings') ? 'text-indigo-700 bg-indigo-50/60' : 'text-gray-800'
                    }`}
                  >
                    <Settings className="w-5 h-5 text-gray-600 shrink-0" />
                    <span className="flex-1">Settings</span>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${
                        settingsAccordionOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {settingsAccordionOpen && (
                    <div className="mt-1 ml-2 pl-3 border-l border-indigo-100 space-y-0.5">
                      {settingsAccordionChildren.filter((child) => isSettingsChildVisible(child, canView)).map((child) => (
                        <NavLink
                          key={child.path}
                          to={child.path}
                          onClick={() => setSidebarOpen(false)}
                          className={({ isActive }) =>
                            [
                              'block px-2 py-1.5 rounded-md text-xs transition-colors',
                              isActive
                                ? 'bg-indigo-100 text-indigo-900 font-semibold'
                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                            ].join(' ')
                          }
                        >
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            const { icon: Icon, label, path, countKey } = item;
            const badge = countKey && supportCounts[countKey] != null ? supportCounts[countKey] : null;

            return (

              <Link

                key={path}

                to={path}

                onClick={() => setSidebarOpen(false)}

                className="flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors text-sm"

              >

                <Icon className="w-5 h-5 text-gray-600 shrink-0" />

                <span className="font-medium flex-1">{label}</span>

                {badge != null && badge > 0 ? (
                  <span className="ml-auto inline-flex min-w-[1.25rem] justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {badge}
                  </span>
                ) : null}

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


