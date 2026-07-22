import React from 'react';
import RoleBadge from '../../../components/ui/RoleBadge';
import { ROLE_REFERENCE_ROWS } from '../../../constants/roles';

export default function RoleReferencePage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-800">Role Reference</h1>
        <p className="text-sm text-gray-500">
          Quick overview of what each CRM role can access
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Key Access Areas</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Cannot Access</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_REFERENCE_ROWS.map((row) => (
                <tr key={row.role} className="border-t border-gray-100">
                  <td className="px-4 py-3">
                    <RoleBadge role={row.role} />
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.access}</td>
                  <td className="px-4 py-3 text-gray-500">{row.cannot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
