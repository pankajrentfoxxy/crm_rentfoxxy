import api from './api';

const base = '/delivery-register-management';

export async function fetchDeliveryRegisterCounts() {
  const { data } = await api.get(`${base}/counts`);
  return data;
}

export async function fetchDeliveryRegisterList(status, params = {}) {
  const { data } = await api.get(`${base}/${status}`, { params });
  return data;
}

export async function changeDeliveryPerson(body) {
  const { data } = await api.post(`${base}/change-delivery-person`, body);
  return data;
}

export async function sendDeliveryRegisterOtp(dcNumber, body) {
  const { data } = await api.post(`${base}/${encodeURIComponent(dcNumber)}/send-otp`, body);
  return data;
}

export async function verifyDeliveryRegisterOtp(dcNumber, body) {
  const { data } = await api.post(`${base}/${encodeURIComponent(dcNumber)}/verify-otp`, body);
  return data;
}

export async function submitDeliveryRegisterPod(dcNumber, formData) {
  const { data } = await api.post(`${base}/${encodeURIComponent(dcNumber)}/pod`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function fetchTechnicianAddMeta() {
  const { data } = await api.get(`${base}/technicians/meta/add`);
  return data;
}

export async function fetchDeliveryTechnicians(params = {}) {
  const { data } = await api.get(`${base}/technicians`, { params });
  return data;
}

export async function fetchDeliveryTechnician(id) {
  const { data } = await api.get(`${base}/technicians/${id}`);
  return data;
}

export async function createDeliveryTechnician(formData) {
  const { data } = await api.post(`${base}/technicians`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function updateDeliveryTechnician(id, formData) {
  const { data } = await api.patch(`${base}/technicians/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function updateDeliveryTechnicianStatus(id, status) {
  const { data } = await api.post(`${base}/technicians/status`, { id, status });
  return data;
}

export async function changeDeliveryTechnicianPassword(id, body) {
  const { data } = await api.post(`${base}/technicians/${id}/password`, body);
  return data;
}

export async function deleteDeliveryTechnician(id) {
  const { data } = await api.delete(`${base}/technicians/${id}`);
  return data;
}

export async function loginAsTechnician({ technician_id, technician_email }) {
  const { data } = await api.post(`${base}/technicians/login-as`, {
    technician_id,
    technician_email,
  });
  return data;
}
