import React from 'react';
import { Navigate } from 'react-router-dom';
import usePermission from '../../hooks/usePermission';
import { isSupportTechnician } from '../../utils/supportAccess';

const LANDING = [
  { section: 'support_dashboard', to: 'dashboard' },
  { section: 'support_tickets', to: 'queue' },
  { section: 'support_dispatch', to: 'dispatch' },
  { section: 'support_parts_approve', to: 'parts' },
  { section: 'support_approvals', to: 'approvals' },
  { section: 'support_bucket', to: 'bucket' },
  { section: 'support_reports', to: 'reports' },
  { section: 'support_sla_admin', to: 'sla' },
  { section: 'support_taxonomy', to: 'taxonomy' },
  { section: 'support_settings', to: 'settings' },
];

export default function SupportV2IndexRedirect() {
  const { canView, user } = usePermission();
  if (isSupportTechnician(user)) return <Navigate to="bucket" replace />;
  const first = LANDING.find((x) => canView(x.section));
  return <Navigate to={first?.to || '/dashboard'} replace />;
}
