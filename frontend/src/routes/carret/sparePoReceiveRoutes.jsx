import React from 'react';
import ProtectedRoute from '../../router/ProtectedRoute';

/**
 * Carret — spare-parts PO receiving (builder 7). Replaces the old
 * /vendor-management/spare-parts-po/:spoId/receive screen (kept routed until
 * sign-off) on the same API.
 *
 * Guard = what the API enforces: GET
 * /vendor-management/spare-parts-orders/:spoId/product-received is
 * `authorizeSpareParts` — parts_procurement OR vendor_management, view
 * (routes/vendorManagement.js). Receiving (receive-bulk) needs edit and a new
 * GRN needs create on either section; the page hides those buttons otherwise.
 *
 * `sparePoReceiveRouteDefs` is the plain list; the default export is the same
 * list wrapped the way carretRoutes.jsx wraps (ProtectedRoute + Suspense).
 */
const SparePoReceivePage = React.lazy(() => import('../../features/carret/procure/SparePoReceivePage'));

const SPARE_PO_SECTIONS = ['vendor_management', 'parts_procurement'];

export const sparePoReceiveRouteDefs = [
  { path: '/carret/procure/spare-parts-orders/:spoId/receive', sections: SPARE_PO_SECTIONS, action: 'view', element: <SparePoReceivePage /> },
];

const wrap = ({ path, section, sections, action, element }) => ({
  path,
  element: (
    <ProtectedRoute {...(sections ? { sections } : { section })} action={action}>
      <React.Suspense fallback={null}>{element}</React.Suspense>
    </ProtectedRoute>
  ),
});

export const sparePoReceiveRoutes = sparePoReceiveRouteDefs.map(wrap);
export default sparePoReceiveRoutes;
