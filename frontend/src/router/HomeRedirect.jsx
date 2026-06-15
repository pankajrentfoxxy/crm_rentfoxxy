import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';

// First match wins — sends each user to the first module they can actually open,
// so nobody lands on a blank page or a "permission denied" screen. Sections here
// are the SAME ones the sidebar/route guards use (role_permissions matrix).
const LANDING_ORDER = [
  ['analytics_dashboard', '/reports'],
  ['reports', '/reports'],
  ['reports_access', '/reports'],
  ['billing_dashboard', '/finance/dashboard'],
  ['leads', '/lead-crm/leads'],
  ['floor_pipeline', '/floor-pipeline/tickets'],
  ['inventory_management', '/inventory-management/universal-search'],
  ['sales_pipeline', '/sales-pipeline/quotations'],
  ['vendor_management', '/vendor-management/purchase-orders'],
  ['customer_billing', '/customer-billing/invoices'],
  ['vendor_billing_mgmt', '/vendor-billing/bills'],
  ['support_tickets', '/support'],
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
  // Support technicians work entirely inside the support module.
  if (user?.role === 'support_tech') {
    return <Navigate to="/support/my-tickets" replace />;
  }
  for (const [section, path] of LANDING_ORDER) {
    if (canView(section)) return <Navigate to={path} replace />;
  }
  // Last resort — the floor dashboard (every internal role has 'dashboard').
  return <Navigate to="/dashboard" replace />;
}
