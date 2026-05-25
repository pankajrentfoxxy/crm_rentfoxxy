import { PRIMARY, ACCENT } from './theme';

export default function Btn({ children, variant = 'primary', onClick, icon: Icon, small, type = 'button', disabled }) {
  const isPrimary = variant === 'primary';

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: small ? '6px 14px' : '8px 18px',
        borderRadius: 10, border: isPrimary ? 'none' : `1px solid ${PRIMARY}`,
        background: isPrimary ? `linear-gradient(135deg, ${PRIMARY}, ${ACCENT})` : 'transparent',
        color: isPrimary ? '#fff' : PRIMARY, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13,
        fontWeight: 600, whiteSpace: 'nowrap', transition: 'opacity .15s',
        opacity: disabled ? 0.6 : 1
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = '0.85'; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.opacity = '1'; }}
    >
      {Icon && <Icon size={14} />}{children}
    </button>
  );
}
