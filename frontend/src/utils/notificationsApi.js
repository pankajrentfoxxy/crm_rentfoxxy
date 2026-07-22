import api from './api';

export function fetchNotifications(params = {}) {
  return api.get('/notifications', { params });
}

export function markNotificationRead(id) {
  return api.post(`/notifications/${id}/read`);
}

export function markAllNotificationsRead() {
  return api.post('/notifications/read-all');
}
