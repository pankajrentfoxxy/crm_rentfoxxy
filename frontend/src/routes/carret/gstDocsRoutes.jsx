import React from 'react';
import ProtectedRoute from '../../router/ProtectedRoute';

/**
 * Finance → GST & e-way (Builder 3, 29 Sep 2026). The lead spreads this array
 * into carretRoutes (behind REACT_APP_CARRET).
 *
 * Both pages read /api/finance-overview/*, which enforces einvoice_ewb view —
 * the guard is that section, nothing wider. The write buttons inside are shown
 * only to users the write endpoints accept (see InvoiceQueuePage).
 */
const InvoiceQueuePage = React.lazy(() => import('../../features/carret/money/gst/InvoiceQueuePage'));
const EwayBillsPage = React.lazy(() => import('../../features/carret/money/gst/EwayBillsPage'));

const guard = (section, action, node) => (
  <ProtectedRoute section={section} action={action}>
    <React.Suspense fallback={null}>{node}</React.Suspense>
  </ProtectedRoute>
);

export const gstDocsRoutes = [
  {
    path: '/carret/money/gst/queue',
    section: 'einvoice_ewb',
    action: 'view',
    element: guard('einvoice_ewb', 'view', <InvoiceQueuePage />),
  },
  {
    path: '/carret/money/gst/eway-bills',
    section: 'einvoice_ewb',
    action: 'view',
    element: guard('einvoice_ewb', 'view', <EwayBillsPage />),
  },
];

export default gstDocsRoutes;
