import React from 'react';
import { Navigate } from 'react-router-dom';
import { SECTIONS } from '../../config/navigation';
import { usePermission } from '../../hooks/usePermission';

/**
 * The single "New UI" entry in the old sidebar lands here. It opens the
 * Operations Overview for anyone who can see it, otherwise the first Carret
 * screen the user is allowed to open — so a technician or a guard is not sent
 * to a page that only says "access denied".
 */
export default function NewUiHomePage() {
  const { hasPermission } = usePermission();
  if (hasPermission('dashboard', 'view')) return <Navigate to="/carret" replace />;

  const allowed = (i) => (i.sections
    ? i.sections.some((sec) => hasPermission(sec, i.action))
    : hasPermission(i.section, i.action));
  const first = SECTIONS
    .flatMap((s) => s.items)
    .find((i) => i.to.startsWith('/carret/') && allowed(i));
  if (first) return <Navigate to={first.to} replace />;

  return (
    <div style={{ padding: 32, fontSize: 14 }}>
      No screen in the new interface is enabled for your role yet.
    </div>
  );
}
