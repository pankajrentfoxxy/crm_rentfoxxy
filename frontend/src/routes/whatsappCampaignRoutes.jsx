import React from 'react';
import Layout from '../layout/Layout';
import ProtectedRoute from '../router/ProtectedRoute';
import CampaignListPage from '../features/whatsapp-campaigns/pages/CampaignListPage';
import CampaignCreatePage from '../features/whatsapp-campaigns/pages/CampaignCreatePage';
import CampaignDetailPage from '../features/whatsapp-campaigns/pages/CampaignDetailPage';

const guard = (action, node) => (
  <ProtectedRoute section="whatsapp_campaigns" action={action}>
    <Layout>{node}</Layout>
  </ProtectedRoute>
);

export const whatsappCampaignRoutes = [
  { path: '/whatsapp-campaigns', element: guard('view', <CampaignListPage />) },
  { path: '/whatsapp-campaigns/new', element: guard('create', <CampaignCreatePage />) },
  { path: '/whatsapp-campaigns/:id', element: guard('view', <CampaignDetailPage />) },
];
