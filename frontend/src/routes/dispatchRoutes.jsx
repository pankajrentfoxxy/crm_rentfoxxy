import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import DispatchPendingOrdersPage from '../features/dispatch/pages/DispatchPendingOrdersPage';

export const dispatchRoutes = [
  {
    path: '/dispatch/pending-orders',
    element: (
      <ProtectedRoute section="dispatch_pending_orders" action="view">
        <Layout>
          <DispatchPendingOrdersPage />
        </Layout>
      </ProtectedRoute>
    ),
  },
];
