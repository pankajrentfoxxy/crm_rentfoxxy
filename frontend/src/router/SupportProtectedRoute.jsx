import { useAuth } from '../context/AuthContext';
import { isSupportUser } from '../utils/supportAccess';
import { Navigate } from 'react-router-dom';

export default function SupportProtectedRoute({ children, leadOnly }) {
    const { isAuthenticated, user, loading } = useAuth();
    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    if (!isAuthenticated) return <Navigate to="/login" />;
    if (!isSupportUser(user)) return <Navigate to="/dashboard" />;
    if (leadOnly && user.role === 'support_tech') return <Navigate to="/support/my-tickets" replace />;
    return children;
  }