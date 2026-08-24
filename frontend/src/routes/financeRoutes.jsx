import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import CustomerBillingApp from '../features/customer-billing/CustomerBillingApp';
import VendorBillingApp from '../features/vendor-billing/VendorBillingApp';
import FinanceOverviewApp from '../features/finance-overview/FinanceOverviewApp';
import EInvoiceQueuePage from '../features/finance-overview/pages/EInvoiceQueuePage';
import DcInvoiceQueuePage from '../features/finance-overview/pages/DcInvoiceQueuePage';

const withLayout = (node) => <Layout>{node}</Layout>;

export const financeRoutes = [
  {
    // Umbrella: admit anyone who can open ANY customer-billing page; each page
    // enforces its own section inside CustomerBillingApp (matches the backend).
    path: '/customer-billing/*',
    element: (
      <ProtectedRoute sections={['customer_billing', 'credit_notes', 'security_deposits']} action="view">
        {withLayout(<CustomerBillingApp />)}
      </ProtectedRoute>
    ),
  },
  {
    path: '/vendor-billing/*',
    element: (
      <ProtectedRoute sections={['vendor_billing_mgmt', 'debit_notes']} action="view">
        {withLayout(<VendorBillingApp />)}
      </ProtectedRoute>
    ),
  },
  {
    // Render the page directly — mounting the whole FinanceOverviewApp (which has
    // its own index redirect to "dashboard") here produced /finance/einvoice-queue/dashboard.
    path: '/finance/dc-invoice',
    element: (
      <ProtectedRoute section="einvoice_ewb" action="view">
        {withLayout(<DcInvoiceQueuePage />)}
      </ProtectedRoute>
    ),
  },
  {
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
