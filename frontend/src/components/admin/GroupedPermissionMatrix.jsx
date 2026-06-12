import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  SECTION_GROUPS,
  SECTION_LABELS,
  GROUP_COLORS,
  PERMISSION_ACTIONS,
} from '../../constants/sections';

const ACTION_LABELS = {
  can_view: 'View',
  can_create: 'Create',
  can_edit: 'Edit',
  can_delete: 'Delete',
};

const ACTION_COLORS = {
  can_view: 'text-blue-600 accent-blue-600',
  can_create: 'text-green-600 accent-green-600',
  can_edit: 'text-amber-600 accent-amber-600',
  can_delete: 'text-red-600 accent-red-600',
};

function applyCheckboxRules(section, action, value, current) {
  const next = { ...current, [action]: value };
  if (action !== 'can_view' && value) {
    next.can_view = true;
  }
  if (action === 'can_view' && !value) {
    next.can_create = false;
    next.can_edit = false;
    next.can_delete = false;
  }
  return next;
}

export default function GroupedPermissionMatrix({
  matrix,
  onChange,
  baselineMatrix,
  disabled = false,
}) {
  const [collapsed, setCollapsed] = useState({});

  const toggleGroup = (group) => {
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const handleChange = (section, action, value) => {
    const current = matrix[section] || {
      can_view: false, can_create: false, can_edit: false, can_delete: false,
    };
    const next = applyCheckboxRules(section, action, value, current);
    onChange(section, next);
  };

  const isModified = (section) => {
    if (!baselineMatrix?.[section]) return false;
    return PERMISSION_ACTIONS.some(
      (action) => !!matrix[section]?.[action] !== !!baselineMatrix[section]?.[action]
    );
  };

  return (
    <div className="space-y-4">
      {Object.entries(SECTION_GROUPS).map(([group, sections]) => {
        const colorClass = GROUP_COLORS[group] || GROUP_COLORS.Core;
        const isOpen = !collapsed[group];

        return (
          <div key={group} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className={`w-full flex items-center gap-2 px-4 py-3 border-b text-left text-xs uppercase tracking-widest font-semibold ${colorClass}`}
            >
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {group}
            </button>

            {isOpen ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-48">
                        Module
                      </th>
                      {PERMISSION_ACTIONS.map((action) => (
                        <th
                          key={action}
                          className={`px-3 py-2 text-center text-xs font-medium uppercase ${ACTION_COLORS[action]}`}
                        >
                          {ACTION_LABELS[action]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((section) => (
                      <tr key={section} className="border-t border-gray-100">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-800">
                              {SECTION_LABELS[section] || section}
                            </span>
                            {isModified(section) ? (
                              <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full">
                                Modified
                              </span>
                            ) : null}
                          </div>
                        </td>
                        {PERMISSION_ACTIONS.map((action) => (
                          <td key={action} className="px-3 py-2.5 text-center">
                            <input
                              type="checkbox"
                              className={`w-4 h-4 ${ACTION_COLORS[action]}`}
                              checked={!!matrix[section]?.[action]}
                              disabled={disabled}
                              onChange={(e) => handleChange(section, action, e.target.checked)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
