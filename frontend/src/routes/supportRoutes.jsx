import React from 'react';
import api from '../utils/api';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import SupportProtectedRoute from '../router/SupportProtectedRoute';
import CustomerInventory from '../components/CustomerInventory';
import SupportApp from '../components/support/SupportApp';

const withInventoryPadding = (node) => (
  <Layout>
    <div className="p-6">{node}</div>
  </Layout>
);

function guard(section, action, element) {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

export const supportRoutes = [
  {
    path: '/customer-inventory',
    element: guard('customer_inventory', 'view', withInventoryPadding(<CustomerInventory api={api} />)),
  },
  {
    path: '/support/*',
    element: (
      <ProtectedRoute section="support_tickets" action="view">
        <SupportProtectedRoute>
          <SupportApp />
        </SupportProtectedRoute>
      </ProtectedRoute>
    ),
  },
];
