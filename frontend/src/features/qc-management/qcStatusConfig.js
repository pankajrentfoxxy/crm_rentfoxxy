/** CRM route segment → API / Laravel serial_numbers.status */
export const QC_STATUS_BY_ROUTE = {
  processing: 'pending',
  passed: 'passed',
  failed: 'failed',
  'dead-assets': 'dead',
  'require-for-parts': 'require_for_parts'
};

/** List page config — mirrors qc-list.blade.php columns per status */
export const QC_LIST_META = {
  processing: {
    title: 'QC Pending',
    titleSuffix: 'List',
    apiStatus: 'pending',
    showFiles: true,
    showPendingExtras: true
  },
  passed: {
    title: 'QC Passed',
    titleSuffix: 'List',
    apiStatus: 'passed',
    showPassedAction: true
  },
  failed: {
    title: 'QC Failed',
    titleSuffix: 'List',
    apiStatus: 'failed',
    showFiles: true,
    showFailedExtras: true
  },
  'dead-assets': {
    title: 'Dead Assets',
    titleSuffix: 'List',
    apiStatus: 'dead',
    showDeadExtras: true
  },
  'require-for-parts': {
    title: 'QC Require For Parts',
    titleSuffix: 'List',
    apiStatus: 'require_for_parts',
    showRequireParts: true
  }
};
