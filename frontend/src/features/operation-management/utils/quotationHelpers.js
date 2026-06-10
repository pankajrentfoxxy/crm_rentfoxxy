export function formatStateLabel(state) {
  if (!state) return 'N/A';
  return String(state)
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function shippingAddressLabel(addr) {
  if (!addr) return '';
  return [
    formatStateLabel(addr.name),
    addr.phone,
    formatStateLabel(addr.country),
    formatStateLabel(addr.state),
    formatStateLabel(addr.city),
    addr.zip_code,
    formatStateLabel(addr.address),
  ]
    .filter(Boolean)
    .join(', ');
}

export function branchForQuotationType(type) {
  if (type === 'sale') return 'gorefurbo';
  if (type === 'rental' || type === 'demo') return 'rentfoxxy';
  return '';
}

export function isRentalType(type) {
  return type === 'rental' || type === 'demo';
}

export function exportRowsToCsv(filename, headers, rows) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
