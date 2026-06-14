import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import CustomerBillingApp from '../features/customer-billing/CustomerBillingApp';
import VendorBillingApp from '../features/vendor-billing/VendorBillingApp';
import FinanceOverviewApp from '../features/finance-overview/FinanceOverviewApp';
import EInvoiceQueuePage from '../features/finance-overview/pages/EInvoiceQueuePage';

const withLayout = (node) => <Layout>{node}</Layout>;

export const financeRoutes = [
  {
    path: '/customer-billing/*',
    element: (
      <ProtectedRoute section="customer_billing" action="view">
        {withLayout(<CustomerBillingApp />)}
      </ProtectedRoute>
    ),
  },
  {
    path: '/vendor-billing/*',
    element: (
      <ProtectedRoute section="vendor_billing_mgmt" action="view">
        {withLayout(<VendorBillingApp />)}
      </ProtectedRoute>
    ),
  },
  {
    // Render the page directly — mounting the whole FinanceOverviewApp (which has
    // its own index redirect to "dashboard") here produced /finance/einvoice-queue/dashboard.
    path: '/finance/einvoice-queue',
    element: (
      <ProtectedRoute section="einvoice_ewb" action="view">
        {withLayout(<EInvoiceQueuePage />)}
      </ProtectedRoute>
    ),
  },
  {
    path: '/finance/*',
    element: (
      <ProtectedRoute section="billing_dashboard" action="view">
        {withLayout(<FinanceOverviewApp />)}
      </ProtectedRoute>
    ),
  },
];
