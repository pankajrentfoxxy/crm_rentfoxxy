import React from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import usePermission from '../../hooks/usePermission';
import FloorTicketListPage from './pages/FloorTicketListPage';
import FloorDashboardPage from './pages/FloorDashboardPage';
import TicketDetailPage from './pages/TicketDetailPage';
import DiagnosisFailedPage from './pages/DiagnosisFailedPage';
import PendingInventoryPage from './pages/PendingInventoryPage';
import VendorRepairDcListPage from './pages/VendorRepairDcListPage';
import VendorRepairDcDetailPage from './pages/VendorRepairDcDetailPage';
import {
  canAccessFloorStageFilter,
  FLOOR_DASHBOARD_SECTIONS,
  FLOOR_TICKETS_BASE_SECTIONS,
  firstAllowedFloorTicketsPath,
} from './floorPipelineAccess';

const g = (sections, node) => (
  <ProtectedRoute sections={sections} action="view">{node}</ProtectedRoute>
);

function FloorStageFilterGuard({ children }) {
  const [searchParams] = useSearchParams();
  const { canView } = usePermission();
  const stageFilter = searchParams.get('stage') || '';

  if (!canAccessFloorStageFilter(stageFilter, canView)) {
    const fallback = firstAllowedFloorTicketsPath(canView) || '/dashboard';
    return <Navigate to={fallback} replace />;
  }

  return children;
}

function FloorIndexRedirect() {
  const { canView } = usePermission();
  const path = firstAllowedFloorTicketsPath(canView);
  if (path) return <Navigate to={path.replace('/floor-pipeline/', '')} replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function FloorPipelineApp() {
  return (
    <Routes>
      <Route index element={<FloorIndexRedirect />} />
      <Route path="dashboard" element={g(FLOOR_DASHBOARD_SECTIONS, <FloorDashboardPage />)} />
      <Route
        path="tickets"
        element={g(
          FLOOR_TICKETS_BASE_SECTIONS,
          <FloorStageFilterGuard><FloorTicketListPage /></FloorStageFilterGuard>
        )}
      />
      <Route path="tickets/:id" element={g(FLOOR_TICKETS_BASE_SECTIONS, <TicketDetailPage />)} />
      <Route path="diagnosis-failed" element={g(FLOOR_DASHBOARD_SECTIONS, <DiagnosisFailedPage />)} />
      <Route
        path="pending-inventory"
        element={g(['inventory_management', 'floor_pipeline'], <PendingInventoryPage />)}
      />
      <Route path="vendor-repair-dc" element={g(FLOOR_DASHBOARD_SECTIONS, <VendorRepairDcListPage />)} />
      <Route path="vendor-repair-dc/:dcNumber" element={g(FLOOR_DASHBOARD_SECTIONS, <VendorRepairDcDetailPage />)} />
      <Route path="*" element={<FloorIndexRedirect />} />
    </Routes>
  );
}
