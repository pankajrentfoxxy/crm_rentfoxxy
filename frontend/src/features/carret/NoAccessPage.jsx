import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DeskShell from '../../shells/DeskShell';
import { Button, EmptyState } from '../../components/carret';

/**
 * Shown when a new-UI page refuses access (router/ProtectedRoute). It used to
 * send the user to the old /dashboard instead, which looked like a broken link
 * (15 Oct 2026: the floor ticket's Lifecycle link, for a floor manager).
 */
export default function NoAccessPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  return (
    <DeskShell title="No access" breadcrumb="">
      <EmptyState
        title="You don't have access to this page"
        body={`${state?.from ? `${state.from} needs a permission you don't have. ` : ''}Ask an admin to grant it in Control → Role permissions (or User permissions), or go back.`}
        action={(
          <div className="flex flex-wrap" style={{ gap: '8px', justifyContent: 'center' }}>
            <Button onClick={() => navigate(-1)}>Go back</Button>
            <Button variant="primary" onClick={() => navigate('/carret/home')}>Today</Button>
          </div>
        )}
      />
    </DeskShell>
  );
}
