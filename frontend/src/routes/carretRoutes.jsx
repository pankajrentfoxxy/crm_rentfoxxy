import React from 'react';
import ProtectedRoute from '../router/ProtectedRoute';

/**
 * Carret routes, behind REACT_APP_CARRET.
 *
 * With the flag off this array is empty, so the router is byte-identical to
 * what it is today — acceptance test 9: REACT_APP_CARRET=0 returns the app to
 * its current state completely. Nothing existing is replaced or removed; the
 * new asset record sits beside the old one at its own path.
 *
 * Guarded on (inventory_management, view), the same section the Stock → Assets
 * navigation entry carries. Hard rule 8: every route declares its section and
 * action, and no route ships without permission middleware. This page renders
 * fixture data today but Part 2.7 wires it to the real asset, so shipping it
 * unguarded would be a page of customer and vendor detail reachable by anyone
 * with the URL.
 */
const AssetRecordPage = React.lazy(() => import('../features/carret/AssetRecordPage'));

export const CARRET_ENABLED = process.env.REACT_APP_CARRET === '1';

const guard = (section, action, node) => (
  <ProtectedRoute section={section} action={action}>
    <React.Suspense fallback={null}>{node}</React.Suspense>
  </ProtectedRoute>
);

export const carretRoutes = CARRET_ENABLED
  ? [
      {
        path: '/carret/stock/assets/:ttspl',
        element: guard('inventory_management', 'view', <AssetRecordPage />),
      },
    ]
  : [];

export default carretRoutes;
