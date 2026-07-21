import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  SECTION_GROUPS,
  SECTION_LABELS,
  GROUP_COLORS,
  PERMISSION_ACTIONS,
  isHiddenRolePermissionSection,
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

// Customer Access selector (All / Sales / Rental) — customers row only.
// Filters which customer_type values the role can see across the whole CRM.
const CUSTOMER_ACCESS_SECTIONS = new Set(['customers', 'customer_management']);
const INVENTORY_TAG_ACCESS_SECTIONS = new Set(['inventory_management', 'inventory']);
const CUSTOMER_ACCESS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'sales', label: 'Sales' },
  { value: 'rental', label: 'Rental' },
];
const INVENTORY_TAG_ACCESS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'rental_only', label: 'Rental only' },
  { value: 'rental_both', label: 'Rental + Both' },
  { value: 'sale_only', label: 'Sale only' },
  { value: 'sale_both', label: 'Sale + Both' },
];

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
  showDataScope = false,
}) {
  const [collapsed, setCollapsed] = useState({});

  const toggleGroup = (group) => {
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const handleChange = (section, action, value) => {
    const current = matrix[section] || {
      can_view: false, can_create: false, can_edit: false, can_delete: false, data_scope: 'all',
    };
    const next = applyCheckboxRules(section, action, value, current);
    onChange(section, next);
  };

  const isModified = (section) => {
    if (!baselineMatrix?.[section]) return false;
    const scopeChanged = showDataScope
      && (matrix[section]?.data_scope || 'all') !== (baselineMatrix[section]?.data_scope || 'all');
    const accessChanged = CUSTOMER_ACCESS_SECTIONS.has(section)
      && (matrix[section]?.customer_access || 'all') !== (baselineMatrix[section]?.customer_access || 'all');
    const tagAccessChanged = INVENTORY_TAG_ACCESS_SECTIONS.has(section)
      && (matrix[section]?.inventory_tag_access || 'all') !== (baselineMatrix[section]?.inventory_tag_access || 'all');
    return scopeChanged || accessChanged || tagAccessChanged || PERMISSION_ACTIONS.some(
      (action) => !!matrix[section]?.[action] !== !!baselineMatrix[section]?.[action]
    );
  };

  const handleScopeChange = (section, dataScope) => {
    const current = matrix[section] || emptyPermissionRow();
    onChange(section, { ...current, data_scope: dataScope });
  };

  const handleCustomerAccessChange = (section, customerAccess) => {
    const current = matrix[section] || emptyPermissionRow();
    onChange(section, { ...current, customer_access: customerAccess });
  };

  const handleInventoryTagAccessChange = (section, inventoryTagAccess) => {
    const current = matrix[section] || emptyPermissionRow();
    onChange(section, { ...current, inventory_tag_access: inventoryTagAccess });
  };

  const emptyPermissionRow = () => ({
    can_view: false, can_create: false, can_edit: false, can_delete: false,
    data_scope: 'all', customer_access: 'all', inventory_tag_access: 'all',
  });

  return (
    <div className="space-y-4">
      {Object.entries(SECTION_GROUPS).map(([group, sections]) => {
        const colorClass = GROUP_COLORS[group] || GROUP_COLORS.Core;
        const isOpen = !collapsed[group];
        const hasCustomerAccess = sections.some((s) => CUSTOMER_ACCESS_SECTIONS.has(s));
        const hasInventoryTagAccess = sections.some((s) => INVENTORY_TAG_ACCESS_SECTIONS.has(s));

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
                      {showDataScope ? (
                        <th className="px-3 py-2 text-center text-xs font-medium uppercase text-violet-600">
                          Data Scope
                        </th>
                      ) : null}
                      {hasCustomerAccess ? (
                        <th className="px-3 py-2 text-center text-xs font-medium uppercase text-cyan-600">
                          Customer Access
                        </th>
                      ) : null}
                      {hasInventoryTagAccess ? (
                        <th className="px-3 py-2 text-center text-xs font-medium uppercase text-teal-600">
                          Ready Stock
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {sections.filter((section) => !isHiddenRolePermissionSection(section)).map((section) => (
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
                        {showDataScope ? (
                          <td className="px-3 py-2.5 text-center">
                            <select
                              value={matrix[section]?.data_scope || 'all'}
                              disabled={disabled}
                              onChange={(e) => handleScopeChange(section, e.target.value)}
                              className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white max-w-[140px]"
                            >
                              <option value="all">All Data</option>
                              <option value="assigned">Assigned Only</option>
                            </select>
                          </td>
                        ) : null}
                        {hasCustomerAccess ? (
                          <td className="px-3 py-2.5 text-center">
                            {CUSTOMER_ACCESS_SECTIONS.has(section) ? (
                              <select
                                value={matrix[section]?.customer_access || 'all'}
                                disabled={disabled}
                                onChange={(e) => handleCustomerAccessChange(section, e.target.value)}
                                title="Which customer types this role can see everywhere (Both-type customers are visible to Sales and Rental)"
                                className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white max-w-[110px]"
                              >
                                {CUSTOMER_ACCESS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        ) : null}
                        {hasInventoryTagAccess ? (
                          <td className="px-3 py-2.5 text-center">
                            {INVENTORY_TAG_ACCESS_SECTIONS.has(section) ? (
                              <select
                                value={matrix[section]?.inventory_tag_access || 'all'}
                                disabled={disabled}
                                onChange={(e) => handleInventoryTagAccessChange(section, e.target.value)}
                                title="Ready to Rent/Sell: filter by laptop tag. SO-attached units are hidden when not All."
                                className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white max-w-[130px]"
                              >
                                {INVENTORY_TAG_ACCESS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        ) : null}
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
