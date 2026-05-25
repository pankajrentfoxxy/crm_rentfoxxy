const STATUS_MAP = {
  Active: { bg: '#dcfce7', color: '#166534', dot: '#22c55e' },
  'On Leave': { bg: '#fef9c3', color: '#854d0e', dot: '#eab308' },
  Inactive: { bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
  'In Stock': { bg: '#dcfce7', color: '#166534', dot: '#22c55e' },
  'Low Stock': { bg: '#fef9c3', color: '#854d0e', dot: '#eab308' },
  'Out of Stock': { bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
  Completed: { bg: '#dcfce7', color: '#166534', dot: '#22c55e' },
  Pending: { bg: '#fef9c3', color: '#854d0e', dot: '#eab308' },
  open: { bg: '#e0f2fe', color: '#0369a1', dot: '#0284c7' },
  completed: { bg: '#dcfce7', color: '#166534', dot: '#22c55e' },
};

export default function Badge({ status, children }) {
  const label = children ?? status;
  const s = STATUS_MAP[status] || { bg: '#e0f2fe', color: '#0369a1', dot: '#0284c7' };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
      borderRadius: 20, background: s.bg, color: s.color, fontSize: 12, fontWeight: 500
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
      {label}
    </span>
  );
}

export function Tag({ children, color = '#0369a1', bg = '#e0f2fe' }) {
  return (
    <span style={{
      background: bg, color, fontSize: 11, padding: '2px 10px',
      borderRadius: 20, fontWeight: 500, display: 'inline-block'
    }}>
      {children}
    </span>
  );
}
