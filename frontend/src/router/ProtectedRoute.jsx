// Protected Route - allows access by role OR by permission
import { useAuth } from '../context/AuthContext';
import { useLocation, Navigate } from 'react-router-dom';
import { isSupportTechnician, canAccessCustomerInventory } from '../utils/supportAccess';

export default function ProtectedRoute({ children, allowedRoles, allowedPermissions }) {
    const { isAuthenticated, user, loading } = useAuth();
    const location = useLocation();
    if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    if (!isAuthenticated) return <Navigate to="/login" />;
    const perms = Array.isArray(user?.permissions) ? user.permissions : [];
    const hasRole = !allowedRoles || (user && allowedRoles.includes(user.role));
    const hasPermission = !allowedPermissions || allowedPermissions.some(p => perms.includes(p));
    if (!hasRole && !hasPermission) {
      return <Navigate to="/dashboard" />;
    }
    if (isSupportTechnician(user)) {
      const customerInvOk = location.pathname.startsWith('/customer-inventory') && canAccessCustomerInventory(user);
      if (!location.pathname.startsWith('/support') && !customerInvOk) {
        return <Navigate to="/support/my-tickets" replace />;
      }
    }
    return children;
  }