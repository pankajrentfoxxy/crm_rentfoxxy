import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, EmptyState, Money, Notice, Section,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { addChargesToInvoice, fetchChargesToBill } from './serveApi';
import { errMsg } from './serveShared';

/**
 * Money → Support charges to bill (Accounts; claude/carret-support.md).
 * Parts Support marked chargeable and the warehouse priced, fitted or
 * delivered — not on an invoice yet. Add a customer's charges to their draft
 * invoice (totals recomputed, 18% GST). Work-from-home delivery charges are on
 * the Delivery Charges page, outside the invoice.
 */
export default function ChargesToBillPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('customer_billing', 'edit');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    fetchChargesToBill().then(({ data }) => setRows(data.data || [])).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const byCustomer = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) {
      const g = m.get(r.customer_id) || { customer_id: r.customer_id, customer_name: r.customer_name, draft_invoice_id: r.draft_invoice_id, lines: [] };
      g.lines.push(r);
      m.set(r.customer_id, g);
    }
    return [...m.values()];
  }, [rows]);

  const add = async (g) => {
    if (!g.draft_invoice_id) { toast.error('This customer has no draft invoice — generate this month’s invoice first'); return; }
    setBusy(g.customer_id);
    try {
      const { data } = await addChargesToInvoice(g.draft_invoice_id, g.lines.map((l) => l.extra_line_id));
      toast.success(data.message);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };

  return (
    <DeskShell title="Support charges to bill" breadcrumb="Money">
      <div className="c-stack">
        <Notice tone="info">Parts are free unless Support marked them chargeable; the warehouse set each price. Adding them puts them on the customer’s draft invoice with 18% GST.</Notice>
        {rows === null ? <EmptyState title="Loading…" /> : byCustomer.length === 0 ? <EmptyState title="Nothing to bill" /> : byCustomer.map((g) => (
          <Section
            key={g.customer_id}
            title={`${g.customer_name} · ${g.lines.length}`}
            actions={canEdit && <Button variant="primary" disabled={busy === g.customer_id} onClick={() => add(g)}>{g.draft_invoice_id ? 'Add to the draft invoice' : 'No draft invoice yet'}</Button>}
          >
            <DataTable
              columns={[
                { key: 'd', header: 'Charge', render: (l) => l.description },
                { key: 'a', header: 'Amount', numeric: true, render: (l) => <Money value={l.amount} />, sub: (l) => `+ ${l.gst_rate || 18}% GST` },
                { key: 'w', header: 'Raised', render: (l) => <DateTime value={l.raised_at} /> },
              ]}
              rows={g.lines}
              rowKey={(l) => l.extra_line_id}
            />
          </Section>
        ))}
      </div>
    </DeskShell>
  );
}
