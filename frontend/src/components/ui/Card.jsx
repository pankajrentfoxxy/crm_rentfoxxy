import { cardStyle } from './theme';

export default function Card({ title, children, toolbar, style }) {
  return (
    <div style={{ ...cardStyle, padding: toolbar ? 0 : '20px 24px', overflow: 'hidden', ...style }}>
      {toolbar && (
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>{toolbar}</div>
      )}
      <div style={{ padding: toolbar ? '20px 24px' : 0 }}>
        {title && !toolbar && (
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</h3>
        )}
        {children}
      </div>
    </div>
  );
}
