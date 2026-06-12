import { useAuth } from '../context/AuthContext';
import { hasPermission as checkPermission } from '../utils/permissionHelper';

export function usePermission() {
  const { user, effectivePermissions, refreshPermissions } = useAuth();

  const hasPermission = (section, action = 'view') =>
    checkPermission(user, effectivePermissions, section, action);

  const canView = (section) => hasPermission(section, 'view');
  const canCreate = (section) => hasPermission(section, 'create');
  const canEdit = (section) => hasPermission(section, 'edit');
  const canDelete = (section) => hasPermission(section, 'delete');

  return {
    user,
    effectivePermissions,
    hasPermission,
    canView,
    canCreate,
    canEdit,
    canDelete,
    refreshPermissions,
  };
}

export default usePermission;
