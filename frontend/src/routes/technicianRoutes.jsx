import React from 'react';
import { Navigate } from 'react-router-dom';
import TechnicianLayout from '../layout/TechnicianLayout';
import TechnicianProtectedRoute from '../router/TechnicianProtectedRoute';
import TechnicianLoginPage from '../pages/technician/TechnicianLoginPage';
import TechnicianAuthCallbackPage from '../pages/technician/TechnicianAuthCallbackPage';
import TechnicianDashboardPage from '../pages/technician/TechnicianDashboardPage';
import TechnicianProfilePage from '../pages/technician/TechnicianProfilePage';

const withTechnicianLayout = (node) => (
  <TechnicianProtectedRoute>
    <TechnicianLayout>{node}</TechnicianLayout>
  </TechnicianProtectedRoute>
);

export const technicianRoutes = [
  { path: '/technician', element: <Navigate to="/technician/login" replace /> },
  { path: '/technician/login', element: <TechnicianLoginPage /> },
  { path: '/technician/auth/callback', element: <TechnicianAuthCallbackPage /> },
  { path: '/technician/dashboard', element: withTechnicianLayout(<TechnicianDashboardPage />) },
  { path: '/technician/profile', element: withTechnicianLayout(<TechnicianProfilePage />) },
];
