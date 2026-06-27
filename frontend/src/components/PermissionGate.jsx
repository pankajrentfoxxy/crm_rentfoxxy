import { usePermission } from '../hooks/usePermission';

/**
 * Conditionally render children when user has section permission.
 * action: view | create | edit | delete
 */
export default function PermissionGate({ section, action = 'view', children, fallback = null }) {
  const { hasPermission } = usePermission();
  const allowed = !section
    ? true
    : Array.isArray(section)
      ? section.some((s) => hasPermission(s, action))
      : hasPermission(section, action);
  if (allowed) {
    return children;
  }
  return fallback;
}
