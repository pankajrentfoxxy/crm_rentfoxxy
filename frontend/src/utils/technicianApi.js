import axios from 'axios';
import { getApiUrl } from './api';

const technicianApi = axios.create({
  baseURL: getApiUrl(),
});

technicianApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('technician_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function setTechnicianToken(token) {
  if (token) localStorage.setItem('technician_token', token);
  else localStorage.removeItem('technician_token');
}

export function getTechnicianToken() {
  return localStorage.getItem('technician_token');
}

export async function technicianLogin(email, password) {
  const { data } = await technicianApi.post('/technician-auth/login', { email, password });
  return data;
}

export async function fetchTechnicianMe() {
  const { data } = await technicianApi.get('/technician-auth/me');
  return data;
}

export async function fetchTechnicianDashboard() {
  const { data } = await technicianApi.get('/technician-auth/dashboard');
  return data;
}

export default technicianApi;
