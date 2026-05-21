import { useState, useEffect } from 'react';
import { ClipboardList, Users, Clock, CheckCircle } from 'lucide-react';
import api from '../utils/api';

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
  
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
      return <div className="text-center py-12">Loading dashboard...</div>;
    }
  
    const statCards = [
      { label: 'Total Laptop on Floor', value: stats?.totalTickets || 0, icon: ClipboardList, color: 'blue' },
      { label: 'Active Users', value: stats?.activeUsers || 0, icon: Users, color: 'green' },
      { label: 'Avg. Hour', value: stats?.avgCompletionHours || 0, icon: Clock, color: 'yellow' },
      { label: 'Completed', value: stats?.ticketsByStatus?.find(s => s.status === 'completed')?.count || 0, icon: CheckCircle, color: 'purple' },
    ];
  
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">Dashboard</h2>
          <p className="text-gray-600">Overview of your refurbishment operations</p>
        </div>
  
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat, idx) => (
            <div key={idx} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-lg bg-${stat.color}-100`}>
                  <stat.icon className={`w-6 h-6 text-${stat.color}-600`} />
                </div>
              </div>
              <h3 className="text-3xl font-bold mb-1">{stat.value}</h3>
              <p className="text-gray-600 text-sm">{stat.label}</p>
            </div>
          ))}
        </div>
  
        {/* Tickets by Stage */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold mb-4">Tickets by Stage</h3>
          <div className="space-y-3">
            {stats?.ticketsByStage?.map((stage, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-bold text-blue-600">
                    {stage.stage_order}
                  </div>
                  <span className="font-medium">{stage.stage_name}</span>
                </div>
                <span className="px-3 py-1 bg-gray-100 rounded-full text-sm font-semibold">
                  {stage.count} tickets
                </span>
              </div>
            ))}
          </div>
        </div>
  
        {/* Recent Tickets */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold mb-4">Recent Tickets</h3>
          <div className="space-y-3">
            {stats?.recentTickets?.slice(0, 5).map((ticket) => (
              <div key={ticket.ticket_id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium">{ticket.serial_number}</p>
                  <p className="text-sm text-gray-500">{ticket.brand} {ticket.model}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-blue-600">{ticket.stage_name}</p>
                  <p className="text-xs text-gray-500">{new Date(ticket.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }