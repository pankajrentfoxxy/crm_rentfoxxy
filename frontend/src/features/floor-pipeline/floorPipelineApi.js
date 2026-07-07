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

// Stage task checklist (Assembly & Software, Final Testing, ...)
export function getStageTask(id, stageId) {
  return api.get(`${base}/${id}/stage-task`, { params: { stage_id: stageId } });
}

export function saveStageTask(id, body) {
  return api.post(`${base}/${id}/stage-task`, body);
}
