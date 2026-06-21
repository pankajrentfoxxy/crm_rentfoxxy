import React from 'react';
import { Navigate } from 'react-router-dom';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import DemoAgreementsPage from '../pages/demo/DemoAgreementsPage';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, element, action = 'view') {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

// The /operation-management/* sales-document pages were a second, parallel
// implementation of the canonical /sales-pipeline/* stack. To remove the
// duplicate sections (and avoid breaking any old bookmarks) every legacy path
// now redirects to its canonical Sales Pipeline page. The Demo Agreements page
// has no Sales Pipeline equivalent, so it stays mounted here.
export const operationManagementRoutes = [
  { path: '/sales-management/*', element: <Navigate to="/sales-pipeline/quotations" replace /> },
  { path: '/operation-management/quotations', element: <Navigate to="/sales-pipeline/quotations" replace /> },
  { path: '/operation-management/quotations/add', element: <Navigate to="/sales-pipeline/quotations" replace /> },
  { path: '/operation-management/sales-orders', element: <Navigate to="/sales-pipeline/sales-orders" replace /> },
  { path: '/operation-management/sales-orders/add', element: <Navigate to="/sales-pipeline/sales-orders" replace /> },
  { path: '/operation-management/delivery-challans', element: <Navigate to="/sales-pipeline/delivery-challans" replace /> },
  { path: '/operation-management/delivery-challans/add', element: <Navigate to="/sales-pipeline/delivery-challans" replace /> },
  { path: '/operation-management/delivery-challans/:dcNumber/register', element: <Navigate to="/sales-pipeline/delivery-register" replace /> },
  { path: '/operation-management/return-dc', element: <Navigate to="/sales-pipeline/return-dc" replace /> },
  { path: '/sales-pipeline/demo', element: guard('demo_management', withLayout(<DemoAgreementsPage />)) },
];
