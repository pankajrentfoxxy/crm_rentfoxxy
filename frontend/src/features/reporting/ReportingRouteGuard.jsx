import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import usePermission from '../../hooks/usePermission';
import { canViewReportPath } from '../../utils/reportAccess';

export default function ReportingRouteGuard({ children }) {
  const { pathname } = useLocation();
  const { canView } = usePermission();

  if (pathname === '/reports' || pathname === '/reports/') {
    return children;
  }

  if (!canViewReportPath(pathname, canView)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
