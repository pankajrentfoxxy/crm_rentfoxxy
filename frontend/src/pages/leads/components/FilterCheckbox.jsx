export default function FilterCheckbox({ checked, indeterminate, onChange, label, bold }) {
    return (
        <label style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12,
            cursor: 'pointer', fontWeight: bold ? 600 : 400, color: '#334155'
        }}>
            <input
                type="checkbox"
                checked={checked}
                ref={(el) => { if (el) el.indeterminate = indeterminate; }}
                onChange={onChange}
            />
            <span>{label}</span>
        </label>
    );
}
