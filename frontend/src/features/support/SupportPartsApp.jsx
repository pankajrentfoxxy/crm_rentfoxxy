import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import SupportTechBucketPage from './pages/SupportTechBucketPage';
import SupportPartsQueuePage from './pages/SupportPartsQueuePage';
import ChallanViewPage from './pages/ChallanViewPage';
import PartCustomerDcViewPage from './pages/PartCustomerDcViewPage';

/**
 * Standalone (global-layout) routing for the support parts bucket / challan flow.
 * Mounted at /support-parts/* so warehouse staff (who are not part of the support
 * module) can reach the warehouse queue and challan signing without the support
 * shell. Support staff also reach the same pages inside the support shell.
 */
export default function SupportPartsApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="queue" replace />} />
      <Route path="queue" element={<SupportPartsQueuePage />} />
      <Route path="parts-queue" element={<Navigate to="/support-parts/queue" replace />} />
      <Route path="tech-bucket" element={<SupportTechBucketPage />} />
      <Route path="bucket" element={<Navigate to="/support-parts/tech-bucket" replace />} />
      <Route path="challans/:challanId" element={<ChallanViewPage />} />
      <Route path="part-dcs/:dcNumber" element={<PartCustomerDcViewPage />} />
      <Route path="*" element={<Navigate to="queue" replace />} />
    </Routes>
  );
}
