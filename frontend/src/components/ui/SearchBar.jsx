import { Search } from 'lucide-react';

export default function SearchBar({ placeholder = 'Search...', value, onChange }) {
  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
      <input
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        style={{
          width: '100%', padding: '8px 12px 8px 36px', border: '1px solid #e2e8f0',
          borderRadius: 10, fontSize: 13, color: '#0f172a', background: '#f8fafc',
          outline: 'none', boxSizing: 'border-box'
        }}
      />
    </div>
  );
}
