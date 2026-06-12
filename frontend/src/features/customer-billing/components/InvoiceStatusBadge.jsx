const STYLES = {
  draft: 'bg-gray-100 text-gray-800',
  sent: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  cancelled: 'bg-red-50 text-red-600',
};

export default function InvoiceStatusBadge({ status }) {
  const s = status || 'draft';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STYLES[s] || STYLES.draft}`}>
      {s}
    </span>
  );
}
