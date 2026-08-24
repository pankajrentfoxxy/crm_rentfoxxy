import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import usePermission from '../../hooks/usePermission';
import ProtectedRoute from '../../router/ProtectedRoute';
import { firstAccessibleReportPath } from '../../utils/reportAccess';
import ManagerDashboardPage from './pages/ManagerDashboardPage';
import SalesDashboardPage from './pages/SalesDashboardPage';
import RevenueReportPage from './pages/RevenueReportPage';
import InventoryReportPage from './pages/InventoryReportPage';
import LeadConversionReportPage from './pages/LeadConversionReportPage';
import SalespersonReportPage from './pages/SalespersonReportPage';
import CollectionsReportPage from './pages/CollectionsReportPage';
import VendorSpendReportPage from './pages/VendorSpendReportPage';
import LaptopReportPage from './pages/LaptopReportPage';
import WarehouseLaptopReportPage from './pages/WarehouseLaptopReportPage';
import SalesOrderReportPage from './pages/SalesOrderReportPage';
import SupportDailySummaryPage from './pages/SupportDailySummaryPage';
import InwardOutwardSummaryPage from './pages/InwardOutwardSummaryPage';
import ProductionQcReportPage from './pages/ProductionQcReportPage';

const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;
const gAny = (sections, node) => <ProtectedRoute sections={sections} action="view">{node}</ProtectedRoute>;

function ReportsIndexRedirect() {
  const { user, canView } = usePermission();
  if (user?.role === 'sales' && canView('analytics_dashboard')) {
    return <Navigate to="sales-dashboard" replace />;
  }
  const first = firstAccessibleReportPath(canView, user?.role);
  if (first) {
    return <Navigate to={first.replace(/^\/reports\/?/, '') || first} replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

export default function ReportingApp() {
  return (
    <Routes>
      <Route index element={<ReportsIndexRedirect />} />
      <Route path="manager-dashboard" element={g('analytics_dashboard', <ManagerDashboardPage />)} />
      <Route path="sales-dashboard" element={g('analytics_dashboard', <SalesDashboardPage />)} />
      <Route path="revenue" element={g('report_revenue', <RevenueReportPage />)} />
      <Route path="inventory" element={g('report_inventory', <InventoryReportPage />)} />
      <Route path="lead-conversion" element={g('report_lead_conversion', <LeadConversionReportPage />)} />
      <Route path="salesperson" element={g('report_salesperson', <SalespersonReportPage />)} />
      <Route path="collections" element={g('report_collections', <CollectionsReportPage />)} />
      <Route path="vendor-spend" element={g('report_vendor_spend', <VendorSpendReportPage />)} />
      <Route path="technician" element={<Navigate to="/reports/laptop-report" replace />} />
      <Route path="laptop-report" element={g('report_laptop', <LaptopReportPage />)} />
      <Route path="warehouse-laptops" element={g('report_warehouse_laptops', <WarehouseLaptopReportPage />)} />
      <Route
        path="production-qc-report"
        element={gAny(['production_qc_report', 'qc_management'], <ProductionQcReportPage />)}
      />
      <Route path="sales-order-report" element={g('report_sales_order', <SalesOrderReportPage />)} />
      <Route path="support-daily-summary" element={g('report_support_daily', <SupportDailySummaryPage />)} />
      <Route path="inward-outward-summary" element={g('report_inward_outward', <InwardOutwardSummaryPage />)} />
    </Routes>
  );
}
