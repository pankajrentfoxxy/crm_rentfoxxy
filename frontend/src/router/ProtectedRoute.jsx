import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocation, Navigate } from 'react-router-dom';
import { isSupportTechnician, canAccessCustomerInventory } from '../utils/supportAccess';
import { hasPermission as checkPermission } from '../utils/permissionHelper';

/**
 * Section-based route guard.
 * Prefer section + action props. Legacy allowedRoles / allowedPermissions still supported.
 */
export default function ProtectedRoute({
  children,
  section,
  action = 'view',
  allowedRoles,
  allowedPermissions,
  fallback = '/dashboard',
}) {
  const { isAuthenticated, user, loading, effectivePermissions } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  let allowed = true;

  if (section) {
    allowed = checkPermission(user, effectivePermissions, section, action);
  } else if (allowedRoles || allowedPermissions) {
    const perms = Array.isArray(user?.permissions) ? user.permissions : [];
    const hasRole = !allowedRoles || (user && allowedRoles.includes(user.role));
    const hasLegacyPermission =
      !allowedPermissions || allowedPermissions.some((p) => perms.includes(p));
    allowed = hasRole || hasLegacyPermission;
  }

  if (!allowed) {
    return <Navigate to={fallback} replace />;
  }

  if (isSupportTechnician(user)) {
    const customerInvOk =
      location.pathname.startsWith('/customer-inventory') && canAccessCustomerInventory(user);
    if (!location.pathname.startsWith('/support') && !customerInvOk) {
      return <Navigate to="/support/my-tickets" replace />;
    }
  }

  return children;
}
