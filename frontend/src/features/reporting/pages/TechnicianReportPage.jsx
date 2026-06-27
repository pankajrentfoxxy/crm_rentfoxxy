import React from 'react';
import Reports from '../../../components/Reports';
import api from '../../../utils/api';

export default function TechnicianReportPage() {
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Technician Performance</h1>
        <p className="text-sm text-gray-500 mt-1">
          Track technician workload, stage completions, QC performance, and resolution times
        </p>
      </div>
      <Reports api={api} />
    </div>
  );
}
