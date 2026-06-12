import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getSalespersonReport } from '../reportingApi';
import { defaultRange } from '../reportingUtils';
import ReportFilters from '../components/ReportFilters';
import ExportButton from '../components/ExportButton';

export default function SalespersonReportPage() {
  const [filters, setFilters] = useState(() => defaultRange());
  const [salespeople, setSalespeople] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f = filters) => {
    setLoading(true);
    try {
      const res = await getSalespersonReport(f);
      setSalespeople(res.data?.salespeople || []);
    } catch {
      toast.error('Failed to load salesperson report');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, []);

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Salesperson Report</h1>
        <p className="text-sm text-gray-500">Individual sales performance</p>
      </div>

      <ReportFilters filters={filters} onChange={setFilters} onApply={load} fields={['dateRange']} />

      {loading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {salespeople.map((sp) => {
            const convRate = sp.leads?.total
              ? Math.round((sp.leads.converted / sp.leads.total) * 100)
              : 0;
            return (
              <div key={sp.user_id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="font-semibold text-gray-900">{sp.name}</h3>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">{sp.role}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center text-sm mb-4">
                  {[
                    ['Total Leads', sp.leads?.total ?? 0],
                    ['Active', sp.leads?.active ?? 0],
                    ['Converted', sp.leads?.converted ?? 0],
                    ['Lost', sp.leads?.lost ?? 0],
                    ['Quotations Sent', sp.quotations?.sent ?? 0],
                    ['Hit Rate', `${sp.quotations?.hit_rate_pct ?? 0}%`],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="font-semibold text-gray-900 mt-0.5">{val}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Conversion rate</span>
                    <span>{convRate}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${convRate}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !salespeople.length && (
        <p className="text-sm text-gray-500 text-center py-8">No salesperson data for this period</p>
      )}

      <ExportButton reportType="salesperson" filters={filters} />
    </div>
  );
}
