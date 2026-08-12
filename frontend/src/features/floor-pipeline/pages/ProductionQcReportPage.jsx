import React from 'react';
import { Navigate } from 'react-router-dom';

/** Legacy Production menu path — report lives under Reports & Analytics. */
export default function ProductionQcReportPage() {
  return <Navigate to="/reports/production-qc-report" replace />;
}
