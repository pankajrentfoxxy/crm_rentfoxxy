import React from 'react';
import ProtectedRoute from '../../router/ProtectedRoute';

/**
 * Carret — parts disposal (builder 9, wave 2).
 *
 * Movement → Dead parts — in & out stays at /carret/move/part-inward (already
 * in carretRoutes.jsx, physical_dead_parts view); it now also holds the
 * outward list. This file adds its outward record (Part DC) page.
 * Stock → Scrap → Discarded parts is a tab of /carret/stock/scrap — no new route.
 *
 * Guard = the section the API enforces: routes/physicalDeadParts.js reads
 * with physical_dead_parts view (approve / cancel additionally need create +
 * a warehouse role or physical_dead_parts edit; the page hides those buttons).
 *
 * `partsDisposalRouteDefs` is the plain list ({ path, section|sections,
 * action, element }); the default export is the same list wrapped the way
 * carretRoutes.jsx wraps (ProtectedRoute + Suspense), ready to spread.
 */
const PartOutwardRecordPage = React.lazy(() => import('../../features/carret/move/PartOutwardRecordPage'));

export const partsDisposalRouteDefs = [
  { path: '/carret/move/part-inward/outwards/:outwardNumber', section: 'physical_dead_parts', action: 'view', element: <PartOutwardRecordPage /> },
];

const wrap = ({ path, section, sections, action, element }) => ({
  path,
  element: (
    <ProtectedRoute {...(sections ? { sections } : { section })} action={action}>
      <React.Suspense fallback={null}>{element}</React.Suspense>
    </ProtectedRoute>
  ),
});

export const partsDisposalRoutes = partsDisposalRouteDefs.map(wrap);
export default partsDisposalRoutes;
