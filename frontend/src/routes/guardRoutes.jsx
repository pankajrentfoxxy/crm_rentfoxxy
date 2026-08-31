import React from 'react';
import ProtectedRoute from '../router/ProtectedRoute';
import GuardLayout from '../features/guard-gate/GuardLayout';
import GuardDashboardPage from '../features/guard-gate/GuardDashboardPage';
import GuardScannerPage from '../features/guard-gate/GuardScannerPage';

const withGuard = (section, node) => (
  <ProtectedRoute section={section} action="view">
    <GuardLayout>{node}</GuardLayout>
  </ProtectedRoute>
);

export const guardRoutes = [
  { path: '/guard', element: withGuard('gate_dashboard', <GuardDashboardPage />) },
  { path: '/guard/scanner', element: withGuard('guard_gate_checking', <GuardScannerPage />) },
];
