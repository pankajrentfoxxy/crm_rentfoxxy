const pool = require('../config/db');

const ACTIVITY_TYPES = {
  PURCHASE_ORDER: 'purchase_order',
  VENDOR: 'vendor',
  ITEM: 'item',
  GRN: 'grn',
  INVENTORY: 'inventory',
  ATTACHMENT: 'attachment',
  DOCUMENT: 'document',
  SYSTEM: 'system',
};

const ACTION_TITLES = {
  created: 'Purchase Order Created',
  updated: 'Purchase Order Updated',
  approved: 'Purchase Order Approved',
  rejected: 'Purchase Order Rejected',
  cancelled: 'Purchase Order Cancelled',
  reopened: 'Purchase Order Reopened',
  status_changed: 'Status Changed',
  vendor_selected: 'Vendor Selected',
  vendor_changed: 'Vendor Changed',
  vendor_details_updated: 'Vendor Details Updated',
  billing_address_updated: 'Billing Address Updated',
  shipping_address_updated: 'Shipping Address Updated',
  item_added: 'Item Added',
  item_removed: 'Item Removed',
  item_updated: 'Item Updated',
  configuration_changed: 'Configuration Changed',
  quantity_changed: 'Quantity Changed',
  price_changed: 'Price Changed',
  discount_updated: 'Discount Updated',
  gst_updated: 'GST Updated',
  total_amount_updated: 'Total Amount Updated',
  grn_created: 'GRN Created',
  grn_updated: 'GRN Updated',
  grn_accepted: 'GRN Accepted',
  grn_rejected: 'GRN Rejected',
  grn_partial_received: 'Partial GRN Received',
  grn_complete_received: 'Complete GRN Received',
  laptop_accepted: 'Laptop Accepted',
  laptop_rejected: 'Laptop Rejected',
  grn_configuration_updated: 'Configuration Updated During GRN',
  inventory_added: 'Laptop Added to Inventory',
  asset_tag_generated: 'Asset Tag Generated',
  ttspl_generated: 'TTSPL Generated',
  inventory_status_updated: 'Inventory Status Updated',
  qc_started: 'QC Process Started',
  attachment_uploaded: 'Attachment Uploaded',
  attachment_deleted: 'Attachment Deleted',
  invoice_uploaded: 'Invoice Uploaded',
  invoice_updated: 'Invoice Updated',
  pdf_generated: 'Purchase Order PDF Generated',
  printed: 'Purchase Order Printed',
  pdf_downloaded: 'Purchase Order Downloaded',
  shared: 'Purchase Order Shared',
  note_added: 'Internal Note Added',
  comment_added: 'Comment Added',
  assignment_changed: 'Assignment Changed',
  priority_updated: 'Priority Updated',
};

function actorFromUser(user) {
  const u = user || {};
  return {
    userId: u.user_id || u.userId || null,
    userName: u.name || u.userName || 'System',
    userRole: u.role || u.userRole || 'system',
  };
}

function resolveTitle(action, title) {
  if (title) return title;
  return ACTION_TITLES[action] || action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function logPurchaseOrderActivity({
  client = null,
  poId,
  activityType,
  action,
  title,
  description = null,
  remarks = null,
  metadata = {},
  user = null,
}) {
  const id = Number(poId);
  if (!Number.isFinite(id) || id <= 0 || !activityType || !action) return null;

  const actor = actorFromUser(user);
  const db = client || pool;
  const result = await db.query(
    `INSERT INTO purchase_order_activities (
       po_id, activity_type, action, title, description, remarks,
       metadata, created_by, created_by_name, created_by_role
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
     RETURNING *`,
    [
      id,
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

function safeLogPurchaseOrderActivity(params) {
  return logPurchaseOrderActivity(params).catch((err) => {
    console.warn('PO activity log failed:', err.message);
    return null;
  });
}

async function listPurchaseOrderActivities(poId, { page = 1, limit = 50 } = {}) {
  const id = Number(poId);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const [listRes, countRes] = await Promise.all([
    pool.query(
      `SELECT id, po_id, activity_type, action, title, description, remarks,
              metadata, created_by, created_by_name, created_by_role, created_at
         FROM purchase_order_activities
        WHERE po_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [id, safeLimit, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM purchase_order_activities WHERE po_id = $1`,
      [id]
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
  logPurchaseOrderActivity,
  safeLogPurchaseOrderActivity,
  listPurchaseOrderActivities,
};
