import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isSupportLead, isSupportTechnician } from '../../utils/supportAccess';
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
import TechnicianBucketPage from '../../features/sales-pipeline/pages/TechnicianBucketPage';
import SupportTechBucketPage from '../../features/support/pages/SupportTechBucketPage';
import SupportPartsQueuePage from '../../features/support/pages/SupportPartsQueuePage';
import ChallanViewPage from '../../features/support/pages/ChallanViewPage';

function SupportHomeRedirect() {
  const { user } = useAuth();
  if (isSupportTechnician(user) && !isSupportLead(user)) {
    return <Navigate to="/support/my-tickets" replace />;
  }
  return <Navigate to="/support/overview" replace />;
}

function LeadOnly({ children }) {
  const { user } = useAuth();
  if (!isSupportLead(user)) return <Navigate to="/support/overview" replace />;
  return children;
}

function StatsOnly({ children }) {
  const { user } = useAuth();
  if (!['super_admin', 'admin', 'manager', 'support_lead'].includes(user?.role)) {
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

export default function SupportApp() {
  return (
    <Routes>
      <Route element={<SupportShell />}>
        <Route index element={<SupportHomeRedirect />} />
        <Route path="overview" element={<SupportOverviewPage />} />
        <Route path="dashboard" element={<Navigate to="/support/overview" replace />} />
        <Route path="stats" element={<StatsOnly><SupportStatsPage /></StatsOnly>} />
        <Route path="tickets" element={<SupportTicketsView view="all" splitSections showFilters enhancedList />} />
        <Route path="pending-assign" element={<SupportTicketsView view="pending_assign" showFilters />} />
        <Route path="overdue" element={<SupportTicketsView view="overdue" showFilters />} />
        <Route path="pickups" element={<SupportTicketsView view="pickups" showFilters />} />
        <Route path="complaints" element={<SupportTicketsView view="complaints" showFilters />} />
        <Route path="my-tickets" element={<SupportTicketsView view="my_open" showFilters />} />
        <Route path="my-pickups" element={<MyDeliveriesPage movement="return" />} />
        <Route path="pickup-bucket" element={<StatsOnly><TechnicianBucketPage movement="return" /></StatsOnly>} />
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
