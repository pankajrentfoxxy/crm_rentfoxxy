import { PRIMARY } from '../../../components/ui';

export default function LeadMessageBanner({ message }) {
    if (!message) return null;

    return (
        <div style={{
            marginBottom: 12, padding: '8px 12px', fontSize: 13, color: PRIMARY,
            background: '#e8f4fc', borderRadius: 10, border: '1px solid #e8f0f8'
        }}>
            {message}
        </div>
    );
}
