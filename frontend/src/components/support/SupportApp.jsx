import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isSupportLead, isSupportTechnician } from '../../utils/supportAccess';
import SupportShell from './SupportShell';
import SupportDashboard from './SupportDashboard';
import SupportTicketsView from './SupportTicketsView';
import SupportTicketCreate from './SupportTicketCreate';
import SupportTicketDetail from './SupportTicketDetail';
import SupportSettings from './SupportSettings';
import SupportTechnicians from './SupportTechnicians';

function SupportHomeRedirect() {
  const { user } = useAuth();
  if (isSupportTechnician(user) && !isSupportLead(user)) {
    return <Navigate to="/support/my-tickets" replace />;
  }
  return <Navigate to="/support/dashboard" replace />;
}

function LeadOnly({ children }) {
  const { user } = useAuth();
  if (!isSupportLead(user)) return <Navigate to="/support/dashboard" replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/support/dashboard" replace />;
  return children;
}

export default function SupportApp() {
  return (
    <Routes>
      <Route element={<SupportShell />}>
        <Route index element={<SupportHomeRedirect />} />
        <Route path="dashboard" element={<SupportDashboard />} />
        <Route path="tickets" element={<SupportTicketsView view="all" splitSections showFilters />} />
        <Route path="pending-assign" element={<SupportTicketsView view="pending_assign" showFilters />} />
        <Route path="overdue" element={<SupportTicketsView view="overdue" showFilters />} />
        <Route path="pickups" element={<SupportTicketsView view="pickups" showFilters />} />
        <Route path="complaints" element={<SupportTicketsView view="complaints" showFilters />} />
        <Route path="my-tickets" element={<SupportTicketsView view="my_open" showFilters />} />
        <Route path="my-resolved" element={<SupportTicketsView view="my_resolved" showFilters />} />
        <Route path="technicians" element={<LeadOnly><SupportTechnicians /></LeadOnly>} />
        <Route path="settings" element={<AdminOnly><SupportSettings /></AdminOnly>} />
        <Route path="tickets/new" element={<LeadOnly><SupportTicketCreate /></LeadOnly>} />
        <Route path="tickets/:ticketId" element={<SupportTicketDetail />} />
        <Route path="*" element={<SupportHomeRedirect />} />
      </Route>
    </Routes>
  );
}
