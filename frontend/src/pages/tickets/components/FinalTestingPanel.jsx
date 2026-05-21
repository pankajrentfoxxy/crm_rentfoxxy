import React, { useState, useEffect } from 'react';
import api from '../../../utils/api';


export default function FinalTestingPanel({ ticketId, ticketParts, onUpdated, onSubmitNext, processing }) {
    const [parts, setParts] = useState([]);
    const [partId, setPartId] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [notes, setNotes] = useState('');
    const [verification, setVerification] = useState({
      diagnosis_verified: false,
      software_verified: false,
      hardware_verified: false
    });
    const [finalNotes, setFinalNotes] = useState('');
    const [loading, setLoading] = useState(false);
  
    useEffect(() => {
      const loadParts = async () => {
        try {
          const { data } = await api.get('/parts');
          setParts(data.parts || []);
        } catch (e) {
          console.error('Load parts error:', e);
        }
      };
      loadParts();
    }, []);
  
    const handleAddPart = async (e) => {
      e.preventDefault();
      if (!partId) return alert('Select a part');
      if (!quantity || quantity < 1) return alert('Quantity must be at least 1');
  
      setLoading(true);
      try {
        await api.post(`/tickets/${ticketId}/parts`, {
          part_id: parseInt(partId),
          quantity_used: parseInt(quantity),
          notes: notes || 'Added during Final Testing'
        });
        setPartId('');
        setQuantity(1);
        setNotes('');
        onUpdated();
      } catch (e) {
        alert(e.response?.data?.message || 'Failed to attach part');
      } finally {
        setLoading(false);
      }
    };
  
    const handleSubmitFinal = () => {
      if (!verification.diagnosis_verified || !verification.software_verified || !verification.hardware_verified) {
        return alert('Please verify Diagnosis, Software, and Hardware checks before submitting.');
      }
      if (!finalNotes.trim()) {
        return alert('Please add final testing notes.');
      }
      onSubmitNext(
        {
          diagnosis_verified: true,
          software_verified: true,
          hardware_verified: true
        },
        null,
        `Final Testing Completed: ${finalNotes}`
      );
    };
  
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-bold mb-4">Final Testing - Attach Parts</h3>
        <p className="text-sm text-gray-600 mb-4">
          If a defect is found during Final Testing, select the required part and attach it to the ticket.
        </p>
  
        <form onSubmit={handleAddPart} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Part</label>
            <select
              value={partId}
              onChange={(e) => setPartId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-3 focus:ring-2 focus:ring-orange-500"
            >
              <option value="">Select part</option>
              {parts.map(p => (
                <option key={p.part_id} value={p.part_id}>
                  {p.part_name} (Qty: {p.quantity})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Qty</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-3 focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white py-3 rounded-lg font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? 'Attaching...' : 'Attach Part'}
            </button>
          </div>
          <div className="md:col-span-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-3 focus:ring-2 focus:ring-orange-500"
              placeholder="Describe the issue and fix..."
            />
          </div>
        </form>
  
        {ticketParts?.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Parts Attached to Ticket</h4>
            <div className="space-y-2">
              {ticketParts.map(part => (
                <div key={part.id || `${part.part_id}-${part.added_at}`} className="flex items-center justify-between text-sm">
                  <div className="text-gray-700">{part.part_name}</div>
                  <div className="text-gray-500">Qty: {part.quantity_used}</div>
                </div>
              ))}
            </div>
          </div>
        )}
  
        <div className="mt-6 border-t pt-6">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Final Testing Verification</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {[
              { key: 'diagnosis_verified', label: 'Diagnosis Verified' },
              { key: 'software_verified', label: 'Software Verified' },
              { key: 'hardware_verified', label: 'Hardware Verified' }
            ].map(item => (
              <label key={item.key} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={verification[item.key]}
                  onChange={(e) => setVerification(prev => ({ ...prev, [item.key]: e.target.checked }))}
                  className="h-5 w-5 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                />
                <span className="text-sm font-medium text-gray-700">{item.label}</span>
              </label>
            ))}
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Final Testing Notes</label>
            <textarea
              value={finalNotes}
              onChange={(e) => setFinalNotes(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-orange-500"
              rows="3"
              placeholder="Describe final verification, issues resolved, and readiness..."
            />
          </div>
          <button
            onClick={handleSubmitFinal}
            disabled={processing}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50"
          >
            {processing ? 'Processing...' : 'Submit Final Testing & Move Next'}
          </button>
        </div>
      </div>
    );
  } 