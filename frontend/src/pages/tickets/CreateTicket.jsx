import React, { useState, useEffect, useContext } from 'react';
import { AuthContext, useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Search, X, Scan } from 'lucide-react';
import api from '../../utils/api';
import BarcodeScanner from '../../components/BarcodeScanner';
    
export default function CreateTicket() {
    const { user } = useAuth();
    const [formData, setFormData] = useState({
      serial_number: '',
      ttspl_id: '',
      brand: '',
      model: '',
      initial_condition: '',
      priority: 'normal',
      initial_cost: '',
      assigned_team_id: '',
      assigned_user_id: '',
      processor: '',
      ram: '',
      storage: ''
    });
    const [loading, setLoading] = useState(false);
    const [scanTerm, setScanTerm] = useState('');
    const [scanning, setScanning] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [teams, setTeams] = useState([]);
    const [teamMembers, setTeamMembers] = useState([]);
    const navigate = useNavigate();
  
    const pickBestInventoryMatch = (items, term) => {
      if (!Array.isArray(items) || items.length === 0) return null;
      const normalized = term.trim().toLowerCase();
      const exact = items.find(item =>
        (item.machine_number || '').toLowerCase() === normalized ||
        (item.serial_number || '').toLowerCase() === normalized
      );
      return exact || items[0];
    };
  
    const ticketEligibilityFromInventory = (item) => {
      const st = item.stock_type || '';
      if (st !== 'Cooling Period' && st !== 'Ready') {
        return { ok: false, message: `Cannot create ticket: stock type is '${st || '—'}'. Only Cooling Period or Ready machines can start a repair ticket.` };
      }
      const stat = item.status || '';
      if (stat === 'Reserved') {
        return { ok: false, message: 'Cannot create ticket: this machine is reserved for a sales order. Unassign or cancel the order line first.' };
      }
      if (stat === 'Outward') {
        return { ok: false, message: 'Cannot create ticket: machine is marked Outward. Record the customer return in Inventory first.' };
      }
      if (stat === 'In Repair') {
        return { ok: false, message: 'Cannot create ticket: machine is marked In Repair (e.g. swap/rework). Resolve that state in warehouse/QC first.' };
      }
      return { ok: true };
    };
  
    useEffect(() => {
      // Fetch teams for assignment (ordered by stage, excludes QC/Dispatch/Procurement)
      if (user && (user.role === 'floor_manager' || user.role === 'admin')) {
        api.get('/teams?for_assignment=1').then(({ data }) => setTeams(data.teams)).catch(console.error);
      }
    }, [user]);
  
    useEffect(() => {
      // Fetch members when team selected
      if (formData.assigned_team_id) {
        api.get(`/teams/${formData.assigned_team_id}/members`).then(({ data }) => setTeamMembers(data.members)).catch(console.error);
      } else {
        setTeamMembers([]);
      }
    }, [formData.assigned_team_id]);
  
    const handleScan = async (e) => {
      if (e) e.preventDefault();
      if (!scanTerm.trim()) return;
  
      setScanning(true);
      try {
        const term = scanTerm.trim();
  
        const { data } = await api.get(`/inventory/search?term=${term}`);
        const item = pickBestInventoryMatch(data.items, term);
        if (!item) {
          alert('Item not found in inventory.');
          return;
        }
  
        const elig = ticketEligibilityFromInventory(item);
        if (!elig.ok) {
          alert(elig.message);
          setScanning(false);
          return;
        }
  
        setFormData({
          ...formData,
          serial_number: item.serial_number,
          brand: item.brand,
          model: item.model,
          processor: item.processor || '',
          ram: item.ram || '',
          storage: item.storage || '',
        });
        alert('Inventory item found! Details auto-filled.');
        setShowScanner(false);
      } catch (error) {
        console.error('Scan error:', error);
        alert('Item not found in inventory or error scanning.');
      } finally {
        setScanning(false);
      }
    };
  
    const onBarcodeWithScanner = (decodedText) => {
      setScanTerm(decodedText);
      // Direct API call to avoid state sync issues
      api.get(`/inventory/search?term=${decodedText}`)
        .then(({ data }) => {
          const item = pickBestInventoryMatch(data.items, decodedText);
          if (!item) {
            alert(`Scanned ${decodedText} but item not found.`);
            return;
          }
          const elig = ticketEligibilityFromInventory(item);
          if (!elig.ok) {
            alert(elig.message);
            return;
          }
          setFormData(prev => ({
            ...prev,
            serial_number: item.serial_number,
            brand: item.brand,
            model: item.model,
            processor: item.processor || '',
            ram: item.ram || '',
            storage: item.storage || '',
          }));
          alert(`Scanned: ${decodedText}. Details auto-filled.`);
          setShowScanner(false);
        })
        .catch(err => {
          console.error(err);
          alert(`Scanned ${decodedText} but item not found or error.`);
        });
    };
  
    const handleSubmit = async (e) => {
      e.preventDefault();
      setLoading(true);
      try {
        await api.post('/tickets', formData);
        navigate('/tickets');
      } catch (error) {
        console.error('Create ticket error:', error);
        alert(error.response?.data?.message || 'Failed to create ticket');
      } finally {
        setLoading(false);
      }
    };
  
    // Check if Floor Manager or Admin
    const canAssign = user && (user.role === 'floor_manager' || user.role === 'admin');
  
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-blue-100 rounded-full">
              <ClipboardList className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Create New Ticket</h2>
              <p className="text-gray-600">Start repair process for a laptop</p>
            </div>
          </div>
  
          {/* Scan Section */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">Scan Machine # or Search (Serial/Brand)</label>
  
            {showScanner ? (
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-bold text-gray-700">Scan Barcode</h3>
                  <button
                    onClick={() => setShowScanner(false)}
                    className="text-gray-500 hover:text-gray-700"
                    type="button"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <BarcodeScanner
                  onScanSuccess={onBarcodeWithScanner}
                  onScanFailure={() => {}}
                />
              </div>
            ) : (
              <form onSubmit={handleScan} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={scanTerm}
                    onChange={(e) => setScanTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Click here & Scan with Gun (or type serial)..."
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={scanning || !scanTerm}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {scanning ? 'Searching...' : 'Go'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 flex items-center gap-2"
                  title="Use Webcam"
                >
                  <Scan className="w-4 h-4" />
                  <span className="hidden sm:inline">Camera</span>
                </button>
              </form>
            )}
  
            <div className="mt-2 flex flex-col gap-1 text-xs text-gray-500">
              <p className="font-medium text-blue-600">* Finds Cooling Period or Ready stock and auto-fills details (not Reserved / Outward / In Repair).</p>
              <p>💡 <strong>Physical Scanner:</strong> Click the input box above and scan. It will auto-submit.</p>
              <p>📷 <strong>Mobile/Webcam:</strong> Click the "Camera" button to scan visibly.</p>
            </div>
          </div>
  
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">TTSPL ID</label>
                <input
                  type="text"
                  value={formData.ttspl_id}
                  onChange={(e) => setFormData({ ...formData, ttspl_id: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="TTSPL-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Serial Number *</label>
                <input
                  type="text"
                  required
                  value={formData.serial_number}
                  onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="LAP001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Initial Cost ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.initial_cost}
                  onChange={(e) => setFormData({ ...formData, initial_cost: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
            </div>
  
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Brand</label>
                <input
                  type="text"
                  value={formData.brand}
                  onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Dell"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Model</label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Latitude 5420"
                />
              </div>
            </div>
  
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Processor</label>
                <input
                  type="text"
                  value={formData.processor}
                  onChange={(e) => setFormData({ ...formData, processor: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="i5-1135G7"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">RAM</label>
                <input
                  type="text"
                  value={formData.ram}
                  onChange={(e) => setFormData({ ...formData, ram: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="16GB"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Storage</label>
                <input
                  type="text"
                  value={formData.storage}
                  onChange={(e) => setFormData({ ...formData, storage: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="512GB SSD"
                />
              </div>
            </div>
  
            {canAssign && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-purple-50 rounded-lg border border-purple-100">
                <div className="col-span-2 text-sm font-bold text-purple-800 mb-1">
                  Floor Manager Assignment
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Assign Team</label>
                  <select
                    value={formData.assigned_team_id}
                    onChange={(e) => setFormData({ ...formData, assigned_team_id: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">Default (Warehouse)</option>
                    {teams.map(team => (
                      <option key={team.team_id} value={team.team_id}>{team.team_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Assign Member</label>
                  <select
                    value={formData.assigned_user_id}
                    onChange={(e) => setFormData({ ...formData, assigned_user_id: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    disabled={!formData.assigned_team_id}
                  >
                    <option value="">Any / Unassigned</option>
                    {teamMembers.map(member => (
                      <option key={member.user_id} value={member.user_id}>{member.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
  
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
  
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Initial Condition</label>
              <textarea
                value={formData.initial_condition}
                onChange={(e) => setFormData({ ...formData, initial_condition: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                rows="4"
                placeholder="Describe the laptop's condition..."
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => navigate('/tickets')}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Ticket'}
              </button>
            </div>
          </form>
        </div>
      </div >
    );
  }