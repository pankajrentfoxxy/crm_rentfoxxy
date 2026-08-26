import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isSupportLead, canCancelSupportTicket, isAssignedTicketsOnly } from '../../utils/supportAccess';
import CancelledTicketsPage from './CancelledTicketsPage';
import SupportShell from './SupportShell';
import SupportDashboard from './SupportDashboard';
import SupportOverviewPage from '../../features/support-module/pages/SupportOverviewPage';
import SupportStatsPage from '../../features/support-module/pages/SupportStatsPage';
import SupportTicketsView from './SupportTicketsView';
import SupportTicketCreate from './SupportTicketCreate';
import SupportTicketDetail from './SupportTicketDetail';
import SupportSettings from './SupportSettings';
import SupportTechnicians from './SupportTechnicians';
import MyDeliveriesPage from '../../features/sales-pipeline/pages/MyDeliveriesPage';
import TechnicianDeliveryBucketPage from '../../features/sales-pipeline/pages/TechnicianDeliveryBucketPage';
import SupportTechBucketPage from '../../features/support/pages/SupportTechBucketPage';
import SupportPartsQueuePage from '../../features/support/pages/SupportPartsQueuePage';
import SupportRequestsPage from '../../features/support/pages/SupportRequestsPage';
import ChallanViewPage from '../../features/support/pages/ChallanViewPage';

function SupportHomeRedirect() {
  const { user, isAssignedDataOnly } = useAuth();
  if (isAssignedTicketsOnly(user, isAssignedDataOnly)) {
    return <Navigate to="/support/my-tickets" replace />;
  }
  return <Navigate to="/support/overview" replace />;
}

function AssignedQueueBlock({ children }) {
  const { user, isAssignedDataOnly } = useAuth();
  if (isAssignedTicketsOnly(user, isAssignedDataOnly)) {
    return <Navigate to="/support/my-tickets" replace />;
  }
  return children;
}

function LeadOnly({ children }) {
  const { user, isAssignedDataOnly } = useAuth();
  if (isAssignedTicketsOnly(user, isAssignedDataOnly) || !isSupportLead(user)) {
    return <Navigate to={isAssignedTicketsOnly(user, isAssignedDataOnly) ? '/support/my-tickets' : '/support/overview'} replace />;
  }
  return children;
}

function StatsOnly({ children }) {
  const { user } = useAuth();
  if (!isSupportLead(user)) {
    return <Navigate to="/support/overview" replace />;
  }
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/support/overview" replace />;
  return children;
}

function PartsQueueOnly({ children }) {
  const { user } = useAuth();
  if (!['warehouse', 'admin', 'manager', 'support_lead', 'super_admin'].includes(user?.role)) {
    return <Navigate to="/support/overview" replace />;
  }
  return children;
}

function CancelSectionOnly({ children }) {
  const { user } = useAuth();
  if (!canCancelSupportTicket(user)) return <Navigate to="/support/overview" replace />;
  return children;
}

export default function SupportApp() {
  return (
    <Routes>
      <Route element={<SupportShell />}>
        <Route index element={<SupportHomeRedirect />} />
        <Route path="overview" element={<AssignedQueueBlock><SupportOverviewPage /></AssignedQueueBlock>} />
        <Route path="dashboard" element={<Navigate to="/support/overview" replace />} />
        <Route path="stats" element={<StatsOnly><SupportStatsPage /></StatsOnly>} />
        <Route path="tickets" element={<AssignedQueueBlock><SupportTicketsView view="all" splitSections showFilters enhancedList /></AssignedQueueBlock>} />
        <Route path="requests" element={<AssignedQueueBlock><SupportRequestsPage /></AssignedQueueBlock>} />
        <Route path="pending-assign" element={<AssignedQueueBlock><SupportTicketsView view="pending_assign" showFilters /></AssignedQueueBlock>} />
        <Route path="overdue" element={<AssignedQueueBlock><SupportTicketsView view="overdue" showFilters /></AssignedQueueBlock>} />
        <Route path="pickups" element={<AssignedQueueBlock><SupportTicketsView view="pickups" showFilters /></AssignedQueueBlock>} />
        <Route path="complaints" element={<AssignedQueueBlock><SupportTicketsView view="complaints" showFilters /></AssignedQueueBlock>} />
        <Route path="cancelled-tickets" element={<CancelSectionOnly><CancelledTicketsPage /></CancelSectionOnly>} />
        <Route path="my-tickets" element={<SupportTicketsView view="my_open" showFilters />} />
        <Route path="my-pickups" element={<MyDeliveriesPage movement="return" />} />
        <Route path="pickup-bucket" element={<StatsOnly><TechnicianDeliveryBucketPage movement="return" /></StatsOnly>} />
        <Route path="my-resolved" element={<SupportTicketsView view="my_resolved" showFilters />} />
        <Route path="tech-bucket" element={<SupportTechBucketPage />} />
        <Route path="parts-queue" element={<PartsQueueOnly><SupportPartsQueuePage /></PartsQueueOnly>} />
        <Route path="challans/:challanId" element={<ChallanViewPage />} />
        <Route path="technicians" element={<LeadOnly><SupportTechnicians /></LeadOnly>} />
        <Route path="settings" element={<AdminOnly><SupportSettings /></AdminOnly>} />
        <Route path="tickets/new" element={<LeadOnly><SupportTicketCreate /></LeadOnly>} />
        <Route path="tickets/:ticketId" element={<SupportTicketDetail />} />
        <Route path="*" element={<SupportHomeRedirect />} />
      </Route>
    </Routes>
  );
}
