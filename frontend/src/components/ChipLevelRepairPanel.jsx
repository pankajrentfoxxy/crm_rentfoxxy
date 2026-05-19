import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Wrench, AlertTriangle, Save, PlusCircle } from 'lucide-react';
import api from '../utils/api';

const ISSUE_OPTIONS = [
  'No Power',
  'No Display',
  'Short Circuit',
  'Power Rail Unstable',
  'BIOS IC Issue',
  'EC/KBC Issue',
  'Charging IC Issue',
  'Power IC Issue',
  'GPU/CPU Issue',
  'RAM Slot Issue',
  'Water/Corrosion Damage',
  'Overheating / Thermal Fault',
  'Other Chip-Level Fault'
];

const RESOLUTION_CHECKS = [
  'Motherboard repaired',
  'Chipset repaired/replaced',
  'IC reflow/reball done',
  'Short removed',
  'Power rails stable',
  'Post/Boot successful'
];

export default function ChipLevelRepairPanel({ ticketId, partRequests = [], ticketParts = [], onUpdated, processing }) {
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState([]);
  const [issueNotes, setIssueNotes] = useState('');
  const [partsRequired, setPartsRequired] = useState(false);
  const [partsNotes, setPartsNotes] = useState('');
  const [resolvedChecks, setResolvedChecks] = useState([]);
  const [parts, setParts] = useState([]);
  const [partId, setPartId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [partNotes, setPartNotes] = useState('');
  const [requestName, setRequestName] = useState('');
  const [requestDesc, setRequestDesc] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [repairRes, partsRes] = await Promise.all([
        api.get(`/chip-repair/ticket/${ticketId}`),
        api.get('/parts')
      ]);
      const repair = repairRes.data.repair;
      if (repair) {
        setIssues(repair.issues || []);
        setIssueNotes(repair.issue_notes || '');
        setPartsRequired(!!repair.parts_required);
        setPartsNotes(repair.parts_notes || '');
        setResolvedChecks(repair.resolved_checks || []);
      }
      setParts(partsRes.data.parts || []);
    } catch (err) {
      console.error('Chip repair load error:', err);
      alert('Failed to load chip repair data');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleIssue = (issue) => {
    setIssues(prev => prev.includes(issue) ? prev.filter(i => i !== issue) : [...prev, issue]);
  };

  const toggleResolved = (check) => {
    setResolvedChecks(prev => prev.includes(check) ? prev.filter(c => c !== check) : [...prev, check]);
  };

  const handleSave = async () => {
    try {
      await api.post(`/chip-repair/ticket/${ticketId}`, {
        issues,
        issue_notes: issueNotes,
        parts_required: partsRequired,
        parts_notes: partsNotes,
        resolved_checks: resolvedChecks,
        status: partsRequired ? 'waiting_parts' : 'in_progress'
      });
      if (onUpdated) onUpdated();
      alert('Chip level repair saved');
    } catch (err) {
      alert('Failed to save chip repair');
    }
  };

  const handleSubmit = async () => {
    if (issues.length === 0) {
      alert('Please select at least one chip-level issue');
      return;
    }
    if (partsRequired && partRequests.filter(r => r.status === 'pending').length > 0) {
      alert('Pending part requests exist. Please wait for procurement.');
      return;
    }
    try {
      await api.post(`/chip-repair/ticket/${ticketId}/submit`, {
        issues,
        issue_notes: issueNotes,
        parts_required: partsRequired,
        parts_notes: partsNotes,
        resolved_checks: resolvedChecks
      });
      if (onUpdated) onUpdated();
      alert('Submitted and sent back to Diagnosis');
    } catch (err) {
      alert('Failed to submit chip repair');
    }
  };

  const handleRequestPart = async (e) => {
    e.preventDefault();
    if (!requestName.trim()) return;
    try {
      await api.post(`/tickets/${ticketId}/part-request`, {
        part_name: requestName,
        description: requestDesc
      });
      setRequestName('');
      setRequestDesc('');
      if (onUpdated) onUpdated();
      alert('Part requested');
    } catch (err) {
      alert('Failed to request part');
    }
  };

  const handleAddPart = async (e) => {
    e.preventDefault();
    if (!partId) return;
    try {
      await api.post(`/tickets/${ticketId}/parts`, {
        part_id: parseInt(partId),
        quantity_used: parseInt(quantity, 10) || 1,
        notes: partNotes
      });
      setPartId('');
      setQuantity(1);
      setPartNotes('');
      if (onUpdated) onUpdated();
      alert('Part added to ticket');
    } catch (err) {
      alert('Failed to add part');
    }
  };

  if (loading) return <div className="p-6 text-center">Loading chip-level repair...</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6 space-y-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-red-600" />
        <h3 className="text-lg font-bold">Chip Level Repair (L3)</h3>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2">Issues Found</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {ISSUE_OPTIONS.map(issue => (
            <label key={issue} className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={issues.includes(issue)}
                onChange={() => toggleIssue(issue)}
                className="h-4 w-4 text-blue-600 rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">{issue}</span>
            </label>
          ))}
        </div>
        <textarea
          value={issueNotes}
          onChange={(e) => setIssueNotes(e.target.value)}
          rows="3"
          className="mt-3 w-full border border-gray-300 rounded-lg p-3 text-sm"
          placeholder="Notes about chip-level diagnosis..."
        />
      </div>

      <div className="border rounded-lg p-4 bg-amber-50/40">
        <label className="flex items-center gap-2 font-semibold text-amber-800">
          <input
            type="checkbox"
            checked={partsRequired}
            onChange={(e) => setPartsRequired(e.target.checked)}
            className="h-4 w-4 text-amber-600 rounded border-gray-300"
          />
          Parts required
        </label>
        {partsRequired && (
          <div className="mt-3 space-y-3">
            <textarea
              value={partsNotes}
              onChange={(e) => setPartsNotes(e.target.value)}
              rows="2"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              placeholder="Describe required parts or reason..."
            />

            <form onSubmit={handleRequestPart} className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="text"
                value={requestName}
                onChange={(e) => setRequestName(e.target.value)}
                placeholder="Part name (e.g. BIOS IC)"
                className="border rounded-lg p-2 text-sm"
                required
              />
              <input
                type="text"
                value={requestDesc}
                onChange={(e) => setRequestDesc(e.target.value)}
                placeholder="Description / specs"
                className="border rounded-lg p-2 text-sm"
              />
              <button className="bg-amber-600 text-white rounded-lg px-3 text-sm font-bold flex items-center justify-center gap-2">
                <PlusCircle className="w-4 h-4" /> Request Part
              </button>
            </form>

            {partRequests.length > 0 && (
              <div className="text-sm">
                <div className="font-semibold text-gray-700 mb-1">Part Requests</div>
                <div className="space-y-1">
                  {partRequests.map(req => (
                    <div key={req.request_id} className="flex items-center justify-between bg-white p-2 rounded border">
                      <div>
                        <div className="font-medium">{req.part_name}</div>
                        <div className="text-xs text-gray-500">{req.description}</div>
                      </div>
                      <span className={`text-xs font-bold ${req.status === 'procured' ? 'text-green-700' : 'text-amber-700'}`}>
                        {req.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border rounded-lg p-4">
        <div className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <Wrench className="w-4 h-4" />
          Attach Procured Part
        </div>
        <form onSubmit={handleAddPart} className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            className="border rounded-lg p-2 text-sm"
            required
          >
            <option value="">Select part</option>
            {parts.map(part => (
              <option key={part.part_id} value={part.part_id}>
                {part.part_name} (Stock: {part.quantity})
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="border rounded-lg p-2 text-sm"
            placeholder="Qty"
          />
          <input
            type="text"
            value={partNotes}
            onChange={(e) => setPartNotes(e.target.value)}
            className="border rounded-lg p-2 text-sm"
            placeholder="Notes"
          />
          <button className="bg-blue-600 text-white rounded-lg px-3 text-sm font-bold flex items-center justify-center gap-2">
            <PlusCircle className="w-4 h-4" /> Add Part
          </button>
        </form>
        {ticketParts.length > 0 && (
          <div className="mt-3 text-xs text-gray-600">
            Attached parts: {ticketParts.map(p => p.part_name).join(', ')}
          </div>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2">Repair Checklist</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {RESOLUTION_CHECKS.map(check => (
            <label key={check} className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={resolvedChecks.includes(check)}
                onChange={() => toggleResolved(check)}
                className="h-4 w-4 text-green-600 rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">{check}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <button
          onClick={handleSave}
          className="flex-1 bg-slate-100 text-slate-700 rounded-lg py-2 font-semibold flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" /> Save Draft
        </button>
        <button
          onClick={handleSubmit}
          disabled={processing}
          className="flex-1 bg-green-600 text-white rounded-lg py-2 font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <CheckCircle className="w-4 h-4" /> Submit & Return to Diagnosis
        </button>
      </div>
    </div>
  );
}
