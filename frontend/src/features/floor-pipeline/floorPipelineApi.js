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

export function fetchFloorCounts() {
  return api.get(`${base}/floor-counts`);
}

export function fetchTicketDetail(id) {
  return api.get(`${base}/${id}`);
}

export function moveTicketStage(id, body) {
  return api.post(`${base}/${id}/move-stage`, body);
}

export function markChipRepair(id, body = {}) {
  return api.patch(`${base}/${id}/chip-repair`, body);
}

export function markBodyPaint(id, body = {}) {
  return api.patch(`${base}/${id}/body-paint`, body);
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

export function updateTicket(id, body) {
  return api.put(`${base}/${id}`, body);
}

export function addTicketPart(id, body) {
  return api.post(`${base}/${id}/parts`, body);
}

export function requestTicketPart(id, body) {
  return api.post(`${base}/${id}/part-request`, body);
}

export function searchParts(search = '', limit = 100) {
  return api.get('/parts', { params: { search: search || undefined, limit } });
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

export function getFloorManagerQueue(params = {}) {
  return api.get(`${base}/floor-manager-queue`, { params });
}

export function getTeamMembers(teamName) {
  return api.get(`${base}/team-members`, { params: { team_name: teamName } });
}

export function getNextAssignee(ticketId, toStageName) {
  return api.get(`${base}/${ticketId}/next-assignee`, {
    params: { to_stage_name: toStageName },
  });
}

export function addPartWithConfig(id, body) {
  return api.post(`${base}/${id}/parts-with-config`, body);
}

export function logTicketNote(id, body) {
  return api.post(`${base}/${id}/log-note`, body);
}

export function markTicketDiagnosisFailed(id, body) {
  return api.patch(`${base}/${id}/diagnosis-failed`, body);
}

// Work timer (scan-to-start gate)
export function startWork(id, verify) {
  return api.post(`${base}/${id}/work/start`, { verify });
}

export function getActiveWorkLog(id) {
  return api.get(`${base}/${id}/work/active`);
}

// Editable checklist definition for a stage (items shown in StageTaskPanel).
export function getStageChecklist(stageId) {
  return api.get(`/stages/${stageId}/checklist`);
}

// Stage task checklist (Assembly & Software, Final Testing, ...)
export function getStageTask(id, stageId) {
  return api.get(`${base}/${id}/stage-task`, { params: { stage_id: stageId } });
}

export function saveStageTask(id, body) {
  return api.post(`${base}/${id}/stage-task`, body);
}

/** Production Assets */
export function getProductionAssetByTicket(ticketId) {
  return api.get(`/production-assets/by-ticket/${ticketId}`);
}

export function updateProductionAssetConfig(id, body) {
  return api.patch(`/production-assets/${id}/config`, body);
}

export function saveQc1SpecChecklist(id, body) {
  return api.post(`/production-assets/${id}/qc1-checklist`, body);
}

export function verifyQc2Specs(id, body) {
  return api.post(`/production-assets/${id}/qc2-verify`, body);
}

export function fetchPendingInventory() {
  return api.get('/production-assets/pending-inventory');
}

export function fetchCarretAvailability(carret) {
  return api.get('/production-assets/carret-availability', {
    params: carret != null ? { carret } : {},
  });
}

export function receiveProductionAsset(id, body) {
  return api.post(`/production-assets/${id}/receive`, body);
}

export function createQc2CaptureToken(ticketId) {
  return api.post(`/qc2/tickets/${ticketId}/capture-token`);
}

export function getQc2CaptureStatus(ticketId) {
  return api.get(`/qc2/tickets/${ticketId}/capture-status`);
}

export function createDispatchQcCaptureToken(ticketId) {
  return api.post(`/dispatch-qc/tickets/${ticketId}/capture-token`);
}

export function getDispatchQcCaptureStatus(ticketId) {
  return api.get(`/dispatch-qc/tickets/${ticketId}/capture-status`);
}

