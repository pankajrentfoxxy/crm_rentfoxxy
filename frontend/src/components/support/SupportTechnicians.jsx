import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../../utils/api';
import { workloadTone } from './utils';

export default function SupportTechnicians() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/support/technicians')
      .then((r) => setRows(r.data.technicians || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" />
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Open tickets</th>
            <th className="px-4 py-3">Open items</th>
            <th className="px-4 py-3">Workload</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = workloadTone(row.open_item_count || 0);
            const width = Math.min(100, (row.open_item_count || 0) * 8);
            return (
              <tr key={row.user_id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3">{row.open_ticket_count ?? 0}</td>
                <td className="px-4 py-3">{row.open_item_count ?? 0}</td>
                <td className="px-4 py-3">
                  <div className="h-2 w-24 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full ${tone === 'high' ? 'bg-red-500' : tone === 'medium' ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </td>
                <td className="px-4 py-3">{row.active ? 'Active' : 'Inactive'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="p-6 text-slate-500">No technicians found.</p>}
    </div>
  );
}
