import React from 'react';
import ProtectedRoute from '../router/ProtectedRoute';

/**
 * Carret routes, behind REACT_APP_CARRET.
 *
 * With the flag off this array is empty, so the router is byte-identical to
 * what it is today — acceptance test 9. Nothing existing is replaced; the new
 * screens sit beside the old ones at their own paths.
 *
 * Every route declares (section, action) — hard rule 8. These screens show
 * customer, vendor and configuration detail, so shipping one unguarded would
 * put that behind nothing but a URL.
 */
const AssetRecordPage = React.lazy(() => import('../features/carret/AssetRecordPage'));
const AssetsListPage = React.lazy(() => import('../features/carret/AssetsListPage'));
const OperationsOverviewPage = React.lazy(() => import('../features/carret/OperationsOverviewPage'));
const GuardGatePage = React.lazy(() => import('../features/carret/GuardGatePage'));
const ChallansPage = React.lazy(() => import('../features/carret/ChallansPage'));
const SellListPage = React.lazy(() => import('../features/carret/SellListPage'));
const ProcureListPage = React.lazy(() => import('../features/carret/ProcureListPage'));
const FloorPipelinePage = React.lazy(() => import('../features/carret/FloorPipelinePage'));
const PartsListPage = React.lazy(() => import('../features/carret/PartsListPage'));
const InvoicesListPage = React.lazy(() => import('../features/carret/InvoicesListPage'));
const InvoiceRecordPage = React.lazy(() => import('../features/carret/InvoiceRecordPage'));
const AgeingPage = React.lazy(() => import('../features/carret/AgeingPage'));

export const CARRET_ENABLED = process.env.REACT_APP_CARRET === '1';

const guard = (section, action, node) => (
  <ProtectedRoute section={section} action={action}>
    <React.Suspense fallback={null}>{node}</React.Suspense>
  </ProtectedRoute>
);

export const carretRoutes = CARRET_ENABLED
  ? [
      { path: '/carret', element: guard('dashboard', 'view', <OperationsOverviewPage />) },
      { path: '/carret/stock/assets', element: guard('inventory_management', 'view', <AssetsListPage />) },
      { path: '/carret/stock/assets/:ttspl', element: guard('inventory_management', 'view', <AssetRecordPage />) },

      // Move (Part 3.7). The gate is the load-bearing screen under Decision 4,
      // so it gets the floor-density shell rather than a cut-down desk page.
      { path: '/carret/move/gate', element: guard('guard_gate_checking', 'view', <GuardGatePage />) },
      { path: '/carret/move/challans', element: guard('delivery_challans', 'view', <ChallansPage movement="outbound" />) },
      { path: '/carret/move/return-challans', element: guard('return_dc', 'view', <ChallansPage movement="return" />) },

      // Sell (Part 4.5). The RentFoxxy / Gorefurbo split is a filter INSIDE
      // each list (Decision 1), never two branches of the menu.
      { path: '/carret/sell/quotations', element: guard('sales_quotations', 'view', <SellListPage kind="quotations" />) },
      { path: '/carret/sell/sales-orders', element: guard('sales_orders_doc', 'view', <SellListPage kind="sales-orders" />) },
      { path: '/carret/sell/customers', element: guard('customer_management', 'view', <SellListPage kind="customers" />) },

      // Procure & Produce (Part 5.7). Five procurement lists are one component,
      // like Sell, because they are the same shape.
      { path: '/carret/procure/purchase-orders', element: guard('vendor_management', 'view', <ProcureListPage kind="purchase-orders" />) },
      { path: '/carret/procure/vendors', element: guard('vendor_management', 'view', <ProcureListPage kind="vendors" />) },
      { path: '/carret/procure/spare-parts-orders', element: guard('vendor_management', 'view', <ProcureListPage kind="spare-parts-orders" />) },
      { path: '/carret/procure/vendor-returns', element: guard('vendor_return_to_vendor', 'view', <ProcureListPage kind="replaced-products" />) },
      { path: '/carret/procure/vendor-repair', element: guard('vendor_repair_dc', 'view', <ProcureListPage kind="vendor-repair-dcs" />) },

      // The six stage views are ONE screen with the stage as a filter, for the
      // same reason the entity split is a filter: a laptop moving from QC1 to
      // QC2 must not move between sections.
      { path: '/carret/produce/pipeline', element: guard('floor_pipeline', 'view', <FloorPipelinePage />) },
      { path: '/carret/produce/parts', element: guard('parts_inventory', 'view', <PartsListPage />) },

      // Money (Part 6.4). The invoice record is the visible half of 6.2: the
      // timeline is what BL11's audit rows exist for, and the payments panel is
      // the first caller the ledger has ever had (BL18).
      { path: '/carret/money/invoices', element: guard('customer_billing', 'view', <InvoicesListPage />) },
      { path: '/carret/money/invoices/:invoiceId', element: guard('customer_billing', 'view', <InvoiceRecordPage />) },
      { path: '/carret/money/ageing', element: guard('customer_billing', 'view', <AgeingPage />) },
    ]
  : [];

export default carretRoutes;
