import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, EmptyState } from '../../../components/ui/primitives';
import { WorkOrderCard } from '../../../components/ui/supportPrimitives';
import { listWorkOrders } from '../supportV2Api';
import OfflineBanner from '../components/OfflineBanner';
import { SUPPORT_V2_BASE } from '../supportV2Utils';

export default function MyBucketPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    listWorkOrders({ assigned_to: 'ME', limit: 50 })
      .then((r) => setRows(r.data?.rows || []))
      .catch(() => setRows([]));
  }, []);
  return (
    <div className="p-4 max-w-2xl mx-auto space-y-3">
      <PageHeader title="My bucket" subtitle="Your jobs. Desktop-usable; mobile polish is Phase 9." />
      <OfflineBanner />
      {rows.length ? rows.map((w) => (
        <WorkOrderCard
          key={w.wo_id}
          woNumber={w.wo_number}
          type={w.wo_type}
          status={w.status}
          priority={w.priority}
          title={w.customer_name}
          subtitle={w.document_number}
          onClick={() => nav(`${SUPPORT_V2_BASE}/jobs/${w.wo_id}`)}
        />
      )) : <EmptyState title="No jobs" hint="Nothing assigned to you." />}
    </div>
  );
}
