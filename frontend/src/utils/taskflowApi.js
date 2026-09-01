import api from './api';

export async function getTaskflowSsoUrl() {
  const { data } = await api.get('/taskflow/sso-url');
  return data;
}

export async function getTaskflowPendingCount() {
  const { data } = await api.get('/taskflow/pending-count');
  return data;
}
