import React, { useState } from 'react';
// import { api } from '../../../utils/api';
import { AlertTriangle, CheckCircle, Loader2, XCircle } from 'lucide-react';
import api from '../../../utils/api';


export default function PartFulfillment({ ticketId, requests, onFulfilled }) {
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [partId, setPartId] = useState(''); // Would ideally be a dropdown
    const [loading, setLoading] = useState(false);
  
    const handleFulfill = async (reqId) => {
      if (!partId) return alert('Please enter Part ID from inventory');
      setLoading(true);
      try {
        await api.post(`/tickets/${ticketId}/fulfill-part`, {
          request_id: reqId,
          part_id: parseInt(partId),
          quantity: 1,
          notes: 'Fulfilled via Procurement'
        });
        onFulfilled();
        alert('Part fulfilled');
        setSelectedRequest(null);
        setPartId('');
      } catch (error) {
        alert('Failed to fulfill part');
      } finally {
        setLoading(false);
      }
    };
  
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
        <h3 className="text-lg font-bold mb-4">Pending Part Requests</h3>
        <div className="space-y-4">
          {requests.filter(r => r.status === 'pending').length === 0 && <p className="text-gray-500">No pending requests.</p>}
          {requests.filter(r => r.status === 'pending').map(req => (
            <div key={req.request_id} className="border p-4 rounded-lg flex justify-between items-center">
              <div>
                <div className="font-bold">{req.part_name}</div>
                <div className="text-sm text-gray-600">{req.description}</div>
                <div className="text-xs text-gray-500">Requested by: {req.requested_by_name}</div>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Part ID to Assign"
                  className="border p-1 rounded w-32"
                  value={selectedRequest === req.request_id ? partId : ''}
                  onChange={(e) => {
                    setSelectedRequest(req.request_id);
                    setPartId(e.target.value);
                  }}
                />
                <button
                  onClick={() => handleFulfill(req.request_id)}
                  disabled={loading || selectedRequest !== req.request_id}
                  className="bg-green-600 text-white px-3 py-1 rounded text-sm"
                >
                  Fulfill
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }