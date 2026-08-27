import React from 'react';
import ProtectedRoute from '../router/ProtectedRoute';
import GuardLayout from '../features/guard-gate/GuardLayout';
import GuardDashboardPage from '../features/guard-gate/GuardDashboardPage';
import GuardScannerPage from '../features/guard-gate/GuardScannerPage';

const withGuard = (node) => (
  <ProtectedRoute section="guard_gate_checking" action="view">
    <GuardLayout>{node}</GuardLayout>
  </ProtectedRoute>
);

export const guardRoutes = [
  { path: '/guard', element: withGuard(<GuardDashboardPage />) },
  { path: '/guard/scanner', element: withGuard(<GuardScannerPage />) },
];
