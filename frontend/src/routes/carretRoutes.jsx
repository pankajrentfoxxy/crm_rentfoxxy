import React from 'react';

/**
 * Carret routes, behind REACT_APP_CARRET.
 *
 * With the flag off this array is empty, so the router is byte-identical to
 * what it is today — acceptance test 9: REACT_APP_CARRET=0 returns the app to
 * its current state completely. Nothing existing is replaced or removed; the
 * new asset record sits beside the old one at its own path.
 */
const AssetRecordPage = React.lazy(() => import('../features/carret/AssetRecordPage'));

export const CARRET_ENABLED = process.env.REACT_APP_CARRET === '1';

const withSuspense = (node) => (
  <React.Suspense fallback={null}>{node}</React.Suspense>
);

export const carretRoutes = CARRET_ENABLED
  ? [
      { path: '/carret/stock/assets/:ttspl', element: withSuspense(<AssetRecordPage />) },
    ]
  : [];

export default carretRoutes;
