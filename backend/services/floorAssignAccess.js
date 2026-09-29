/**
 * Who may give a production (floor) ticket to someone else, or reassign it:
 * the floor-lead roles (qcGateService MANAGER_ROLES — floor_manager, manager,
 * admin, super_admin), or anyone granted "floor_ticket_assign" edit in Roles &
 * Permissions (migration 409, seeded to exactly those roles).
 */
const { isManager } = require('./qcGateService');
const { hasPermission } = require('./permissionService');

async function canAssignFloorTickets(req) {
  if (!req?.user) return false;
  if (isManager(req.user)) return true;
  if (!req.permissionCache) req.permissionCache = {};
  return hasPermission(req.user.user_id, req.user.role, 'floor_ticket_assign', 'edit', req.permissionCache);
}

module.exports = { canAssignFloorTickets };
