/** Sale vs Rental sales-order module scopes. */

export const SO_SCOPES = {
  sale: {
    key: 'sale',
    permissionSection: 'sales_orders_sale',
    listPath: '/sales-pipeline/sales-orders-sale',
    detailSegment: 'sales-orders-sale',
    brandName: 'Gorefurbo',
    brandColor: '#0ba86b',
    title: 'Sales Orders – Sale',
    subtitle: 'Sale & demo (Gorefurbo)',
    defaultQuotationType: 'sale',
    defaultBranch: 'gorefurbo',
    allowedTypes: ['sale', 'demo'],
    typeOptions: [
      { value: 'sale', label: 'Sale' },
      { value: 'demo', label: 'Demo (Sale)' },
    ],
  },
  rental: {
    key: 'rental',
    permissionSection: 'sales_orders_rental',
    listPath: '/sales-pipeline/sales-orders-rental',
    detailSegment: 'sales-orders-rental',
    brandName: 'Rentfoxxy',
    brandColor: '#f26b21',
    title: 'Sales Orders – Rental',
    subtitle: 'Rental & demo (Rentfoxxy)',
    defaultQuotationType: 'rental',
    defaultBranch: 'rentfoxxy',
    allowedTypes: ['rental', 'demo'],
    typeOptions: [
      { value: 'rental', label: 'Rental' },
      { value: 'demo', label: 'Demo (Rental)' },
    ],
  },
  replacement: {
    key: 'replacement',
    permissionSection: 'sales_orders_replacement',
    listPath: '/sales-pipeline/sales-orders-replacement',
    detailSegment: 'sales-orders-replacement',
    brandName: 'Support',
    brandColor: '#db2777',
    title: 'Replacement Sales Orders',
    subtitle: 'Support replacement orders (all)',
    defaultQuotationType: 'rental',
    defaultBranch: 'rentfoxxy',
    allowedTypes: ['rental'],
    typeOptions: [],
  },
};

export const SO_PERMISSION_SECTIONS = [
  'sales_orders_doc',
  'sales_orders_sale',
  'sales_orders_rental',
  'sales_orders_replacement',
];

/** Attach/detach laptops + Dispatch QC on sales order detail. */
export const SO_LAPTOP_QC_SECTION = 'so_laptop_qc';

export const SO_SERIAL_EDIT_SECTIONS = [
  ...SO_PERMISSION_SECTIONS,
  'delivery_challans',
  'replacement_so_laptop_qc',
  SO_LAPTOP_QC_SECTION,
];

/** Sections that unlock the Laptops & QC tab on SO detail. */
export const SO_LAPTOPS_TAB_VIEW_SECTIONS = [
  ...SO_PERMISSION_SECTIONS,
  'delivery_challans',
  'replacement_so_laptop_qc',
  SO_LAPTOP_QC_SECTION,
  'dispatch_workflow',
  'dispatch_pending_orders',
];

export function getSoScopeConfig(scope) {
  return SO_SCOPES[scope] || null;
}

export function resolveSoScopeFromPath(pathname = '') {
  if (pathname.includes('/sales-orders-sale')) return 'sale';
  if (pathname.includes('/sales-orders-rental')) return 'rental';
  if (pathname.includes('/sales-orders-replacement')) return 'replacement';
  return null;
}

export function orderMatchesScope(row, scope) {
  if (!scope) return true;
  const type = String(row?.quotation_type || '').toLowerCase();
  const entity = String(row?.entity_code || row?.branch || '').toLowerCase();
  if (scope === 'sale') {
    return type === 'sale' || type === 'sales' || entity === 'gorefurbo';
  }
  if (scope === 'rental') {
    if (type === 'rental') return true;
    if (type === 'demo') return entity !== 'gorefurbo';
    return type !== 'sale' && type !== 'sales' && entity !== 'gorefurbo';
  }
  return true;
}

export function salesOrderListPath(scope) {
  return getSoScopeConfig(scope)?.listPath || '/sales-pipeline/sales-orders';
}

export function salesOrderDetailPath(soNumber, scope) {
  if (!soNumber) return salesOrderListPath(scope);
  const segment = getSoScopeConfig(scope)?.detailSegment || 'sales-orders';
  return `/sales-pipeline/${segment}/${encodeURIComponent(soNumber)}`;
}

export function replacementSalesOrderDetailPath(soNumber) {
  return salesOrderDetailPath(soNumber, 'replacement');
}

export function soPermissionSectionsForGate() {
  return SO_PERMISSION_SECTIONS;
}
