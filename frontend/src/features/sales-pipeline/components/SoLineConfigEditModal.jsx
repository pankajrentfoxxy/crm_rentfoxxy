import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import AssetDetailsForm from '../../operation-management/components/AssetDetailsForm';
import { getSalesOrderMeta, updateSoLineConfig } from '../salesPipelineApi';

export default function SoLineConfigEditModal({ open, line, onClose, onSaved }) {
  const [catalog, setCatalog] = useState(null);
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !line) return;
    setLines([{
      brand: line.brand || '',
      model_name: line.model_name || '',
      processor: line.processor || '',
      generation: line.generation || '',
      ram: line.ram || '',
      storage: line.storage || '',
      gpu: line.gpu || '',
      screen_size: line.screen_size || '',
      quantity: line.ordered_qty || 1,
      rate: line.rate || '',
    }]);
    getSalesOrderMeta()
      .then((res) => setCatalog(res.data?.catalog || null))
      .catch(() => toast.error('Failed to load config options'));
  }, [open, line]);

  if (!open || !line) return null;

  const handleSave = async () => {
    const row = lines[0] || {};
    if (!row.processor || !row.generation || !row.ram || !row.storage) {
      toast.error('Processor, generation, RAM, and storage are required');
      return;
    }
    setSaving(true);
    try {
      await updateSoLineConfig(line.line_id, {
        brand: row.brand,
        model_name: row.model_name,
        processor: row.processor,
        generation: row.generation,
        ram: row.ram,
        storage: row.storage,
        gpu: row.gpu,
        screen_size: row.screen_size,
      });
      toast.success('Line config updated');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update config');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Edit order line config</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Super Admin only — correct processor, generation, RAM, and storage so inventory can be matched.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          <AssetDetailsForm
            lines={lines}
            onChange={setLines}
            catalog={catalog}
            quotationType={line.quotation_type || 'rental'}
            requiredFields={['brand', 'model_name', 'processor', 'generation', 'ram', 'storage']}
          />
        </div>
        <div className="sticky bottom-0 bg-gray-50 border-t px-5 py-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-white">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save config'}
          </button>
        </div>
      </div>
    </div>
  );
}
