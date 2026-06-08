import { usePermission } from '../hooks/usePermission';

/**
 * Conditionally render children when user has section permission.
 * action: view | create | edit | delete
 */
export default function PermissionGate({ section, action = 'view', children, fallback = null }) {
  const { hasPermission } = usePermission();
  if (!section || hasPermission(section, action)) {
    return children;
  }
  return fallback;
}
