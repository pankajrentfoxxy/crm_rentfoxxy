export default function Avatar({ name, size = 32 }) {
  const displayName = name || '?';
  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#028BBF', '#02437B', '#0369a1', '#0284c7', '#0ea5e9'];
  const idx = displayName.charCodeAt(0) % colors.length;

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: colors[idx],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.35, fontWeight: 600, flexShrink: 0
    }}>
      {initials}
    </div>
  );
}
