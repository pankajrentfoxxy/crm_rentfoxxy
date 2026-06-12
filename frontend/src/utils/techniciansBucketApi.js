import api from './api';

const base = '/technicians-bucket-list';

export async function fetchTechniciansBucketMeta() {
  const { data } = await api.get(`${base}/meta`);
  return data;
}

export async function fetchTechniciansBucketDetails(params = {}) {
  const { data } = await api.get(`${base}/details`, { params });
  return data;
}
