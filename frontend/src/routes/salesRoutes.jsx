import React from 'react';
import api from '../utils/api';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import Dashboard from '../pages/Dashboard';
import Inventory from '../components/Inventory';
import PartsInventory from '../components/PartsInventory';
import Reports from '../components/Reports';
import Sales from '../components/Sales';
import LeadList from '../components/LeadList.legacy';
import LeadDetail from '../components/LeadDetail.legacy';
import FollowUps from '../components/FollowUps.legacy';
import LeadCrmApp from '../features/lead-crm/LeadCrmApp';
import ManagerDashboard from '../components/ManagerDashboard';
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
  { path: '/parts', element: guard('parts', 'view', withLayout(<PartsInventory />)) },
  { path: '/sales', element: guard('sales_orders', 'view', withLayout(<Sales api={api} />)) },
  { path: '/lead-crm/*', element: guard('leads', 'view', withLayout(<LeadCrmApp />)) },
  { path: '/leads', element: guard('leads', 'view', withLayout(<LeadList api={api} />)) },
  { path: '/leads/:id', element: guard('leads', 'view', withLayout(<LeadDetail api={api} />)) },
  { path: '/follow-ups', element: guard('follow_ups', 'view', withLayout(<FollowUps api={api} />)) },
  { path: '/lead-orders', element: guard('lead_orders', 'view', withLayout(<Orders api={api} />)) },
  { path: '/customers', element: guard('customers', 'view', withLayout(<Customers api={api} />)) },
  { path: '/manager-dashboard', element: guard('manager_dashboard', 'view', withLayout(<ManagerDashboard api={api} />)) },
  { path: '/reports', element: guard('reports', 'view', withLayout(<Reports api={api} />)) },
  { path: '/orders', element: guard('lead_orders', 'view', withLayout(<Orders api={api} />)) },
];
