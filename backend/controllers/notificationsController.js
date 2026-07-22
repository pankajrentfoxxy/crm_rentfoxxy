const {
  listNotificationsForUser,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../services/notificationService');

exports.listNotifications = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 30;
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    const data = await listNotificationsForUser(req.user.user_id, { limit, unreadOnly });
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.markRead = async (req, res) => {
  try {
    const row = await markNotificationRead(parseInt(req.params.id, 10), req.user.user_id);
    if (!row) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, notification: row });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await markAllNotificationsRead(req.user.user_id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
