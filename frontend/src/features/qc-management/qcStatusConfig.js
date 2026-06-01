/** CRM route segment → API / Laravel serial_numbers.status */
export const QC_STATUS_BY_ROUTE = {
  processing: 'pending',
  passed: 'passed',
  failed: 'failed',
  'dead-assets': 'dead',
  'require-for-parts': 'require_for_parts'
};

export const QC_LIST_META = {
  processing: {
    title: 'QC Processing List',
    apiStatus: 'pending',
    showQcActions: true
  },
  passed: {
    title: 'QC Passed List',
    apiStatus: 'passed',
    showQcActions: false
  },
  failed: {
    title: 'QC Failed List',
    apiStatus: 'failed',
    showRemark: true,
    showQcActions: false
  },
  'dead-assets': {
    title: 'Dead Assets List',
    apiStatus: 'dead',
    showQcActions: false
  },
  'require-for-parts': {
    title: 'Require For Parts',
    apiStatus: 'require_for_parts',
    showQcActions: false
  }
};
