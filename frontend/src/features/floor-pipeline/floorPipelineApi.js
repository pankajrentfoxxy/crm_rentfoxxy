import api from '../../utils/api';

const base = '/tickets';

export function fetchFloorTickets(params = {}) {
  return api.get(base, { params: { view: 'in_progress', ...params } });
}

export function fetchFloorStages() {
  return api.get(`${base}/stages`);
}

export function fetchFloorDashboard() {
  return api.get(`${base}/floor-dashboard`);
}

export function fetchTicketDetail(id) {
  return api.get(`${base}/${id}`);
}

export function moveTicketStage(id, body) {
  return api.post(`${base}/${id}/move-stage`, body);
}

export function markChipRepair(id) {
  return api.patch(`${base}/${id}/chip-repair`);
}

export function markBodyPaint(id) {
  return api.patch(`${base}/${id}/body-paint`);
}

export function floorManagerFail(id, body) {
  return api.patch(`${base}/${id}/floor-manager-fail`, body);
}

export function updateTicketConfig(id, body) {
  return api.patch(`${base}/${id}/config`, body);
}

export function fetchTtsplHistory(ttsplId) {
  return api.get(`${base}/ttspl/${encodeURIComponent(ttsplId)}/history`);
}

export function assignTicket(id, body) {
  return api.post(`${base}/${id}/assign`, body);
}

export function addTicketPart(id, body) {
  return api.post(`${base}/${id}/parts`, body);
}

export function requestTicketPart(id, body) {
  return api.post(`${base}/${id}/part-request`, body);
}

export function searchParts(search) {
  return api.get('/parts', { params: { search } });
}

export function saveTicketQc(id, body) {
  return api.post(`${base}/${id}/qc/save`, body);
}

export function submitTicketQc(id, body) {
  return api.post(`${base}/${id}/qc/submit`, body);
}

export function fetchTicketQc(id) {
  return api.get(`${base}/${id}/qc`);
}

export function tagInventoryItem(serialId, tag) {
  return api.patch(`/inventory-management/${serialId}/tag`, { tag });
}
