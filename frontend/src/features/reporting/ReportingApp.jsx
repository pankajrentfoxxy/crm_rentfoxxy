import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import usePermission from '../../hooks/usePermission';
import ProtectedRoute from '../../router/ProtectedRoute';
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
  const canReports = canView('reports') || canView('reports_access');
  if (canView('production_qc_report') && !canReports && !canView('analytics_dashboard')) {
    return <Navigate to="production-qc-report" replace />;
  }
  if (user?.role === 'floor_manager' && canReports) {
    return <Navigate to="laptop-report" replace />;
  }
  if (canView('analytics_dashboard')) return <Navigate to="manager-dashboard" replace />;
  if (canReports) return <Navigate to="laptop-report" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function ReportingApp() {
  return (
    <Routes>
      <Route index element={<ReportsIndexRedirect />} />
      <Route path="manager-dashboard" element={g('analytics_dashboard', <ManagerDashboardPage />)} />
      <Route path="sales-dashboard" element={g('analytics_dashboard', <SalesDashboardPage />)} />
      <Route path="revenue" element={g('reports_access', <RevenueReportPage />)} />
      <Route path="inventory" element={g('reports_access', <InventoryReportPage />)} />
      <Route path="lead-conversion" element={g('reports_access', <LeadConversionReportPage />)} />
      <Route path="salesperson" element={g('reports_access', <SalespersonReportPage />)} />
      <Route path="collections" element={g('reports_access', <CollectionsReportPage />)} />
      <Route path="vendor-spend" element={g('reports_access', <VendorSpendReportPage />)} />
      <Route path="technician" element={<Navigate to="/reports/laptop-report" replace />} />
      <Route path="laptop-report" element={g('reports_access', <LaptopReportPage />)} />
      <Route path="warehouse-laptops" element={g('reports_access', <WarehouseLaptopReportPage />)} />
      <Route
        path="production-qc-report"
        element={gAny(
          ['production_qc_report', 'reports_access', 'reports', 'qc_management'],
          <ProductionQcReportPage />
        )}
      />
      <Route path="sales-order-report" element={g('reports_access', <SalesOrderReportPage />)} />
      <Route path="support-daily-summary" element={g('reports_access', <SupportDailySummaryPage />)} />
      <Route path="inward-outward-summary" element={g('reports_access', <InwardOutwardSummaryPage />)} />
    </Routes>
  );
}
