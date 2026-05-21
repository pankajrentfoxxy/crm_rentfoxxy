import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';

export default function BulkMoveModal({ stages, onClose, onConfirm }) {
    const [currentStageId, setCurrentStageId] = useState('');
    const [targetStageId, setTargetStageId] = useState('');
    const [loading, setLoading] = useState(false);
  
    const handleSubmit = async (e) => {
      e.preventDefault();
      if (!currentStageId || !targetStageId) return alert('Please select both stages');
  
      setLoading(true);
      await onConfirm(currentStageId, targetStageId);
      setLoading(false);
    };
  
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-blue-600" />
            Bulk Move Tickets
          </h3>
          <p className="text-gray-600 text-sm mb-6">Move ALL tickets from one stage to another. This action cannot be undone easily.</p>
  
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Stage (Source)</label>
              <select
                value={currentStageId}
                onChange={(e) => setCurrentStageId(e.target.value)}
                className="w-full border rounded-lg p-2"
                required
              >
                <option value="">Select Source Stage</option>
                {stages.map(s => <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>)}
              </select>
            </div>
  
            <div className="flex justify-center text-gray-400">
              <ArrowRight className="w-6 h-6 transform rotate-90 md:rotate-0" />
            </div>
  
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Stage (Target)</label>
              <select
                value={targetStageId}
                onChange={(e) => setTargetStageId(e.target.value)}
                className="w-full border rounded-lg p-2"
                required
              >
                <option value="">Select Target Stage</option>
                {stages.map(s => <option key={s.stage_id} value={s.stage_id}>{s.stage_order}. {s.stage_name}</option>)}
              </select>
            </div>
  
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Moving...' : 'Move Tickets'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }