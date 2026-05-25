import { useState, useEffect } from 'react';
import { ClipboardList, Users, Clock, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import {
  PRIMARY, ACCENT, PageWrapper, KpiCard, DataTable, DonutChart,
  TableRow, TableCell, Tag
} from '../components/ui';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const { data } = await api.get('/analytics/dashboard');
      setStats(data.stats);
    } catch (error) {
      console.error('Load stats error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <p style={{ color: '#64748b', fontSize: 14 }}>Loading dashboard...</p>
        </div>
      </PageWrapper>
    );
  }

  const statCards = [
    { label: 'Total Laptop on Floor', value: stats?.totalTickets || 0, icon: ClipboardList, color: PRIMARY },
    { label: 'Active Users', value: stats?.activeUsers || 0, icon: Users, color: ACCENT },
    { label: 'Avg. Hour', value: stats?.avgCompletionHours || 0, icon: Clock, color: '#7c3aed' },
    { label: 'Completed', value: stats?.ticketsByStatus?.find(s => s.status === 'completed')?.count || 0, icon: CheckCircle, color: '#0891b2' },
  ];

  const firstName = user?.name?.split(' ')[0] || 'there';
  const stages = stats?.ticketsByStage || [];
  const recentTickets = stats?.recentTickets?.slice(0, 5) || [];

  return (
    <PageWrapper>
      <div style={{ marginBottom: 24 }}>
        <div style={{
          background: `linear-gradient(135deg, ${PRIMARY} 0%, ${ACCENT} 100%)`,
          borderRadius: 16, padding: '22px 28px', color: '#fff',
          boxShadow: '0 4px 24px rgba(2,67,123,0.25)'
        }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Welcome back, {firstName}!</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.8 }}>Overview of your refurbishment operations.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16, marginBottom: 24 }}>
        {statCards.map((stat, idx) => (
          <KpiCard key={idx} title={stat.label} value={stat.value} icon={stat.icon} color={stat.color} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        <DonutChart
          title="Tickets by Stage"
          centerLabel="DEVICES"
          data={stages.map(stage => ({
            name: stage.stage_name,
            value: Number(stage.count) || 0,
          }))}
          emptyMessage="No stage data available."
        />

        <DataTable
          title="Recent Tickets"
          columns={['SERIAL', 'DEVICE', 'STAGE', 'DATE']}
          data={recentTickets}
          emptyMessage="No recent tickets."
          renderRow={(ticket) => (
            <TableRow key={ticket.ticket_id}>
              <TableCell bold>{ticket.serial_number}</TableCell>
              <TableCell muted>{ticket.brand} {ticket.model}</TableCell>
              <TableCell>
                <Tag bg="#e0f2fe" color={ACCENT}>{ticket.stage_name}</Tag>
              </TableCell>
              <TableCell muted small>{new Date(ticket.created_at).toLocaleDateString()}</TableCell>
            </TableRow>
          )}
        />
      </div>
    </PageWrapper>
  );
}
