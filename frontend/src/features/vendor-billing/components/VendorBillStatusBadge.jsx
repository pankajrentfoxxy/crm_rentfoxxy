const STYLES = {
  generated: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  disputed: 'bg-red-100 text-red-800',
};

export default function VendorBillStatusBadge({ status }) {
  const s = status || 'generated';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STYLES[s] || STYLES.generated}`}>
      {s}
    </span>
  );
}
