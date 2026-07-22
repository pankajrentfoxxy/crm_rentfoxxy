const pool = require('../config/db');

async function createNotification(userId, type, { title, body, salesOrderNumber } = {}) {
  if (!userId || !type) return null;
  const r = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, sales_order_number)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, type, title || null, body || null, salesOrderNumber || null]
  );
  return r.rows[0];
}

async function createNotificationsForUsers(userIds, type, payload = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const rows = [];
  for (const uid of ids) {
    const row = await createNotification(uid, type, payload);
    if (row) rows.push(row);
  }
  return rows;
}

async function listNotificationsForUser(userId, { limit = 30, unreadOnly = false } = {}) {
  const params = [userId];
  let where = 'user_id = $1';
  if (unreadOnly) where += ' AND read_at IS NULL';
  params.push(Math.min(Math.max(limit, 1), 100));
  const r = await pool.query(
    `SELECT id, user_id, type, title, body, sales_order_number, read_at, created_at
       FROM notifications
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params
  );
  const countR = await pool.query(
    `SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return { notifications: r.rows, unread: countR.rows[0]?.unread || 0 };
}

async function markNotificationRead(notificationId, userId) {
  const r = await pool.query(
    `UPDATE notifications SET read_at = NOW()
      WHERE id = $1 AND user_id = $2 AND read_at IS NULL
      RETURNING *`,
    [notificationId, userId]
  );
  return r.rows[0] || null;
}

async function markAllNotificationsRead(userId) {
  await pool.query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
}

module.exports = {
  createNotification,
  createNotificationsForUsers,
  listNotificationsForUser,
  markNotificationRead,
  markAllNotificationsRead,
};
