import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import SupportProtectedRoute from '../router/SupportProtectedRoute';
import SupportV2App from '../features/support-v2/SupportV2App';
import SupportModuleApp from '../features/support-module/SupportModuleApp';
import SupportPartsApp from '../features/support/SupportPartsApp';

function SupportV2Redirect() {
  const loc = useLocation();
  return <Navigate to={loc.pathname.replace(/^\/support-v2/, '/support') + loc.search} replace />;
}

const v2Guard = (
  <ProtectedRoute
    sections={[
      'support_dashboard',
      'support_tickets',
      'support_bucket',
      'support_dispatch',
      'support_parts_approve',
      'support_approvals',
      'support_reports',
      'support_taxonomy',
      'support_sla_admin',
    ]}
    action="view"
  >
    <SupportV2App />
  </ProtectedRoute>
);

export const supportV2Routes = [
  { path: '/support-v2/*', element: <SupportV2Redirect /> },
  { path: '/support/*', element: v2Guard },
  {
    path: '/support-legacy/*',
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
];

export const supportPartsRoute = {
  path: '/support-parts/*',
  element: (
    <ProtectedRoute sections={['support_part_requests', 'support_part_challan']} action="view">
      <Layout>
        <SupportPartsApp />
      </Layout>
    </ProtectedRoute>
  ),
};
