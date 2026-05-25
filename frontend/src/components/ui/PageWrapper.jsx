export default function PageWrapper({ title, children, noPadding }) {
  return (
    <div style={{ padding: noPadding ? 0 : '28px 32px', minHeight: '100%' }}>
      {title && (
        <h1 style={{ margin: '0 0 24px', fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{title}</h1>
      )}
      {children}
    </div>
  );
}
