import { X } from 'lucide-react';
import { PRIMARY } from './theme';

export default function Drawer({ open, onClose, title, children, width = 340 }) {
  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60 }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width, maxWidth: '92vw',
        background: '#fff', zIndex: 61, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #f1f5f9', flexShrink: 0
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 6,
              borderRadius: 8, color: '#64748b', display: 'flex', alignItems: 'center'
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {children}
        </div>
      </div>
    </>
  );
}

export function DrawerSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {title && (
        <p style={{
          margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: PRIMARY,
          textTransform: 'uppercase', letterSpacing: '0.04em'
        }}>
          {title}
        </p>
      )}
      <div style={{
        border: '1px solid #e8f0f8', borderRadius: 10, padding: '4px 0',
        maxHeight: 200, overflowY: 'auto'
      }}>
        {children}
      </div>
    </div>
  );
}
