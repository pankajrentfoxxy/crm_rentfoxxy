import React from 'react';
import ProtectedRoute from '../router/ProtectedRoute';
import Layout from '../layout/Layout';
import { useAuth } from '../context/AuthContext';
import GuardLayout from '../features/guard-gate/GuardLayout';
import GuardDashboardPage from '../features/guard-gate/GuardDashboardPage';
import GuardScannerPage from '../features/guard-gate/GuardScannerPage';
import GateReportPage from '../features/guard-gate/GateReportPage';

const withGuard = (section, node) => (
  <ProtectedRoute section={section} action="view">
    <GuardLayout>{node}</GuardLayout>
  </ProtectedRoute>
);

function GateHome() {
  const { user } = useAuth();
  if (user?.role === 'guard') {
    return (
      <GuardLayout>
        <GuardDashboardPage />
      </GuardLayout>
    );
  }
  return (
    <Layout>
      <GateReportPage />
    </Layout>
  );
}

export const guardRoutes = [
  {
    path: '/guard',
    element: (
      <ProtectedRoute section="gate_dashboard" action="view">
        <GateHome />
      </ProtectedRoute>
    ),
  },
  { path: '/guard/scanner', element: withGuard('guard_gate_checking', <GuardScannerPage />) },
];
