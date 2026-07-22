import React from 'react';
import { Navigate } from 'react-router-dom';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import SupportProtectedRoute from '../router/SupportProtectedRoute';
import SupportModuleApp from '../features/support-module/SupportModuleApp';
import SupportPartsApp from '../features/support/SupportPartsApp';

export const supportRoutes = [
  {
    // DEPRECATED: customer_inventory is no longer a source of truth.
    // "Assets with Customer" is now a tab on the customer detail page.
    path: '/customer-inventory',
    element: <Navigate to="/lead-crm/customers" replace />,
  },
  {
    path: '/support/*',
    element: (
      <ProtectedRoute section="support_tickets" action="view">
        <SupportProtectedRoute>
          <Layout>
            <SupportModuleApp />
          </Layout>
        </SupportProtectedRoute>
      </ProtectedRoute>
    ),
  },
  {
    // Standalone parts-bucket / challan flow — reachable by warehouse staff who
    // are not part of the support module (guarded by the parts permissions).
    path: '/support-parts/*',
    element: (
      <ProtectedRoute sections={['support_part_requests', 'support_part_challan']} action="view">
        <Layout>
          <SupportPartsApp />
        </Layout>
      </ProtectedRoute>
    ),
  },
];
