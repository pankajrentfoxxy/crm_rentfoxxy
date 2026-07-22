const pool = require('../config/db');
const {
  getWorkflow,
  acceptOrder,
  listDispatchDashboard,
  listPendingOrders,
  listPendingAssignmentAlerts,
  listPendingQcAlerts,
  snoozeAssignmentAlert,
  snoozeQcAlert,
  postStartWorkflowNotifications,
} = require('../services/dispatchWorkflowService');
const { searchAvailableInventory } = require('../services/salesManagementService');

exports.getMatchingInventory = async (req, res) => {
  try {
    const serials = await searchAvailableInventory({
      brand: req.query.brand,
      model_name: req.query.model_name || req.query.model,
      processor: req.query.processor,
      generation: req.query.generation,
      ram: req.query.ram,
      storage: req.query.storage,
      quotation_type: req.query.quotation_type,
      search: req.query.search,
      limit: req.query.limit,
    });
    res.json({ success: true, serials });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listPendingAlerts = async (req, res) => {
  try {
    const alerts = await listPendingAssignmentAlerts({
      userId: req.user.user_id,
      role: req.user.role,
    });
    res.json({ success: true, alerts, total: alerts.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listPendingQcAlerts = async (req, res) => {
  try {
    const alerts = await listPendingQcAlerts({
      userId: req.user.user_id,
    });
    res.json({ success: true, alerts, total: alerts.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.snoozeQcAlert = async (req, res) => {
  const client = await pool.connect();
  try {
    const so = req.params.salesOrderNumber;
    const { remark, snoozeMinutes } = req.body || {};
    await client.query('BEGIN');
    const result = await snoozeQcAlert(client, {
      salesOrderNumber: so,
      userId: req.user.user_id,
      remark,
      snoozeMinutes,
      user: req.user,
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    await client.query('COMMIT');
    const { emitQcSnoozed } = require('../services/dispatchSocketService');
    await emitQcSnoozed(so);
    res.json({
      success: true,
      snoozed_until: result.snoozed_until,
      snooze_minutes: result.snooze_minutes,
      remark: result.remark,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

exports.snoozeAlert = async (req, res) => {
  const client = await pool.connect();
  try {
    const so = req.params.salesOrderNumber;
    const { remark, snoozeMinutes } = req.body || {};
    await client.query('BEGIN');
    const result = await snoozeAssignmentAlert(client, {
      salesOrderNumber: so,
      userId: req.user.user_id,
      remark,
      snoozeMinutes,
      user: req.user,
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    await client.query('COMMIT');
    const { emitSnoozed } = require('../services/dispatchSocketService');
    await emitSnoozed(so);
    res.json({
      success: true,
      snoozed_until: result.snoozed_until,
      snooze_minutes: result.snooze_minutes,
      remark: result.remark,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

exports.listPendingOrders = async (req, res) => {
  try {
    const orders = await listPendingOrders({
      userId: req.user.user_id,
      role: req.user.role,
    });
    res.json({ success: true, orders, total: orders.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getWorkflow = async (req, res) => {
  try {
    const so = req.params.salesOrderNumber;
    const wf = await getWorkflow(null, so);
    if (!wf) return res.status(404).json({ success: false, message: 'Workflow not found' });
    res.json({ success: true, workflow: wf });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.acceptWorkflow = async (req, res) => {
  const client = await pool.connect();
  try {
    const so = req.params.salesOrderNumber;
    await client.query('BEGIN');
    const result = await acceptOrder(client, {
      salesOrderNumber: so,
      userId: req.user.user_id,
      user: req.user,
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    await client.query('COMMIT');
    res.json({ success: true, workflow: result.workflow, noop: result.noop || false });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};

exports.listDashboard = async (req, res) => {
  try {
    const rows = await listDispatchDashboard({
      userId: req.user.user_id,
      role: req.user.role,
    });
    res.json({ success: true, workflows: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.postStartNotifications = postStartWorkflowNotifications;
