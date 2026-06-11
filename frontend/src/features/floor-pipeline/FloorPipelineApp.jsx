import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import FloorTicketListPage from './pages/FloorTicketListPage';
import FloorDashboardPage from './pages/FloorDashboardPage';
import TicketDetailPage from './pages/TicketDetailPage';

export default function FloorPipelineApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="tickets" replace />} />
      <Route path="dashboard" element={<FloorDashboardPage />} />
      <Route path="tickets" element={<FloorTicketListPage />} />
      <Route path="tickets/:id" element={<TicketDetailPage />} />
      <Route path="*" element={<Navigate to="tickets" replace />} />
    </Routes>
  );
}
