import React from 'react';
import ProtectedRoute from '../../router/ProtectedRoute';
import { ALL_REPORT_SECTIONS } from '../../features/carret/control/reportsCatalog';

/**
 * Builder 6 (29 Sep 2026): movement documents, Sell extras, Control settings.
 * The lead spreads this array into carretRoutes (behind REACT_APP_CARRET).
 *
 * Every guard is the section(s) the page's API already checks — no wider.
 * Where an API also lets a hardcoded role list in (repair challans, part
 * challans), the page shows / hides its buttons by the same rule; the route
 * guard stays on the matrix sections the API's read accepts.
 */
const RepairChallanRecordPage = React.lazy(() => import('../../features/carret/procure/RepairChallanRecordPage'));
const RepairChallanCreatePage = React.lazy(() => import('../../features/carret/procure/RepairChallanCreatePage'));
const ScrapChallanRecordPage = React.lazy(() => import('../../features/carret/stock/ScrapChallanRecordPage'));
const PartChallanRecordPage = React.lazy(() => import('../../features/carret/serve/PartChallanRecordPage'));
const PartDcRecordPage = React.lazy(() => import('../../features/carret/serve/PartDcRecordPage'));
const DemoAgreementsPage = React.lazy(() => import('../../features/carret/sell/DemoAgreementsPage'));
const SaleInPlacePage = React.lazy(() => import('../../features/carret/sell/SaleInPlacePage'));
const SaleInPlaceNewPage = React.lazy(() => import('../../features/carret/sell/SaleInPlaceNewPage'));
const ControlTeamsPage = React.lazy(() => import('../../features/carret/control/TeamsPage'));
const ControlCompanySettingsPage = React.lazy(() => import('../../features/carret/control/CompanySettingsPage'));
const ControlReportsPage = React.lazy(() => import('../../features/carret/control/ReportsPage'));
const ControlReportViewPage = React.lazy(() => import('../../features/carret/control/ReportViewPage'));

/* global process */
const CARRET_ENABLED = process.env.REACT_APP_CARRET === '1';

const guard = (section, action, node) => (
  <ProtectedRoute section={section} action={action}>
    <React.Suspense fallback={null}>{node}</React.Suspense>
  </ProtectedRoute>
);
const guardAny = (sections, action, node) => (
  <ProtectedRoute sections={sections} action={action}>
    <React.Suspense fallback={null}>{node}</React.Suspense>
  </ProtectedRoute>
);

/** GET /api/vendor-repair/dc/:dc — vendorRepairView in routes/vendorRepair.js. */
export const REPAIR_VIEW_SECTIONS = ['vendor_repair_dc', 'vendor_repair_dc_dispatch', 'floor_pipeline', 'vendor_management'];
/** GET /api/vendor-repair/diagnosis-failed — diagnosisFailedView. */
export const DIAGNOSIS_FAILED_SECTIONS = ['diagnosis_failed', 'floor_pipeline'];
/**
 * Vendor returns list: the union of its tabs' API sections (each tab hides
 * itself without its own). Replaces the guard on /carret/procure/returns.
 */
export const VENDOR_RETURNS_SECTIONS = ['vendor_return_to_vendor', 'vendor_management', 'vendor_return_ticket', ...REPAIR_VIEW_SECTIONS.filter((s) => s !== 'vendor_management'), 'diagnosis_failed'];
/** routes/scrapChallan.js viewAny. */
const SCRAP_CHALLAN_SECTIONS = ['scrap_challans', 'parts_discarded', 'parts_procurement', 'parts_inventory', 'part_vendor_repair', 'inventory_management'];
/** routes/supportParts.js requireSupportOrWarehouse. */
const PART_CHALLAN_SECTIONS = ['support_part_challan', 'support_part_requests'];

export const movementSellControlRoutes = CARRET_ENABLED
  ? [
      // Procurement → Vendor returns: repair challans (VRDC).
      { path: '/carret/procure/repairs/new', element: guardAny(DIAGNOSIS_FAILED_SECTIONS, 'view', <RepairChallanCreatePage />) },
      { path: '/carret/procure/repairs/:dcNumber', element: guardAny(REPAIR_VIEW_SECTIONS, 'view', <RepairChallanRecordPage />) },

      // Stock → Scrap: a scrap challan's record.
      { path: '/carret/stock/scrap/challans/:challanNumber', element: guardAny(SCRAP_CHALLAN_SECTIONS, 'view', <ScrapChallanRecordPage />) },

      // Support → Parts desk: technician part challan, customer Part DC, return RPDC.
      { path: '/carret/serve/parts-challans/:challanId', element: guardAny(PART_CHALLAN_SECTIONS, 'view', <PartChallanRecordPage />) },
      { path: '/carret/serve/part-dcs/:dcNumber', element: guardAny(PART_CHALLAN_SECTIONS, 'view', <PartDcRecordPage kind="customer" />) },
      { path: '/carret/serve/part-return-dcs/:dcNumber', element: guardAny(PART_CHALLAN_SECTIONS, 'view', <PartDcRecordPage kind="return" />) },

      // Sell → Customers & more.
      { path: '/carret/sell/demo', element: guard('demo_management', 'view', <DemoAgreementsPage />) },
      { path: '/carret/sell/sale-in-place', element: guard('sale_in_place', 'view', <SaleInPlacePage />) },
      { path: '/carret/sell/sale-in-place/new', element: guard('sale_in_place', 'create', <SaleInPlaceNewPage />) },

      // Control → Settings. Reports: any one report section (what the old /reports guards accepted).
      { path: '/carret/control/teams', element: guard('teams', 'view', <ControlTeamsPage />) },
      { path: '/carret/control/settings', element: guard('company_settings', 'view', <ControlCompanySettingsPage />) },
      { path: '/carret/control/reports', element: guardAny(ALL_REPORT_SECTIONS, 'view', <ControlReportsPage />) },
      { path: '/carret/control/reports/:reportKey', element: guardAny(ALL_REPORT_SECTIONS, 'view', <ControlReportViewPage />) },
    ]
  : [];

export default movementSellControlRoutes;
