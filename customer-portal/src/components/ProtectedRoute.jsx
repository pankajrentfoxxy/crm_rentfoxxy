import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="p-12 text-center text-slate-500">Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
