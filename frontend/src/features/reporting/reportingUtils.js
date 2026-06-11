export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const monthLabel = (m, y) => {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${M[(m || 1) - 1]} ${y || ''}`;
};

export const trend = (cur, prev) => {
  if (!prev || prev === 0) return null;
  const pct = ((cur - prev) / prev * 100).toFixed(1);
  return { pct: Math.abs(pct), up: cur >= prev };
};

export const defaultRange = () => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};

export const LEAD_STATUS_COLORS = {
  Pending: '#6B7280',
  Cold: '#3B82F6',
  Warm: '#F59E0B',
  Hot: '#EF4444',
  Deal: '#16A34A',
  Demo: '#8B5CF6',
};

export const METRIC_COLORS = {
  blue: 'text-blue-600',
  green: 'text-green-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
  purple: 'text-purple-600',
};

export const METRIC_BG = {
  blue: 'bg-blue-100 text-blue-600',
  green: 'bg-green-100 text-green-600',
  amber: 'bg-amber-100 text-amber-600',
  red: 'bg-red-100 text-red-600',
  purple: 'bg-purple-100 text-purple-600',
};
