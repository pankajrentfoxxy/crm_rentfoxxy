/**
 * Allow dispatch users to read/manage SOs assigned to them in dispatch_workflow,
 * without granting full sales_orders list access.
 */
const pool = require('../config/db');
const { hasPermission } = require('../services/permissionService');
const {
  SO_VIEW_SECTIONS,
  SO_SERIAL_EDIT_SECTIONS,
  SO_SERIAL_VIEW_SECTIONS,
  assertReplacementSalesOrderAccessIfScoped,
} = require('../services/dataScopeService');

async function userHasDispatchSoAccess(userId, soNumber) {
  if (!userId || !soNumber) return false;
  const r = await pool.query(
    `SELECT 1 FROM dispatch_workflow dw
      WHERE dw.sales_order_number = $1
        AND dw.status <> 'waiting_acceptance'
        AND (dw.assigned_user_id = $2 OR dw.accepted_by = $2)
      LIMIT 1`,
    [soNumber, userId]
  );
  return r.rows.length > 0;
}

function resolveSoNumber(req) {
  return req.params.soNumber
    || req.params.salesOrderNumber
    || req.soNumber
    || null;
}

async function hasAnySectionPermission(req, sections, action) {
  if (!req.user) return false;
  if (req.user.role === 'super_admin') return true;
  if (!req.permissionCache) req.permissionCache = {};
  for (const section of sections) {
    // eslint-disable-next-line no-await-in-loop
    const allowed = await hasPermission(
      req.user.user_id,
      req.user.role,
      section,
      action,
      req.permissionCache
    );
    if (allowed) return true;
  }
  return false;
}

/** SO read routes: sales permissions OR assigned dispatch user. */
function checkSoViewOrAssignedDispatch(req, res, next) {
  (async () => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (req.user.role === 'super_admin') return next();

    const salesAllowed = await hasAnySectionPermission(req, SO_SERIAL_VIEW_SECTIONS, 'can_view');
    if (salesAllowed) {
      const soNumber = resolveSoNumber(req);
      if (soNumber) {
        try {
          await assertReplacementSalesOrderAccessIfScoped(
            soNumber,
            req.user,
            req.permissionCache
          );
        } catch (err) {
          return res.status(err.status || 403).json({ success: false, message: err.message });
        }
      }
      return next();
    }

    const dispatchAllowed = await hasAnySectionPermission(
      req,
      ['dispatch_workflow', 'dispatch_pending_orders'],
      'can_view'
    );
    if (!dispatchAllowed) {
      return res.status(403).json({ success: false, message: 'Permission denied' });
    }

    const soNumber = resolveSoNumber(req);
    if (!soNumber) {
      return res.status(400).json({ success: false, message: 'Sales order number required' });
    }
    const assigned = await userHasDispatchSoAccess(req.user.user_id, soNumber);
    if (!assigned) {
      return res.status(403).json({
        success: false,
        message: 'This sales order is not assigned to you for dispatch',
      });
    }
    req.dispatchSoAccess = true;
    return next();
  })().catch((err) => {
    console.error('checkSoViewOrAssignedDispatch:', err);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  });
}

/** Serial attach/QC routes: sales/DC permissions OR assigned dispatch user (edit). */
function checkSoSerialOrAssignedDispatch(req, res, next) {
  (async () => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (req.user.role === 'super_admin') return next();

    const salesAllowed = await hasAnySectionPermission(
      req,
      SO_SERIAL_EDIT_SECTIONS,
      'can_edit'
    );
    if (salesAllowed) {
      const soNumber = resolveSoNumber(req);
      if (soNumber) {
        try {
          await assertReplacementSalesOrderAccessIfScoped(
            soNumber,
            req.user,
            req.permissionCache
          );
        } catch (err) {
          return res.status(err.status || 403).json({ success: false, message: err.message });
        }
      }
      return next();
    }

    const dispatchAllowed = await hasAnySectionPermission(
      req,
      ['dispatch_workflow', 'dispatch_pending_orders'],
      'can_edit'
    );
    if (!dispatchAllowed) {
      return res.status(403).json({ success: false, message: 'Permission denied' });
    }

    const soNumber = resolveSoNumber(req);
    if (!soNumber) {
      return res.status(400).json({ success: false, message: 'Sales order number required' });
    }
    const assigned = await userHasDispatchSoAccess(req.user.user_id, soNumber);
    if (!assigned) {
      return res.status(403).json({
        success: false,
        message: 'This sales order is not assigned to you for dispatch',
      });
    }
    req.dispatchSoAccess = true;
    return next();
  })().catch((err) => {
    console.error('checkSoSerialOrAssignedDispatch:', err);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  });
}

module.exports = {
  checkSoViewOrAssignedDispatch,
  checkSoSerialOrAssignedDispatch,
  userHasDispatchSoAccess,
};
