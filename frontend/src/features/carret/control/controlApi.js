/** Carret Control — calls for Users, Roles, Role / User permissions and the audit log. */
import api from '../../../utils/api';

// Catalogue of every grantable section, grouped, with the scopes each one takes.
export const fetchSectionCatalogue = () => api.get('/roles/sections');

// Roles
export const fetchRoles = (params) => api.get('/roles', { params: { limit: 100, ...params } });
export const createRole = (body) => api.post('/roles', body);
export const updateRole = (id, body) => api.put(`/roles/${id}`, body);
export const deleteRole = (id) => api.delete(`/roles/${id}`);
export const fetchAuditLog = (params) => api.get('/roles/audit-log', { params });

// Role permissions
export const fetchRolePermissions = (role) => api.get(`/role-permissions/${encodeURIComponent(role)}`);
export const saveRolePermissions = (role, permissions) => api.put(`/role-permissions/${encodeURIComponent(role)}`, { permissions });
export const applyRoleDefaults = (role) => api.post(`/role-permissions/${encodeURIComponent(role)}/apply-defaults`);

// User permissions (overrides)
export const fetchUserPermissions = (userId) => api.get(`/user-permissions/${userId}`);
export const saveUserOverrides = (userId, permissions) => api.put(`/user-permissions/${userId}/overrides`, { permissions });
export const resetUserOverrides = (userId) => api.delete(`/user-permissions/${userId}/reset`);

// Users (existing /api/auth endpoints)
export const fetchUsers = (params) => api.get('/auth/users', { params });
export const fetchAssignableRoles = () => api.get('/auth/assignable-roles');
export const fetchTeams = () => api.get('/auth/teams');
export const createUser = (body) => api.post('/auth/register', body);
export const updateUser = (id, body) => api.put(`/auth/users/${id}`, body);
export const setUserStatus = (id, status, reason) => api.patch(`/auth/users/${id}/status`, { status, reason });
export const resetUserPassword = (id, newPassword) => api.post(`/auth/users/${id}/reset-password`, newPassword ? { new_password: newPassword } : {});

// Teams (GET /api/teams — the floor teams; members include extra teams)
export const fetchTeamList = () => api.get('/teams');
export const fetchTeamMembers = (teamId) => api.get(`/teams/${teamId}/members`);

// Company / entity settings (company_settings: view to read, edit to save)
export const fetchCompanies = () => api.get('/companies');
export const saveCompany = (code, body) => api.put(`/companies/${encodeURIComponent(code)}`, body);

// Reports (each GET guarded by its own report_* section; see reportsCatalog.js)
export const reportGet = (path, params) => api.get(path, { params });
export const reportBlob = (path, params) => api.get(path, { params, responseType: 'blob' });
export const reportExcel = (reportType, filters) => api.post('/reports/export', { report_type: reportType, filters }, { responseType: 'blob' });
