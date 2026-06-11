import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import usePermission from '../../hooks/usePermission';

const ANALYTICS_ONLY = ['/reports/manager-dashboard', '/reports/sales-dashboard'];

export default function ReportingRouteGuard({ children }) {
  const { pathname } = useLocation();
  const { canView, user } = usePermission();

  const canAnalytics = canView('analytics_dashboard');
  const canReports = canView('reports');

  const needsAnalytics = ANALYTICS_ONLY.some((p) => pathname.startsWith(p));

  if (needsAnalytics) {
    if (!canAnalytics) return <Navigate to="/dashboard" replace />;
    return children;
  }

  if (canReports || canAnalytics) return children;

  if (user?.role === 'accounts') return children;

  return <Navigate to="/dashboard" replace />;
}
