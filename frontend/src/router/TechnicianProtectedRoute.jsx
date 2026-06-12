import React from 'react';
import { Navigate } from 'react-router-dom';
import { useTechnicianAuth } from '../context/TechnicianAuthContext';

export default function TechnicianProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useTechnicianAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/technician/login" replace />;
  }

  return children;
}
