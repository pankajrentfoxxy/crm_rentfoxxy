import React from 'react';
import { Link } from 'react-router-dom';
import { deliveryChallanDetailPath } from '../../sales-pipeline/salesPipelineUtils';

function soPath(soNumber) {
  if (!soNumber) return null;
  return `/sales-pipeline/sales-orders/${encodeURIComponent(soNumber)}`;
}

function customerPath(customerId) {
  if (!customerId) return null;
  return `/lead-crm/customers/${customerId}`;
}

function supportTicketPath(id) {
  if (!id) return null;
  return `/support/tickets/${id}`;
}

function floorTicketPath(id) {
  if (!id) return null;
  return `/floor-pipeline/tickets/${id}`;
}

const REF_RE = /(DC\/\d{2}-\d{2}\/\d+|RDC\/\d{2}-\d{2}\/\d+|SO\/\d{2}-\d{2}\/\d+|T-\d+|ticket\s*#\s*\d+)/gi;

function hrefForToken(token, metadata = {}) {
  const t = String(token || '').trim();
  if (/^(DC|RDC)\/\d{2}-\d{2}\/\d+$/i.test(t)) return deliveryChallanDetailPath(t);
  if (/^SO\/\d{2}-\d{2}\/\d+$/i.test(t)) return soPath(t);
  const supportMatch = t.match(/^T-(\d+)$/i);
  if (supportMatch) return supportTicketPath(supportMatch[1]);
  const floorMatch = t.match(/^ticket\s*#\s*(\d+)$/i);
  if (floorMatch) {
    if (metadata.support_ticket_id && Number(metadata.support_ticket_id) === Number(floorMatch[1])) {
      return supportTicketPath(floorMatch[1]);
    }
    return floorTicketPath(floorMatch[1]);
  }
  return null;
}

export function LinkedHistoryText({ text, metadata, onNavigate }) {
  const raw = String(text || '');
  if (!raw) return null;
  const parts = raw.split(REF_RE);
  return (
    <p className="text-sm text-slate-800 mt-0.5">
      {parts.map((part, i) => {
        const href = hrefForToken(part, metadata);
        if (!href) return <React.Fragment key={`${part}-${i}`}>{part}</React.Fragment>;
        return (
          <Link
            key={`${part}-${i}`}
            to={href}
            onClick={onNavigate}
            className="font-medium text-sky-700 hover:underline"
          >
            {part}
          </Link>
        );
      })}
    </p>
  );
}

export function HistoryRefChips({ metadata, onNavigate }) {
  const m = metadata && typeof metadata === 'object' ? metadata : {};
  const chips = [];
  const customerLabel = m.customer_name || m.company_name;
  if (customerLabel) {
    chips.push({
      key: 'customer',
      to: customerPath(m.customer_id),
      label: customerLabel,
    });
  }
  if (m.dc_number) {
    chips.push({ key: 'dc', to: deliveryChallanDetailPath(m.dc_number), label: m.dc_number });
  }
  if (m.sales_order_number) {
    chips.push({ key: 'so', to: soPath(m.sales_order_number), label: m.sales_order_number });
  }
  if (m.support_ticket_id) {
    chips.push({
      key: 'support',
      to: supportTicketPath(m.support_ticket_id),
      label: `T-${m.support_ticket_id}`,
    });
  } else if (m.ticket_id) {
    chips.push({
      key: 'floor',
      to: floorTicketPath(m.ticket_id),
      label: `#${m.ticket_id}`,
    });
  }
  if (!chips.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        c.to ? (
          <Link
            key={c.key}
            to={c.to}
            onClick={onNavigate}
            className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
          >
            {c.label}
          </Link>
        ) : (
          <span
            key={c.key}
            className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
          >
            {c.label}
          </span>
        )
      ))}
    </div>
  );
}

export function customerDisplayName(asset) {
  if (!asset) return '';
  return asset.company_name || asset.customer_name || '';
}
