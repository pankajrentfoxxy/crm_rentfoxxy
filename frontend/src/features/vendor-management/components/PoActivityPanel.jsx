import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { listPoActivities } from '../vendorManagementApi';

const ACTION_ICONS = {
  created: '📝',
  updated: '✏️',
  approved: '✅',
  rejected: '❌',
  cancelled: '🚫',
  reopened: '🔓',
  status_changed: '↔️',
  vendor_selected: '👤',
  vendor_changed: '🔄',
  vendor_details_updated: '🏢',
  billing_address_updated: '📍',
  shipping_address_updated: '📦',
  item_added: '➕',
  item_removed: '➖',
  item_updated: '✏️',
  configuration_changed: '⚙️',
  quantity_changed: '🔢',
  price_changed: '💰',
  discount_updated: '🏷️',
  gst_updated: '🧾',
  total_amount_updated: '💵',
  grn_created: '📦',
  grn_updated: '📦',
  grn_accepted: '✅',
  grn_rejected: '❌',
  grn_partial_received: '📥',
  grn_complete_received: '✅',
  laptop_accepted: '💻',
  laptop_rejected: '❌',
  grn_configuration_updated: '⚙️',
  inventory_added: '📥',
  asset_tag_generated: '🏷️',
  ttspl_generated: '🏷️',
  inventory_status_updated: '📦',
  qc_started: '🔍',
  attachment_uploaded: '📎',
  attachment_deleted: '🗑️',
  invoice_uploaded: '🧾',
  invoice_updated: '🧾',
  pdf_generated: '📄',
  printed: '🖨️',
  pdf_downloaded: '⬇️',
  shared: '🔗',
  note_added: '📝',
  comment_added: '💬',
  assignment_changed: '👤',
  priority_updated: '⚡',
};

const TYPE_ICONS = {
  purchase_order: '📋',
  vendor: '🏢',
  item: '💻',
  grn: '📦',
  inventory: '📥',
  attachment: '📎',
  document: '📄',
  system: '⚙️',
};

function formatActivityDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function activityIcon(item) {
  return ACTION_ICONS[item.action] || TYPE_ICONS[item.activity_type] || '•';
}

function hasDetails(item) {
  if (item.remarks) return true;
  const meta = item.metadata;
  if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) return true;
  return false;
}

function ActivityEntry({ item, nested = false }) {
  const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : null;
  const showDetails = item.description || item.remarks || (meta && Object.keys(meta).length > 0);

  return (
    <div className={nested ? 'pt-2' : ''}>
      <p className="text-xs text-slate-500">
        {formatActivityDateTime(item.created_at)}
        {item.created_by_name ? ` · ${item.created_by_name}` : ''}
        {item.created_by_role ? ` (${item.created_by_role})` : ''}
      </p>
      {item.description ? (
        <p className="text-sm text-slate-800 mt-0.5 whitespace-pre-wrap">{item.description}</p>
      ) : null}
      {showDetails ? (
        <details className="mt-1 text-xs text-slate-600 group">
          <summary className="cursor-pointer text-blue-600 list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            Details
          </summary>
          <div className="mt-2 space-y-2 pl-3 border-l border-slate-200">
            {item.remarks ? (
              <p className="text-slate-600 italic">Remarks: {item.remarks}</p>
            ) : null}
            {meta && Object.keys(meta).length > 0 ? (
              <pre className="whitespace-pre-wrap bg-slate-50 p-2 rounded text-[11px] leading-relaxed">
                {JSON.stringify(meta, null, 2)}
              </pre>
            ) : null}
            {!item.description && !item.remarks && (!meta || !Object.keys(meta).length) ? (
              <p className="text-slate-500">No additional details.</p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default function PoActivityPanel({ poId, refreshKey = 0 }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());

  const load = useCallback(async () => {
    if (!poId) return;
    setLoading(true);
    try {
      const res = await listPoActivities(poId, { limit: 100 });
      setActivities(res.data?.activities || []);
    } catch {
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [poId, refreshKey]);

  useEffect(() => { load(); }, [load]);

  const groupedByTitle = useMemo(() => {
    const map = new Map();
    for (const item of activities) {
      const key = item.title || item.action || 'Activity';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()].sort(
      ([, a], [, b]) => new Date(b[0].created_at) - new Date(a[0].created_at)
    );
  }, [activities]);

  function toggleGroup(title) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading activity…
      </div>
    );
  }

  if (!activities.length) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center text-sm text-gray-400">
        No activity recorded yet for this purchase order.
      </div>
    );
  }

  return (
    <div className="bg-white border rounded-xl p-4 sm:p-6">
      <section>
        <h3 className="text-xs font-semibold uppercase text-slate-500 mb-3">Lifecycle timeline</h3>
        <ul className="space-y-5 border-l-2 border-slate-200 ml-2 pl-4">
          {groupedByTitle.map(([title, items]) => {
            const latest = items[0];
            const isOpen = expanded.has(title);
            const multi = items.length > 1;
            const summaryText = latest.description || title;

            return (
              <li key={title} className="relative">
                <span className="absolute -left-[1.35rem] top-0 text-sm leading-none select-none">
                  {activityIcon(latest)}
                </span>

                <p className="text-xs text-slate-500">
                  {formatActivityDateTime(latest.created_at)}
                  {latest.created_by_name ? ` · ${latest.created_by_name}` : ''}
                </p>

                <p className="text-sm font-medium text-slate-800 mt-0.5">{title}</p>

                {!isOpen ? (
                  <p className="text-sm text-slate-700 mt-0.5">{summaryText}</p>
                ) : null}

                {multi || hasDetails(latest) || latest.description ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(title)}
                    className="mt-1 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    aria-expanded={isOpen}
                  >
                    <span className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                    Details
                    {multi && !isOpen ? (
                      <span className="text-slate-400">({items.length})</span>
                    ) : null}
                  </button>
                ) : null}

                {isOpen ? (
                  <div className="mt-2 space-y-4 border-l border-slate-100 ml-1 pl-3">
                    {items.map((item) => (
                      <ActivityEntry key={item.id} item={item} nested />
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
