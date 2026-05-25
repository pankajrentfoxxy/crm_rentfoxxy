import { useEffect, useRef, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { cardStyle } from './theme';

const DEFAULT_COLORS = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#6366f1',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6',
  '#028BBF', '#02437B', '#7c3aed', '#0891b2',
];

export default function DonutChart({
  title,
  data = [],
  centerLabel = 'TOTAL',
  emptyMessage = 'No data available.',
  height = 240,
}) {
  const containerRef = useRef(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateWidth = () => setChartWidth(el.offsetWidth || 300);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const legendData = data.map((d, i) => ({
    name: d.name || 'Unknown',
    value: Number(d.value) || 0,
    color: d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
  }));

  const pieData = legendData.filter(d => d.value > 0);
  const total = legendData.reduce((sum, d) => sum + d.value, 0);
  const outerRadius = Math.min(chartWidth / 2 - 8, height / 2 - 8, 100);
  const innerRadius = outerRadius * 0.62;

  const hasData = legendData.length > 0;

  return (
    <div style={{ ...cardStyle, padding: '20px 24px' }}>
      {title && (
        <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</h3>
      )}

      {!hasData ? (
        <p style={{ margin: '24px 0', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>{emptyMessage}</p>
      ) : (
        <>
          <div
            ref={containerRef}
            style={{ position: 'relative', width: '100%', height, minHeight: height, marginBottom: 8 }}
          >
            {chartWidth > 0 && pieData.length > 0 && (
              <PieChart width={chartWidth} height={height}>
                <Pie
                  data={pieData}
                  cx={chartWidth / 2}
                  cy={height / 2}
                  innerRadius={innerRadius}
                  outerRadius={outerRadius}
                  dataKey="value"
                  nameKey="name"
                  stroke="#fff"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={entry.name + i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [value, name]}
                  contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
              </PieChart>
            )}

            {chartWidth > 0 && pieData.length === 0 && (
              <div style={{
                width: outerRadius * 2, height: outerRadius * 2, margin: '0 auto',
                borderRadius: '50%', border: `${outerRadius - innerRadius}px solid #e2e8f0`,
                boxSizing: 'border-box'
              }} />
            )}

            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none'
            }}>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: '#0f172a', lineHeight: 1 }}>{total}</p>
              <p style={{ margin: '4px 0 0', fontSize: 10, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.06em' }}>
                {centerLabel}
              </p>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '10px 16px',
            marginTop: 4
          }}>
            {legendData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: d.value > 0 ? d.color : '#cbd5e1',
                  flexShrink: 0
                }} />
                <span style={{
                  fontSize: 12,
                  color: d.value > 0 ? '#475569' : '#94a3b8',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {d.name} ({d.value})
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
