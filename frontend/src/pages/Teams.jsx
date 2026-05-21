import React, { useState, useEffect, useCallback, useContext } from 'react';
import { AuthContext, useAuth } from '../context/AuthContext';
import { ArrowRight, Pencil, Barcode, Users } from 'lucide-react';
import api from '../utils/api';

export default function Teams() {
    const { user } = useAuth();
    const [teams, setTeams] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [teamFilter, setTeamFilter] = useState('all');
    const [formData, setFormData] = useState({
      name: '',
      email: '',
      password: '',
      mobile_no: '',
      role: 'team_member',
      team_ids: []
    });
    const [permissionModal, setPermissionModal] = useState(null);
    const [mobileEditModal, setMobileEditModal] = useState(null);
    const [teamsEditModal, setTeamsEditModal] = useState(null);
    const canManageUsers = user && ['admin', 'manager'].includes(user.role);
    const PERMISSIONS = [
      { key: 'inventory_read', label: 'Inventory View (see & search)' },
      { key: 'inventory_write', label: 'Inventory Edit (add, upload, CSV)' },
      { key: 'parts_access', label: 'Parts' },
      { key: 'reports_access', label: 'Reports' },
      { key: 'sales_access', label: 'Sales' },
      { key: 'orders_access', label: 'Orders' },
      { key: 'procurement_access', label: 'Procurement (Orders)' },
      { key: 'qc_access', label: 'QC Orders' },
      { key: 'dispatch_access', label: 'Dispatch' },
      { key: 'warehouse_access', label: 'Warehouse' },
      { key: 'customers_access', label: 'Customers (View)' },
      { key: 'customers_edit', label: 'Customers (Edit)' },
      { key: 'support_access', label: 'Support module' },
      { key: 'customer_inventory_access', label: 'Customer Inventory (Support tech)' }
    ];
  
    useEffect(() => {
      loadData();
    }, []);
  
    const loadData = async () => {
      try {
        const [teamsRes, usersRes] = await Promise.all([
          api.get('/teams'),
          api.get('/auth/users')
        ]);
        setTeams(teamsRes.data.teams);
        setUsers(usersRes.data.users);
  
        if (teamsRes.data.teams.length > 0) {
          setFormData(prev => ({ ...prev, team_ids: [teamsRes.data.teams[0].team_id] }));
        }
      } catch (error) {
        console.error('Load data error:', error);
      } finally {
        setLoading(false);
      }
    };
  
    const handleSubmit = async (e) => {
      e.preventDefault();
      setCreating(true);
      setMessage({ type: '', text: '' });
  
      try {
        const payload = { ...formData };
        if (['team_member', 'team_lead', 'floor_manager'].includes(formData.role) && formData.team_ids?.length > 0) {
          payload.team_ids = formData.team_ids;
        } else if (['team_member', 'team_lead', 'floor_manager'].includes(formData.role) && formData.team_ids?.length === 0) {
          payload.team_id = teams[0]?.team_id || null;
        }
        await api.post('/auth/register', payload);
        setMessage({ type: 'success', text: 'User created successfully!' });
        setFormData({
          name: '',
          email: '',
          password: '',
          mobile_no: '',
          role: 'team_member',
          team_ids: teams[0] ? [teams[0].team_id] : []
        });
      } catch (error) {
        setMessage({
          type: 'error',
          text: error.response?.data?.message || 'Failed to create user'
        });
      } finally {
        setCreating(false);
      }
    };
  
    const handleUpdateMobile = async (userId, mobile_no) => {
      try {
        await api.put(`/auth/users/${userId}/mobile`, { mobile_no: mobile_no || null });
        setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, mobile_no: mobile_no || null } : u));
        setMobileEditModal(null);
      } catch (err) {
        console.error('Update mobile error:', err);
        alert(err.response?.data?.message || 'Failed to update mobile');
      }
    };
  
    const handleUpdateTeams = async (userId, team_ids) => {
      try {
        await api.put(`/auth/users/${userId}/teams`, { team_ids });
        setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, team_ids } : u));
        setTeamsEditModal(null);
        loadData();
      } catch (err) {
        console.error('Update teams error:', err);
        alert(err.response?.data?.message || 'Failed to update teams');
      }
    };
  
    const handleGenerateBarcode = async (userId) => {
      const code = 'USR-' + Math.random().toString(36).substr(2, 6).toUpperCase();
      try {
        await api.put(`/auth/users/${userId}/barcode`, { barcode: code });
        // Update local state
        setUsers(users.map(u => u.user_id === userId ? { ...u, barcode: code } : u));
        alert(`Barcode generated: ${code}`);
      } catch (e) {
        alert('Failed to generate barcode');
      }
    };
  
    const handleDeleteUser = async (targetUser) => {
      if (!targetUser?.user_id) return;
      const confirmed = window.confirm(`Delete user "${targetUser.name}" (${targetUser.email})?`);
      if (!confirmed) return;
      try {
        await api.delete(`/auth/users/${targetUser.user_id}`);
        setUsers((prev) => prev.filter((u) => u.user_id !== targetUser.user_id));
        setMessage({ type: 'success', text: 'User deleted successfully' });
      } catch (error) {
        setMessage({
          type: 'error',
          text: error.response?.data?.message || 'Failed to delete user'
        });
      }
    };
  
    const filteredUsers = users.filter(u => {
      if (teamFilter === 'all') return true;
      const userTeamIds = u.team_ids && u.team_ids.length > 0 ? u.team_ids : (u.team_id ? [u.team_id] : []);
      if (teamFilter === 'unassigned') return userTeamIds.length === 0;
      return userTeamIds.includes(parseInt(teamFilter));
    });
  
    if (loading) return <div className="text-center py-12">Loading teams...</div>;
  
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-blue-100 rounded-full">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">User Management</h2>
              <p className="text-gray-600">Create accounts and control access</p>
            </div>
          </div>
  
          {message.text && (
            <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
              {message.text}
            </div>
          )}
  
          {/* Create User Form - Admin/Manager Only */}
          {canManageUsers && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="John Doe"
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="john@refurb.com"
                  />
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mobile No</label>
                  <input
                    type="tel"
                    value={formData.mobile_no}
                    onChange={e => setFormData({ ...formData, mobile_no: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. 9876543210"
                  />
                  <p className="mt-1 text-xs text-gray-500">For future WhatsApp/SMS integration</p>
                </div>
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                  <input
                    type="password"
                    required
                    minLength="6"
                    value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="••••••••"
                  />
                </div>
  
  
  
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                  <select
                    value={formData.role}
                    onChange={e => {
                      const role = e.target.value;
                      const noTeamRequired = ['admin', 'sales', 'qc', 'dispatch', 'procurement', 'warehouse', 'support_lead', 'support_tech'].includes(role);
                      setFormData(prev => ({
                        ...prev,
                        role,
                        team_ids: noTeamRequired ? [] : (prev.team_ids?.length ? prev.team_ids : [teams[0]?.team_id].filter(Boolean))
                      }));
                    }}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="team_member">Team Member</option>
                    <option value="sales">Sales</option>
                    <option value="floor_manager">Floor Manager</option>
                    <option value="procurement">Procurement</option>
                    <option value="warehouse">Warehouse</option>
                    <option value="qc">QC</option>
                    <option value="dispatch">Dispatch</option>
                    <option value="team_lead">Team Lead</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                    <option value="support_lead">Support Team Lead</option>
                    <option value="support_tech">Support Technician</option>
                  </select>
                </div>
  
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Assign to Team(s) – select multiple for QC1+QC2, etc.</label>
                  {['admin', 'sales', 'qc', 'dispatch', 'procurement', 'warehouse', 'support_lead', 'support_tech'].includes(formData.role) ? (
                    <p className="text-sm text-gray-500 py-2">No team required (standalone role)</p>
                  ) : (
                    <div className="border border-gray-300 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                      {teams.map(team => (
                        <label key={team.team_id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={(formData.team_ids || []).includes(team.team_id)}
                            onChange={e => {
                              const ids = formData.team_ids || [];
                              const newIds = e.target.checked
                                ? [...ids, team.team_id]
                                : ids.filter(id => id !== team.team_id);
                              setFormData(prev => ({ ...prev, team_ids: newIds }));
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm">{team.team_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
  
              <div className="pt-4 border-t border-gray-200 flex justify-end">
                <button
                  type="submit"
                  disabled={creating}
                  className="px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {creating ? 'Creating...' : 'Create User Account'}
                  {!creating && <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </form>
          )}
        </div>
  
        {/* Team Members List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <h3 className="text-lg font-bold">Team Members</h3>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Team Filter</label>
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Teams</option>
                <option value="unassigned">Unassigned</option>
                {teams.map(team => (
                  <option key={team.team_id} value={team.team_id}>
                    {team.team_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b bg-gray-50 text-sm">
                  <th className="p-3">Name</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Team</th>
                  <th className="p-3">Mobile</th>
                  <th className="p-3">Barcode</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredUsers.map(u => (
                  <tr key={u.user_id} className="hover:bg-gray-50">
                    <td className="p-3 font-medium">{u.name}<div className="text-xs text-gray-500">{u.email}</div></td>
                    <td className="p-3"><span className="px-2 py-1 bg-gray-100 rounded text-xs">{u.role}</span></td>
                    <td className="p-3">
                      {(() => {
                        const ids = u.team_ids && u.team_ids.length > 0 ? u.team_ids : (u.team_id ? [u.team_id] : []);
                        const names = ids.map(tid => teams.find(t => t.team_id === tid)?.team_name).filter(Boolean);
                        return names.length > 0 ? names.join(', ') : (u.team_name || '-');
                      })()}
                      {canManageUsers && ['team_member', 'team_lead', 'floor_manager'].includes(u.role) && (
                        <button
                          onClick={() => setTeamsEditModal({ userId: u.user_id, name: u.name, team_ids: u.team_ids || (u.team_id ? [u.team_id] : []) })}
                          className="ml-2 text-xs text-blue-600 hover:text-blue-800"
                          title="Edit teams"
                        >
                          <Pencil className="w-3.5 h-3.5 inline" />
                        </button>
                      )}
                    </td>
                    <td className="p-3">
                      <span>{u.mobile_no || '-'}</span>
                      {canManageUsers && (
                        <button
                          onClick={() => setMobileEditModal({ userId: u.user_id, name: u.name, mobile_no: u.mobile_no || '' })}
                          className="ml-2 text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                          title="Edit mobile"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="p-3">
                      {u.barcode ? <Barcode value={u.barcode} height={30} width={1} fontSize={12} displayValue={true} /> : <span className="text-gray-400">Not set</span>}
                    </td>
                    <td className="p-3 text-right flex gap-2 justify-end">
                      {canManageUsers && (
                        <>
                          <button
                            onClick={() => setPermissionModal({ userId: u.user_id, name: u.name, permissions: u.permissions || [] })}
                            className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded hover:bg-slate-200"
                          >
                            Access
                          </button>
                          <button
                            onClick={() => handleGenerateBarcode(u.user_id)}
                            className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100"
                          >
                            {u.barcode ? 'Regenerate' : 'Generate'}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
  
        {/* Mobile Edit Modal */}
        {mobileEditModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-sm">
              <h3 className="text-lg font-bold mb-1">Edit Mobile</h3>
              <p className="text-sm text-gray-500 mb-4">Update mobile for {mobileEditModal.name}</p>
              <input
                type="tel"
                value={mobileEditModal.mobile_no}
                onChange={e => setMobileEditModal(prev => ({ ...prev, mobile_no: e.target.value }))}
                placeholder="e.g. 9876543210"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setMobileEditModal(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUpdateMobile(mobileEditModal.userId, mobileEditModal.mobile_no)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
  
        {/* Teams Edit Modal */}
        {teamsEditModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-1">Edit Team Access</h3>
              <p className="text-sm text-gray-500 mb-4">Select teams for {teamsEditModal.name}. User will see tickets in all selected stages.</p>
              <div className="max-h-60 overflow-y-auto space-y-2 mb-6">
                {teams.map(team => (
                  <label key={team.team_id} className="flex items-center gap-3 p-2 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={(teamsEditModal.team_ids || []).includes(team.team_id)}
                      onChange={(e) => {
                        const ids = teamsEditModal.team_ids || [];
                        const newIds = e.target.checked ? [...ids, team.team_id] : ids.filter(id => id !== team.team_id);
                        setTeamsEditModal(prev => ({ ...prev, team_ids: newIds }));
                      }}
                      className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm font-medium">{team.team_name}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setTeamsEditModal(null)} className="flex-1 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button
                  onClick={() => handleUpdateTeams(teamsEditModal.userId, teamsEditModal.team_ids || [])}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
  
        {/* Permission Modal */}
        {permissionModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-sm">
              <h3 className="text-lg font-bold mb-1">Access Control</h3>
              <p className="text-sm text-gray-500 mb-4">Enable modules for {permissionModal.name}</p>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {PERMISSIONS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={permissionModal.permissions.includes(key)}
                      onChange={(e) => {
                        const newPerms = e.target.checked
                          ? [...permissionModal.permissions, key]
                          : permissionModal.permissions.filter(p => p !== key);
                        setPermissionModal(prev => ({ ...prev, permissions: newPerms }));
                      }}
                      className="h-5 w-5 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setPermissionModal(null)}
                  className="flex-1 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      await api.put(`/auth/users/${permissionModal.userId}/permissions`, { permissions: permissionModal.permissions });
                      alert('Permissions updated');
                      setPermissionModal(null);
                      loadData(); // Reload users
                    } catch (e) {
                      alert('Failed to update permissions');
                    }
                  }}
                  className="flex-1 py-2 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
  
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold mb-4">Teams Directory</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map(team => (
              <div key={team.team_id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="font-semibold text-slate-900">{team.team_name}</div>
                <div className="text-xs text-gray-500">{team.description || 'No description'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }