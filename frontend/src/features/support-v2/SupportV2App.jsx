import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';
import SupportV2Shell from './SupportV2Shell';
import FoundationPage from './pages/FoundationPage';
import TaxonomyAdminPage from './pages/TaxonomyAdminPage';
import SlaAdminPage from './pages/SlaAdminPage';
import TicketQueuePage from './pages/TicketQueuePage';
import CommandCentrePage from './pages/CommandCentrePage';
import NewTicketPage from './pages/NewTicketPage';
import TicketDetailPage from './pages/TicketDetailPage';
import JobExecutionPage from './pages/JobExecutionPage';
import BucketPage from './pages/BucketPage';
import DispatchBoardPage from './pages/DispatchBoardPage';
import BulkReturnPage from './pages/BulkReturnPage';
import WarehouseReceiptPage from './pages/WarehouseReceiptPage';
import PartsQueuePage from './pages/PartsQueuePage';
import ApprovalsPage from './pages/ApprovalsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import SupportV2IndexRedirect from './SupportV2IndexRedirect';

const g = (section, node) => <ProtectedRoute section={section} action="view">{node}</ProtectedRoute>;

export default function SupportV2App() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return (
    <Routes>
      <Route element={<SupportV2Shell />}>
        <Route index element={<SupportV2IndexRedirect />} />
        <Route path="dashboard" element={g('support_dashboard', <CommandCentrePage />)} />
        <Route path="queue" element={g('support_tickets', <TicketQueuePage />)} />
        <Route path="tickets/new" element={g('support_tickets', <NewTicketPage />)} />
        <Route path="returns/bulk" element={<ProtectedRoute section="support_pickup_return" action="create"><BulkReturnPage /></ProtectedRoute>} />
        <Route path="returns/receipt/:woId" element={<ProtectedRoute section="support_pickup_return" action="view"><WarehouseReceiptPage /></ProtectedRoute>} />
        <Route path="returns/receipt" element={<ProtectedRoute section="support_pickup_return" action="view"><WarehouseReceiptPage /></ProtectedRoute>} />
        <Route path="tickets/:id" element={g('support_tickets', <TicketDetailPage />)} />
        <Route path="jobs/:woId" element={<ProtectedRoute sections={['support_bucket', 'support_work_orders']} action="view"><JobExecutionPage /></ProtectedRoute>} />
        <Route path="dispatch" element={g('support_dispatch', <DispatchBoardPage />)} />
        <Route path="bucket" element={g('support_bucket', <BucketPage />)} />
        <Route path="parts" element={g('support_parts_approve', <PartsQueuePage />)} />
        <Route path="approvals" element={g('support_approvals', <ApprovalsPage />)} />
        <Route path="sla" element={g('support_sla_admin', <SlaAdminPage />)} />
        <Route path="taxonomy" element={g('support_taxonomy', <TaxonomyAdminPage />)} />
        <Route path="reports" element={g('support_reports', <ReportsPage />)} />
        <Route path="settings" element={g('support_settings', <SettingsPage />)} />
        <Route path="foundation" element={g('support_settings', <FoundationPage />)} />
        <Route path="*" element={<SupportV2IndexRedirect />} />
      </Route>
    </Routes>
  );
}
