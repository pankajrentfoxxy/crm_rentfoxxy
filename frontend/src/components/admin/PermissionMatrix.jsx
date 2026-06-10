import React from 'react';
import PermissionCheckbox from '../ui/PermissionCheckbox';
import { SECTION_LABELS } from '../../constants/sections';

const ACTION_LABELS = {
  can_view: 'View',
  can_create: 'Create',
  can_edit: 'Edit',
  can_delete: 'Delete',
};

export default function PermissionMatrix({
  sections,
  matrix,
  onChange,
  mode = 'checkbox',
  roleDefaults,
  disabled = false,
}) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left w-40 text-xs font-medium text-gray-500 uppercase">Module</th>
            {Object.keys(ACTION_LABELS).map((action) => (
              <th key={action} className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                {ACTION_LABELS[action]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <tr key={section} className="border-t border-gray-100">
              <td className="px-3 py-2 font-medium text-gray-800">{SECTION_LABELS[section] || section}</td>
              {Object.keys(ACTION_LABELS).map((action) => (
                <td key={action} className="px-3 py-2 text-center">
                  {mode === 'tri-state' ? (
                    <div className="flex flex-col items-center gap-1">
                      <PermissionCheckbox
                        value={matrix?.[section]?.[action] ?? null}
                        onChange={(value) => onChange(section, action, value)}
                        disabled={disabled}
                      />
                      {roleDefaults?.[section] ? (
                        <span className="text-[10px] text-gray-400">
                          Role: {roleDefaults[section][action] ? '✓' : '✗'}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={!!matrix?.[section]?.[action]}
                      disabled={disabled}
                      onChange={(e) => onChange(section, action, e.target.checked)}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
