import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import usePermission from '../../hooks/usePermission';

const ANALYTICS_ONLY = ['/reports/manager-dashboard', '/reports/sales-dashboard'];

export default function ReportingRouteGuard({ children }) {
  const { pathname } = useLocation();
  const { canView, user } = usePermission();

  const canAnalytics = canView('analytics_dashboard');
  const canReports = canView('reports') || canView('reports_access');
  const canProductionQcReport = canView('production_qc_report') || canView('qc_management');

  const needsAnalytics = ANALYTICS_ONLY.some((p) => pathname.startsWith(p));

  if (needsAnalytics) {
    if (!canAnalytics) return <Navigate to="/dashboard" replace />;
    return children;
  }

  if (pathname.startsWith('/reports/production-qc-report')) {
    if (canProductionQcReport || canReports || canAnalytics) return children;
    return <Navigate to="/dashboard" replace />;
  }

  if (canReports || canAnalytics) return children;

  if (user?.role === 'accounts') return children;

  return <Navigate to="/dashboard" replace />;
}
