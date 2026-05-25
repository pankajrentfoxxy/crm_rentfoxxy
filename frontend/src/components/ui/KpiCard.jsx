import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function KpiCard({ title, value, icon: Icon, trend, percent, color }) {
  const isUp = trend === 'up';

  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '20px 22px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(2,67,123,0.06)',
      border: '1px solid #e8f0f8', transition: 'transform .2s, box-shadow .2s',
      cursor: 'default', flex: 1, minWidth: 160
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(2,67,123,0.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(2,67,123,0.06)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: '#64748b', fontWeight: 500, marginBottom: 6 }}>{title}</p>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.5px' }}>{value}</p>
        </div>
        {Icon && (
          <div style={{
            width: 42, height: 42, borderRadius: 12, background: color + '18',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Icon size={20} color={color} />
          </div>
        )}
      </div>
      {percent && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          {isUp ? <ArrowUpRight size={14} color="#22c55e" /> : <ArrowDownRight size={14} color="#ef4444" />}
          <span style={{ fontSize: 12, color: isUp ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{percent}</span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>vs last month</span>
        </div>
      )}
    </div>
  );
}
