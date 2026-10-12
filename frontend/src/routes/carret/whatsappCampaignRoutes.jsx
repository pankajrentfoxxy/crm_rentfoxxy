import React from 'react';
import ProtectedRoute from '../../router/ProtectedRoute';

/**
 * Carret — Sell → Marketing → WhatsApp Campaigns (12 Oct 2026).
 *
 * The new-UI pages for the campaigns feature production added in the old UI
 * (features/whatsapp-campaigns, still routed at /whatsapp-campaigns). Guard =
 * the section routes/whatsappCampaigns.js enforces: whatsapp_campaigns view to
 * read, create to make one. Start / pause / cancel are gated inside the pages
 * on their own sub-sections, exactly as the old screens do.
 *
 * Same shape as partsDisposalRoutes.jsx: plain defs, then wrapped the way
 * carretRoutes.jsx wraps (ProtectedRoute + Suspense), ready to spread.
 */
const CampaignsPage = React.lazy(() => import('../../features/carret/sell/whatsapp/CampaignsPage'));
const NewCampaignPage = React.lazy(() => import('../../features/carret/sell/whatsapp/NewCampaignPage'));
const CampaignRecordPage = React.lazy(() => import('../../features/carret/sell/whatsapp/CampaignRecordPage'));

export const whatsappCampaignRouteDefs = [
  { path: '/carret/sell/whatsapp-campaigns', section: 'whatsapp_campaigns', action: 'view', element: <CampaignsPage /> },
  { path: '/carret/sell/whatsapp-campaigns/new', section: 'whatsapp_campaigns', action: 'create', element: <NewCampaignPage /> },
  { path: '/carret/sell/whatsapp-campaigns/:id', section: 'whatsapp_campaigns', action: 'view', element: <CampaignRecordPage /> },
];

const wrap = ({ path, section, action, element }) => ({
  path,
  element: (
    <ProtectedRoute section={section} action={action}>
      <React.Suspense fallback={null}>{element}</React.Suspense>
    </ProtectedRoute>
  ),
});

export const whatsappCampaignCarretRoutes = whatsappCampaignRouteDefs.map(wrap);
export default whatsappCampaignCarretRoutes;
