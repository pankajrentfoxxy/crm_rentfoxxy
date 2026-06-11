import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import ReportingApp from '../features/reporting/ReportingApp';
import ReportingRouteGuard from '../features/reporting/ReportingRouteGuard';

export const reportingRoutes = [
  {
    path: '/reports/*',
    element: (
      <ProtectedRoute>
        <ReportingRouteGuard>
          <Layout>
            <ReportingApp />
          </Layout>
        </ReportingRouteGuard>
      </ProtectedRoute>
    ),
  },
];
