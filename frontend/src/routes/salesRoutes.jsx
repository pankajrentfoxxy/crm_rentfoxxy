import React from 'react';
import { Navigate } from 'react-router-dom';
import PartsRedirect from './PartsRedirect';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import Dashboard from '../pages/Dashboard';
import LeadCrmApp from '../features/lead-crm/LeadCrmApp';
import SalesPipelineApp from '../features/sales-pipeline/SalesPipelineApp';
import TicketsList from '../pages/tickets/TicketsList';
import CreateTicket from '../pages/tickets/CreateTicket';
import TicketDetails from '../pages/tickets/TicketDetails';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, action, element) {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

export const salesRoutes = [
  { path: '/dashboard', element: guard('dashboard', 'view', withLayout(<Dashboard />)) },
  { path: '/tickets', element: guard('tickets', 'view', withLayout(<TicketsList />)) },
  { path: '/tickets/:id', element: guard('tickets', 'view', withLayout(<TicketDetails />)) },
  { path: '/tickets/create', element: guard('tickets', 'create', withLayout(<CreateTicket />)) },
  { path: '/parts', element: guard('parts_inventory', 'view', withLayout(<PartsRedirect />)) },
  {
    // Umbrella guard: lets in anyone who can view leads OR customers OR follow-ups.
    // Per-page access is enforced inside LeadCrmApp so each sub-page matches its section.
    path: '/lead-crm/*',
    element: (
      <ProtectedRoute sections={['leads', 'customers', 'follow_ups']} action="view">
        {withLayout(<LeadCrmApp />)}
      </ProtectedRoute>
    ),
  },
  {
    // Umbrella: admit anyone who can open ANY sales-pipeline document; each page
    // enforces its own granular section inside SalesPipelineApp (matches backend).
    path: '/sales-pipeline/*',
    element: (
      <ProtectedRoute
        sections={['sales_quotations', 'sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'delivery_challans', 'return_dc', 'delivery_register_management', 'technician_bucket', 'technicians_bucket_list']}
        action="view"
      >
        {withLayout(<SalesPipelineApp />)}
      </ProtectedRoute>
    ),
  },
  // Legacy top-level pages superseded by feature modules. Redirect (not delete)
  // so old bookmarks/links land on the canonical page instead of duplicating UI.
  { path: '/inventory', element: <Navigate to="/inventory-management/universal-search" replace /> },
  { path: '/sales', element: <Navigate to="/sales-pipeline/sales-orders-sale" replace /> },
  { path: '/leads', element: <Navigate to="/lead-crm/leads" replace /> },
  { path: '/leads/:id', element: <Navigate to="/lead-crm/leads" replace /> },
  { path: '/follow-ups', element: <Navigate to="/lead-crm/follow-ups" replace /> },
  { path: '/lead-orders', element: <Navigate to="/sales-pipeline/sales-orders-rental" replace /> },
  { path: '/customers', element: <Navigate to="/lead-crm/customers" replace /> },
  { path: '/orders', element: <Navigate to="/sales-pipeline/sales-orders-rental" replace /> },
];
