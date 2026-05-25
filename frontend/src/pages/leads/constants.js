export const STATUS_OPTIONS = ['Pending', 'Cold', 'Warm', 'Hot', 'Gone', 'Hold', 'Rejected', 'Call Back', 'Demo', 'Deal'];
export const SOURCE_OPTIONS = ['Google', 'LinkedIn', 'Team', 'References', 'Apollo'];
export const LEAD_PAGE_SIZE = 50;

export const todayDate = () => new Date().toISOString().slice(0, 10);

export const dateInputStyle = {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    background: '#fff',
    width: '100%',
    boxSizing: 'border-box'
};
