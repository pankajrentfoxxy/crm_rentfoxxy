import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import usePermission from '../../hooks/usePermission';
import FloorTicketListPage from './pages/FloorTicketListPage';
import FloorDashboardPage from './pages/FloorDashboardPage';
import TicketDetailPage from './pages/TicketDetailPage';

const g = (sections, node) => (
  <ProtectedRoute sections={sections} action="view">{node}</ProtectedRoute>
);

const FLOOR_TICKETS = ['floor_pipeline', 'floor_tickets'];
const CHIP_REPAIR = ['floor_pipeline', 'chip_level_repair', 'floor_tickets'];

function FloorIndexRedirect() {
  const { canView } = usePermission();
  if (canView('floor_tickets') || canView('floor_pipeline')) {
    return <Navigate to="tickets" replace />;
  }
  if (canView('chip_level_repair')) {
    return <Navigate to="tickets?stage=Chip+Level+Repair" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

export default function FloorPipelineApp() {
  return (
    <Routes>
      <Route index element={<FloorIndexRedirect />} />
      <Route path="dashboard" element={g(FLOOR_TICKETS, <FloorDashboardPage />)} />
      <Route path="tickets" element={g(CHIP_REPAIR, <FloorTicketListPage />)} />
      <Route path="tickets/:id" element={g(CHIP_REPAIR, <TicketDetailPage />)} />
      <Route path="*" element={<FloorIndexRedirect />} />
    </Routes>
  );
}
