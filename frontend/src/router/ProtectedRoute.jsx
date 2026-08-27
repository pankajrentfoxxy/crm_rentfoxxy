import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocation, Navigate } from 'react-router-dom';
import { isSupportTechnician, supportTechnicianMayAccessPath } from '../utils/supportAccess';
import { hasPermission as checkPermission } from '../utils/permissionHelper';

/**
 * Section-based route guard.
 * Prefer section + action props. Legacy allowedRoles / allowedPermissions still supported.
 */
export default function ProtectedRoute({
  children,
  section,
  sections,
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

  if (Array.isArray(sections) && sections.length) {
    // Allow if the user can view ANY of the given sections (module umbrella guard).
    allowed = sections.some((s) => checkPermission(user, effectivePermissions, s, action));
  } else if (section) {
    allowed = checkPermission(user, effectivePermissions, section, action);
  } else if (allowedRoles || allowedPermissions) {
    const perms = Array.isArray(user?.permissions) ? user.permissions : [];
    const hasRole = !allowedRoles || (user && allowedRoles.includes(user.role));
    const hasLegacyPermission =
      !allowedPermissions || allowedPermissions.some((p) => perms.includes(p));
    allowed = hasRole || hasLegacyPermission;
  }

  if (!allowed) {
    if (user?.role === 'guard') {
      return <Navigate to="/guard" replace />;
    }
    return <Navigate to={fallback} replace />;
  }

  if (user?.role === 'guard' && !location.pathname.startsWith('/guard')) {
    return <Navigate to="/guard" replace />;
  }

  if (isSupportTechnician(user)) {
    const canViewSection = (s) => checkPermission(user, effectivePermissions, s, 'view');
    if (!supportTechnicianMayAccessPath(location.pathname, canViewSection)) {
      return <Navigate to="/support/my-tickets" replace />;
    }
  }

  return children;
}
