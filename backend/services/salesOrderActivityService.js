const pool = require('../config/db');

const ACTIVITY_TYPES = {
  SALES_ORDER: 'sales_order',
  CUSTOMER: 'customer',
  LAPTOP: 'laptop',
  PRICING: 'pricing',
  DELIVERY_CHALLAN: 'delivery_challan',
  PAYMENT: 'payment',
  DOCUMENT: 'document',
  DISPATCH: 'dispatch',
};

const ACTION_TITLES = {
  created: 'Sales Order Created',
  updated: 'Sales Order Updated',
  cancelled: 'Sales Order Cancelled',
  reopened: 'Sales Order Reopened',
  status_changed: 'Status Changed',
  notes_added: 'Notes Added',
  customer_changed: 'Customer Changed',
  billing_address_updated: 'Billing Address Updated',
  shipping_address_updated: 'Shipping Address Updated',
  gst_updated: 'GST Updated',
  payment_terms_updated: 'Payment Terms Updated',
  laptop_attached: 'Laptop Attached',
  laptop_removed: 'Laptop Removed',
  laptop_replaced: 'Laptop Replaced',
  configuration_updated: 'Configuration Updated',
  quantity_changed: 'Quantity Changed',
  item_price_changed: 'Item Price Changed',
  discount_added: 'Discount Added',
  discount_removed: 'Discount Removed',
  discount_updated: 'Discount Updated',
  tax_changed: 'Tax Changed',
  grand_total_updated: 'Grand Total Updated',
  dc_created: 'Delivery Challan Created',
  dc_cancelled: 'Delivery Challan Cancelled',
  dc_laptop_added: 'Laptop Added to DC',
  dc_laptop_removed: 'Laptop Removed from DC',
  dispatch_started: 'Dispatch Started',
  dispatch_completed: 'Dispatch Completed',
  assignee_changed: 'Assignee Changed',
  payment_added: 'Payment Added',
  payment_updated: 'Payment Updated',
  payment_deleted: 'Payment Deleted',
  payment_verified: 'Payment Verified',
  pdf_downloaded: 'PDF Downloaded',
  printed: 'Sales Order Printed',
  shared: 'Sales Order Shared',
  pdf_generated: 'PDF Generated',
  dispatch_assigned: 'Dispatch Assigned',
  dispatch_notification_sent: 'Dispatch Notification Sent',
  dispatch_accepted: 'Dispatch Accepted',
  laptop_available: 'Laptop Available',
  purchase_request_created: 'Purchase Request Created',
  purchase_request_received: 'Purchase Request Received',
  dispatch_qc_started: 'Dispatch QC Started',
  dispatch_qc_passed: 'Dispatch QC Passed',
  dispatch_qc_failed: 'Dispatch QC Failed',
  ready_for_dispatch: 'Ready for Dispatch',
  dispatch_reminder_sent: 'Dispatch Reminder Sent',
  dispatch_alert_snoozed: 'Dispatch Alert Snoozed',
  dispatch_qc_alert_snoozed: 'Dispatch QC Alert Snoozed',
  dispatch_qc_reminder_sent: 'Dispatch QC Reminder Sent',
  dispatch_qc_overdue: 'Dispatch QC Overdue',
  customer_asset_created: 'Customer Asset Created',
};

function actorFromUser(user = {}) {
  return {
    userId: user.user_id || user.userId || null,
    userName: user.name || user.userName || 'System',
    userRole: user.role || user.userRole || 'system',
  };
}

function resolveTitle(action, title) {
  if (title) return title;
  return ACTION_TITLES[action] || action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function logSalesOrderActivity({
  client = null,
  salesOrderNumber,
  activityType,
  action,
  title,
  description = null,
  remarks = null,
  metadata = {},
  user = null,
}) {
  if (!salesOrderNumber || !activityType || !action) return null;

  const actor = actorFromUser(user);
  const db = client || pool;
  const result = await db.query(
    `INSERT INTO sales_order_activities (
       sales_order_number, activity_type, action, title, description, remarks,
       metadata, created_by, created_by_name, created_by_role
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
     RETURNING *`,
    [
      salesOrderNumber,
      activityType,
      action,
      resolveTitle(action, title),
      description,
      remarks,
      JSON.stringify(metadata || {}),
      actor.userId,
      actor.userName,
      actor.userRole,
    ]
  );
  return result.rows[0];
}

function safeLogSalesOrderActivity(params) {
  return logSalesOrderActivity(params).catch((err) => {
    console.warn('SO activity log failed:', err.message);
    return null;
  });
}

async function listSalesOrderActivities(salesOrderNumber, { page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const [listRes, countRes] = await Promise.all([
    pool.query(
      `SELECT id, sales_order_number, activity_type, action, title, description, remarks,
              metadata, created_by, created_by_name, created_by_role, created_at
         FROM sales_order_activities
        WHERE sales_order_number = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [salesOrderNumber, safeLimit, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM sales_order_activities WHERE sales_order_number = $1`,
      [salesOrderNumber]
    ),
  ]);

  const total = countRes.rows[0]?.total || 0;
  return {
    activities: listRes.rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
}

module.exports = {
  ACTIVITY_TYPES,
  ACTION_TITLES,
  logSalesOrderActivity,
  safeLogSalesOrderActivity,
  listSalesOrderActivities,
};
