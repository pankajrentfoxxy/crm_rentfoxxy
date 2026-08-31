import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import { firstAccessibleReportPath } from '../utils/reportAccess';

// First match wins — sends each user to the first module they can actually open,
// so nobody lands on a blank page or a "permission denied" screen. Sections here
// are the SAME ones the sidebar/route guards use (role_permissions matrix).
const LANDING_ORDER = [
  ['billing_dashboard', '/finance/dashboard'],
  ['leads', '/lead-crm/leads'],
  ['floor_tickets', '/floor-pipeline/tickets'],
  ['qc_management', '/floor-pipeline/tickets?stage=QC1,QC2'],
  ['chip_level_repair', '/floor-pipeline/tickets?stage=Chip+Level+Repair'],
  ['floor_pipeline', '/floor-pipeline/dashboard'],
  ['diagnosis_failed', '/floor-pipeline/diagnosis-failed'],
  ['ttspl_history', '/inventory-management/ttspl-history'],
  ['parts_dashboard', '/inventory-management/parts-dashboard'],
  ['parts_inventory', '/inventory-management/parts'],
  ['parts_approval', '/inventory-management/parts-approval'],
  ['parts_procurement', '/vendor-management/spare-parts-po'],
  ['vendor_repair_dc', '/vendor-management/vendor-repair-dc'],
  ['vendor_repair_dc_dispatch', '/vendor-management/vendor-repair-dc'],
  ['part_vendor_repair', '/inventory-management/part-vendor-repair'],
  ['customer_inventory', '/inventory-management/customer-assets'],
  ['inventory_management', '/inventory-management/universal-search'],
  ['technician_bucket', '/sales-pipeline/my-deliveries'],
  ['delivery_register_management', '/sales-pipeline/delivery-register'],
  ['delivery_challans', '/sales-pipeline/delivery-challans'],
  ['return_dc', '/sales-pipeline/return-dc'],
  ['sales_quotations', '/sales-pipeline/quotations'],
  ['sales_orders_doc', '/sales-pipeline/sales-orders'],
  ['vendor_management', '/vendor-management/purchase-orders'],
  ['customer_billing', '/customer-billing/invoices'],
  ['vendor_billing_mgmt', '/vendor-billing/bills'],
  ['guard_gate_checking', '/guard/scanner'],
  ['gate_dashboard', '/guard'],
  ['support_tickets', '/support'],
  ['support_part_challan', '/support-parts/queue'],
  ['support_part_requests', '/support-parts/tech-bucket'],
  ['customers', '/lead-crm/customers'],
];

export default function HomeRedirect() {
  const { isAuthenticated, loading, user } = useAuth();
  const { canView } = usePermission();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (user?.role === 'guard') {
    if (canView('guard_gate_checking')) return <Navigate to="/guard/scanner" replace />;
    if (canView('gate_dashboard')) return <Navigate to="/guard" replace />;
    return <Navigate to="/guard/scanner" replace />;
  }
  // Support technicians: land on delivery module when granted, else support tickets.
  if (user?.role === 'support_tech') {
    if (canView('technician_bucket')) return <Navigate to="/sales-pipeline/my-deliveries" replace />;
    if (canView('delivery_register_management')) return <Navigate to="/sales-pipeline/delivery-register" replace />;
    if (canView('delivery_challans')) return <Navigate to="/sales-pipeline/delivery-challans" replace />;
    return <Navigate to="/support/my-tickets" replace />;
  }
  const reportPath = firstAccessibleReportPath(canView, user?.role);
  if (reportPath) return <Navigate to={reportPath} replace />;

  for (const [section, path] of LANDING_ORDER) {
    if (canView(section)) return <Navigate to={path} replace />;
  }
  // Last resort — the floor dashboard (every internal role has 'dashboard').
  return <Navigate to="/dashboard" replace />;
}
