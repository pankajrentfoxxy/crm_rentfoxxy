import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import RolesPage from '../pages/admin/settings/RolesPage';
import RolePermissionsPage from '../pages/admin/settings/RolePermissionsPage';
import UserPermissionsPage from '../pages/admin/settings/UserPermissionsPage';
import UserManagementPage from '../pages/admin/settings/UserManagementPage';
import RoleReferencePage from '../pages/admin/settings/RoleReferencePage';

const withLayout = (node) => <Layout>{node}</Layout>;

function guard(section, action, element) {
  return <ProtectedRoute section={section} action={action}>{element}</ProtectedRoute>;
}

export const settingsRoutes = [
  { path: '/settings/users', element: guard('users', 'view', withLayout(<UserManagementPage />)) },
  { path: '/settings/roles', element: guard('roles', 'view', withLayout(<RolesPage />)) },
  { path: '/settings/role-permissions', element: guard('role_permissions', 'view', withLayout(<RolePermissionsPage />)) },
  { path: '/settings/user-permissions', element: guard('user_permissions', 'view', withLayout(<UserPermissionsPage />)) },
  { path: '/settings/role-reference', element: withLayout(<RoleReferencePage />) },
];
