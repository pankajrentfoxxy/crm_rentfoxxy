import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { PageHeader, StatCard, Button, Badge, ResponsiveTable } from '../../../components/ui/primitives';
import DCForm from '../components/DCForm';
import DispatchModal from '../components/DispatchModal';
import QcStatusBadge from '../components/QcStatusBadge';
import { getDcQcStatus, listDCs } from '../salesPipelineApi';
import { DC_STATUS_STYLES, DISPATCH_MODE_STYLES, formatDate, statusLabel, deliveryChallanDetailPath } from '../salesPipelineUtils';

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

  const dispatchCell = (row) => {
    const qc = qcMap[row.dc_number];
    const canDispatch = (row.status === 'pending' || !row.status) && qc?.all_passed;
    return (
      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="text-blue-600 text-sm font-semibold" onClick={() => navigate(deliveryChallanDetailPath(row.dc_number))}>View</button>
        {canDispatch && (
          <PermissionGate section="dispatch_ops" action="edit">
            <button type="button" className="text-sm text-teal-700 font-semibold" onClick={() => setDispatchDc(row.dc_number)}>Dispatch</button>
          </PermissionGate>
        )}
      </div>
    );
  };

  const columns = [
    { key: 'dc_number', header: 'DC #', render: (r) => <span className="font-mono text-blue-700 font-semibold">{r.dc_number}</span> },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.created_at) },
    { key: 'customer_name', header: 'Customer' },
    { key: 'so', header: 'SO #', render: (r) => <span className="font-mono text-xs">{r.sales_order_number || '—'}</span> },
    { key: 'dispatch', header: 'Dispatch', render: (r) => (r.dispatch_mode ? <span className={`px-2 py-0.5 rounded-full text-xs ${DISPATCH_MODE_STYLES[r.dispatch_mode]}`}>{r.dispatch_mode}</span> : '—') },
    {
      key: 'qc',
      header: 'QC',
      render: (r) => {
        const qc = qcMap[r.dc_number];
        return (
          <QcStatusBadge
            allPassed={qc?.all_passed}
            pendingCount={qc?.pending_count}
            failedCount={qc?.tickets?.filter((t) => t.status === 'qc_failed').length}
            totalCount={qc?.total_count}
          />
        );
      },
    },
    { key: 'status', header: 'Status', render: (r) => <span className={`px-2 py-0.5 rounded-full text-xs ${DC_STATUS_STYLES[r.status || 'pending']}`}>{statusLabel(r.status || 'pending')}</span> },
    { key: 'actions', header: 'Actions', render: dispatchCell },
  ];

  const renderCard = (r) => {
    const qc = qcMap[r.dc_number];
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-blue-700 font-semibold">{r.dc_number}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs ${DC_STATUS_STYLES[r.status || 'pending']}`}>{statusLabel(r.status || 'pending')}</span>
        </div>
        <p className="font-medium text-slate-800">{r.customer_name}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{formatDate(r.created_at)}</span>
          {r.sales_order_number && <span className="font-mono">SO {r.sales_order_number}</span>}
          {r.dispatch_mode && <span className={`px-2 py-0.5 rounded-full ${DISPATCH_MODE_STYLES[r.dispatch_mode]}`}>{r.dispatch_mode}</span>}
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <QcStatusBadge
            allPassed={qc?.all_passed}
            pendingCount={qc?.pending_count}
            failedCount={qc?.tickets?.filter((t) => t.status === 'qc_failed').length}
            totalCount={qc?.total_count}
          />
          {dispatchCell(r)}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Delivery Challans"
        subtitle="DC-* series"
        icon={Truck}
        actions={(
          <PermissionGate section="delivery_challans" action="create">
            <Button icon={Plus} onClick={() => setDcDrawer(true)}>Create DC</Button>
          </PermissionGate>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <StatCard label="Total" value={stats.total} tone="gray" />
        <StatCard label="Pending" value={stats.pending} tone="amber" />
        <StatCard label="In Transit" value={stats.in_transit} tone="blue" />
        <StatCard label="Delivered" value={stats.delivered} tone="green" />
        <StatCard label="Rejected" value={stats.rejected} tone="red" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 min-h-[36px] rounded-full text-xs font-medium capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>{t.replace('_', ' ')}</button>
        ))}
      </div>

      <ResponsiveTable
        columns={columns}
        rows={rows}
        keyField="dc_number"
        loading={loading}
        renderCard={renderCard}
        onRowClick={(r) => navigate(deliveryChallanDetailPath(r.dc_number))}
      />

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
