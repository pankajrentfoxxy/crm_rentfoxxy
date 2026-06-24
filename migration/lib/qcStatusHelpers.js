/**
 * ERP ↔ CRM QC status mapping (mirrors migration/scripts/013_serial_numbers.js).
 */
function str(val, maxLen, fallback = '') {
  const s = val == null ? '' : String(val).trim();
  if (!s) return fallback;
  return maxLen ? s.slice(0, maxLen) : s;
}

function mapQcStatus(erpStatus) {
  return str(erpStatus, 64, 'pending').toLowerCase();
}

function mapInventoryStatus(erpStatus, erpStatus2) {
  const s2 = str(erpStatus2, 64, '').toLowerCase();
  if (s2 === 'repared') return 'in_repair';
  if (s2 === 'qc_reject') return 'qc_failed';
  if (s2 === 'replace') return 'replace';
  if (s2) return s2;

  const s = str(erpStatus, 64, 'pending').toLowerCase();
  const map = {
    passed: 'in_stock',
    pending: 'in_stock',
    failed: 'qc_failed',
    out_stock: 'out_stock',
    out_for_repare: 'in_repair',
    out_for_return: 'returned',
    dead: 'scrapped',
    require_for_parts: 'require_for_parts',
    in_stock: 'in_stock',
  };
  return map[s] || null;
}

/** CRM QC Process list count — matches ERP pending QC queue. */
const CRM_QC_PROCESS_COUNT_SQL = `
  SELECT COUNT(*)::int AS c
  FROM vendor_serial_numbers s
  INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
  WHERE s.deleted_at IS NULL
    AND s.po_id IS NOT NULL
    AND COALESCE(
          NULLIF(TRIM(s.qc_status), ''),
          NULLIF(TRIM(s.extra->>'status'), ''),
          'pending'
        ) = 'pending'
`;

module.exports = {
  mapQcStatus,
  mapInventoryStatus,
  CRM_QC_PROCESS_COUNT_SQL,
};
