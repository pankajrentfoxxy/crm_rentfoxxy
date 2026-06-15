import React from 'react';
import api from '../utils/api';
import PartsRedirect from './PartsRedirect';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import Dashboard from '../pages/Dashboard';
import Inventory from '../components/Inventory';
import Sales from '../components/Sales';
import LeadList from '../components/LeadList.legacy';
import LeadDetail from '../components/LeadDetail.legacy';
import FollowUps from '../components/FollowUps.legacy';
import LeadCrmApp from '../features/lead-crm/LeadCrmApp';
import SalesPipelineApp from '../features/sales-pipeline/SalesPipelineApp';
import Orders from '../components/Orders';
import Customers from '../components/Customers';
import TicketsList from '../pages/tickets/TicketsList';
import CreateTicket from '../pages/tickets/CreateTicket';
import TicketDetails from '../pages/tickets/TicketDetails';

const withLayout = (node) => <Layout>{node}</Layout>;
const withInventoryPadding = (node) => (
  <Layout>
    <div className="p-6">{node}</div>
  </Layout>
);

function guard(section, action, element) {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

export const salesRoutes = [
  { path: '/dashboard', element: guard('dashboard', 'view', withLayout(<Dashboard />)) },
  { path: '/inventory', element: guard('inventory', 'view', withInventoryPadding(<Inventory api={api} />)) },
  { path: '/tickets', element: guard('tickets', 'view', withLayout(<TicketsList />)) },
  { path: '/tickets/:id', element: guard('tickets', 'view', withLayout(<TicketDetails />)) },
  { path: '/tickets/create', element: guard('tickets', 'create', withLayout(<CreateTicket />)) },
  { path: '/parts', element: guard('parts_inventory', 'view', withLayout(<PartsRedirect />)) },
  { path: '/sales', element: guard('sales_orders', 'view', withLayout(<Sales api={api} />)) },
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
        sections={['sales_quotations', 'sales_orders_doc', 'delivery_challans', 'return_dc', 'delivery_register_management']}
        action="view"
      >
        {withLayout(<SalesPipelineApp />)}
      </ProtectedRoute>
    ),
  },
  { path: '/leads', element: guard('leads', 'view', withLayout(<LeadList api={api} />)) },
  { path: '/leads/:id', element: guard('leads', 'view', withLayout(<LeadDetail api={api} />)) },
  { path: '/follow-ups', element: guard('follow_ups', 'view', withLayout(<FollowUps api={api} />)) },
  { path: '/lead-orders', element: guard('lead_orders', 'view', withLayout(<Orders api={api} />)) },
  { path: '/customers', element: guard('customers', 'view', withLayout(<Customers api={api} />)) },
  { path: '/orders', element: guard('lead_orders', 'view', withLayout(<Orders api={api} />)) },
];
