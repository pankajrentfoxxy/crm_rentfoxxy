import React from 'react';

export default function QcStatusBadge({ allPassed, pendingCount = 0, failedCount = 0, totalCount = 0 }) {
  if (!totalCount) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
        QC Not Initiated
      </span>
    );
  }
  if (failedCount > 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        QC Failed ({failedCount})
      </span>
    );
  }
  if (allPassed) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
        QC Passed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
      QC Pending ({pendingCount}/{totalCount})
    </span>
  );
}
