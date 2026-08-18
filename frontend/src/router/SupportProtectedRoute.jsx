import { useAuth } from '../context/AuthContext';
import { canAccessSupportModule } from '../utils/supportAccess';
import { Navigate } from 'react-router-dom';

export default function SupportProtectedRoute({ children, leadOnly }) {
  const { isAuthenticated, user, loading, effectivePermissions } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (!canAccessSupportModule(user, effectivePermissions)) {
    return <Navigate to="/dashboard" replace />;
  }
  if (leadOnly && user.role === 'support_tech') {
    return <Navigate to="/support-legacy/my-tickets" replace />;
  }
  return children;
}
