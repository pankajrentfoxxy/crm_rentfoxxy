import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import usePermission from '../../hooks/usePermission';
import ManagerDashboardPage from './pages/ManagerDashboardPage';
import SalesDashboardPage from './pages/SalesDashboardPage';
import RevenueReportPage from './pages/RevenueReportPage';
import InventoryReportPage from './pages/InventoryReportPage';
import LeadConversionReportPage from './pages/LeadConversionReportPage';
import SalespersonReportPage from './pages/SalespersonReportPage';
import CollectionsReportPage from './pages/CollectionsReportPage';
import VendorSpendReportPage from './pages/VendorSpendReportPage';
import TechnicianReportPage from './pages/TechnicianReportPage';

function ReportsIndexRedirect() {
  const { user, canView } = usePermission();
  if (user?.role === 'sales') return <Navigate to="sales-dashboard" replace />;
  if (user?.role === 'floor_manager' && canView('reports')) {
    return <Navigate to="technician" replace />;
  }
  if (canView('analytics_dashboard')) return <Navigate to="manager-dashboard" replace />;
  if (canView('reports')) return <Navigate to="technician" replace />;
  return <Navigate to="sales-dashboard" replace />;
}

export default function ReportingApp() {
  return (
    <Routes>
      <Route index element={<ReportsIndexRedirect />} />
      <Route path="manager-dashboard" element={<ManagerDashboardPage />} />
      <Route path="sales-dashboard" element={<SalesDashboardPage />} />
      <Route path="revenue" element={<RevenueReportPage />} />
      <Route path="inventory" element={<InventoryReportPage />} />
      <Route path="lead-conversion" element={<LeadConversionReportPage />} />
      <Route path="salesperson" element={<SalespersonReportPage />} />
      <Route path="collections" element={<CollectionsReportPage />} />
      <Route path="vendor-spend" element={<VendorSpendReportPage />} />
      <Route path="technician" element={<TechnicianReportPage />} />
    </Routes>
  );
}
