import React from 'react';
import { Navigate } from 'react-router-dom';
import ProtectedRoute from '../../router/ProtectedRoute';

/**
 * Today dashboard (claude/pending.md item 11), behind REACT_APP_CARRET like the
 * other Carret routes.
 *
 * /carret/home is the dashboard. It carries no section guard, like the home it
 * replaces: every tile is gated on its own section (page + API), and a user
 * with no tile at all is sent to the first new-UI screen they may open.
 * /carret (the old Operations page) now opens the dashboard.
 *
 * The lead removes the two existing entries for these paths from
 * routes/carretRoutes.jsx ('/carret' → OperationsOverviewPage and
 * '/carret/home' → NewUiHomePage) when wiring this array in.
 */
// Read the flag here rather than importing it from carretRoutes.jsx, which will
// import this file (a cycle would leave it undefined at load).
// eslint-disable-next-line no-undef
const CARRET_ENABLED = process.env.REACT_APP_CARRET === '1';

const TodayDashboardPage = React.lazy(() => import('../../features/carret/dashboard/TodayDashboardPage'));

export const dashboardRoutes = CARRET_ENABLED
  ? [
      // Login only: the page shows just the tiles this user may see.
      { path: '/carret/home', element: <ProtectedRoute><React.Suspense fallback={null}><TodayDashboardPage /></React.Suspense></ProtectedRoute> },
      { path: '/carret', element: <Navigate to="/carret/home" replace /> },
    ]
  : [];

export default dashboardRoutes;
