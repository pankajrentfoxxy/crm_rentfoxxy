import { publicRoutes } from './publicRoutes';
import { salesRoutes } from './salesRoutes';
import { supportRoutes } from './supportRoutes';
import { warehouseRoutes } from './warehouseRoutes';
import { teamRoutes } from './teamRoutes';
import { settingsRoutes } from './settingsRoutes';

export const appRoutes = [
  ...publicRoutes,
  ...salesRoutes,
  ...supportRoutes,
  ...warehouseRoutes,
  ...teamRoutes,
  ...settingsRoutes,
];

export { publicRoutes, salesRoutes, supportRoutes, warehouseRoutes, teamRoutes, settingsRoutes };
