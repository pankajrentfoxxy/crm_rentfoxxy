import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import DCForm from '../components/DCForm';
import DispatchModal from '../components/DispatchModal';
import QcStatusBadge from '../components/QcStatusBadge';
import { getDcQcStatus, listDCs } from '../salesPipelineApi';
import { DC_STATUS_STYLES, DISPATCH_MODE_STYLES, formatDate, statusLabel } from '../salesPipelineUtils';

const TABS = ['all', 'pending', 'in_transit', 'delivered', 'rejected'];

export default function DeliveryChallanListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [qcMap, setQcMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [dcDrawer, setDcDrawer] = useState(false);
  const [dispatchDc, setDispatchDc] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDCs({ limit: 100 });
      let list = res.data?.delivery_challans || [];
      if (tab !== 'all') list = list.filter((r) => (r.status || 'pending') === tab);
      setRows(list);
      const qcEntries = await Promise.all(
        list.slice(0, 30).map(async (r) => {
          try {
            const q = await getDcQcStatus(r.dc_number);
            return [r.dc_number, q.data];
          } catch {
            return [r.dc_number, null];
          }
        })
      );
      setQcMap(Object.fromEntries(qcEntries));
    } catch {
      toast.error('Failed to load delivery challans');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    total: rows.length,
    pending: rows.filter((r) => !r.status || r.status === 'pending').length,
    in_transit: rows.filter((r) => r.status === 'in_transit').length,
    delivered: rows.filter((r) => r.status === 'delivered').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
  }), [rows]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Delivery Challans</h1>
          <p className="text-sm text-gray-500">DC-* series</p>
        </div>
        <PermissionGate section="delivery_challans" action="create">
          <button type="button" onClick={() => setDcDrawer(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
            <Plus className="w-4 h-4" /> Create DC
          </button>
        </PermissionGate>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[['Total', stats.total], ['Pending', stats.pending], ['In Transit', stats.in_transit], ['Delivered', stats.delivered], ['Rejected', stats.rejected]].map(([l, v]) => (
          <div key={l} className="bg-white border rounded-lg p-3 text-center"><p className="text-xs text-gray-500">{l}</p><p className="text-lg font-semibold">{v}</p></div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>{t.replace('_', ' ')}</button>
        ))}
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase text-left">
            <tr>
              <th className="px-4 py-3">DC #</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">SO #</th>
              <th className="px-4 py-3">Dispatch</th>
              <th className="px-4 py-3">QC</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.map((row) => {
              const qc = qcMap[row.dc_number];
              return (
                <tr key={row.dc_number} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-blue-700">{row.dc_number}</td>
                  <td className="px-4 py-3">{formatDate(row.created_at)}</td>
                  <td className="px-4 py-3">{row.customer_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.sales_order_number}</td>
                  <td className="px-4 py-3">
                    {row.dispatch_mode ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs ${DISPATCH_MODE_STYLES[row.dispatch_mode]}`}>{row.dispatch_mode}</span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <QcStatusBadge
                      allPassed={qc?.all_passed}
                      pendingCount={qc?.pending_count}
                      failedCount={qc?.tickets?.filter((t) => t.status === 'qc_failed').length}
                      totalCount={qc?.total_count}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${DC_STATUS_STYLES[row.status || 'pending']}`}>{statusLabel(row.status || 'pending')}</span>
                  </td>
                  <td className="px-4 py-3 space-x-2">
                    <button type="button" className="text-blue-600 text-xs" onClick={() => navigate(`/sales-pipeline/delivery-challans/${row.dc_number}`)}>View</button>
                    {(row.status === 'pending' || !row.status) && qc?.all_passed && (
                      <PermissionGate section="dispatch_ops" action="edit">
                        <button type="button" className="text-xs text-teal-700" onClick={() => setDispatchDc(row.dc_number)}>Dispatch</button>
                      </PermissionGate>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DCForm open={dcDrawer} onClose={() => setDcDrawer(false)} />
      <DispatchModal
        open={Boolean(dispatchDc)}
        dcNumber={dispatchDc}
        qcBlocked={dispatchDc && !qcMap[dispatchDc]?.all_passed}
        onClose={() => setDispatchDc(null)}
        onDispatched={load}
      />
    </div>
  );
}
