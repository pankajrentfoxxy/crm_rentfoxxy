import api from '../../utils/api';

const base = '/whatsapp-campaigns';

export const getCampaignConfig = () => api.get(`${base}/config`);
export const listCampaigns = (params) => api.get(base, { params });
export const createCampaign = (data) => api.post(base, data);
export const getCampaign = (id) => api.get(`${base}/${id}`);
export const updateCampaign = (id, data) => api.put(`${base}/${id}`, data);
export const deleteCampaign = (id) => api.delete(`${base}/${id}`);
export const getCampaignStats = (id) => api.get(`${base}/${id}/stats`);
export const listCampaignContacts = (id, params) => api.get(`${base}/${id}/contacts`, { params });
export const listCampaignImports = (id) => api.get(`${base}/${id}/imports`);

export const importCampaignContacts = (id, file, onUploadProgress) => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`${base}/${id}/import`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 5 * 60 * 1000,
    onUploadProgress,
  });
};

export const startCampaign = (id) => api.post(`${base}/${id}/start`);
export const pauseCampaign = (id) => api.post(`${base}/${id}/pause`);
export const resumeCampaign = (id) => api.post(`${base}/${id}/resume`);
export const cancelCampaign = (id) => api.post(`${base}/${id}/cancel`);

/** type: rejected | invalid | duplicate | failed | all */
export async function downloadCampaignContacts(id, { type = 'rejected', format = 'xlsx' } = {}) {
  const res = await api.get(`${base}/${id}/contacts/export`, {
    params: { type, format },
    responseType: 'blob',
    timeout: 5 * 60 * 1000,
  });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = `whatsapp_campaign_${id}_${type}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/** Best-effort message from an axios error (including blob error bodies). */
export function apiErrorMessage(err, fallback = 'Something went wrong') {
  return err?.response?.data?.message || err?.message || fallback;
}
