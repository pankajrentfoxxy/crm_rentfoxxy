import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, EmptyState, FilterBar, Money, Notice, Panel, StatTile, Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { addChargesToInvoice, fetchChargesToBill } from './serveApi';
import { errMsg } from './serveShared';

/**
 * Finance → Support charges to bill (Accounts; claude/carret-support.md).
 * Parts Support marked chargeable and the warehouse priced, fitted or
 * delivered, plus approved lock-in break and damage charges — not on an
 * invoice yet. Add a customer's charges to their draft invoice (totals
 * recomputed, 18% GST). Work-from-home delivery charges are on the Delivery
 * Charges page, outside the invoice.
 */
// charge_type is empty for a spare part; the other two come from early returns and damage cases.
const TYPE_LABEL = { part: 'Spare part', lock_in_break: 'Lock-in break', damage: 'Damage' };
const typeOf = (l) => (l.charge_type === 'lock_in_break' || l.charge_type === 'damage' ? l.charge_type : 'part');
const TABS = [{ key: '', label: 'All' }, { key: 'part', label: 'Spare parts' }, { key: 'lock_in_break', label: 'Lock-in break' }, { key: 'damage', label: 'Damage' }];
const sumOf = (list) => list.reduce((s, l) => s + Number(l.amount || 0), 0);

export default function ChargesToBillPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('customer_billing', 'edit');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    fetchChargesToBill().then(({ data }) => setRows(data.data || [])).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // Search runs over the loaded charges: customer or what the charge is for.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((l) => (!type || typeOf(l) === type)
      && (!q || [l.customer_name, l.description].some((v) => v && String(v).toLowerCase().includes(q))));
  }, [rows, type, search]);

  const byCustomer = useMemo(() => {
    const m = new Map();
    for (const r of shown) {
      const g = m.get(r.customer_id) || { customer_id: r.customer_id, customer_name: r.customer_name, draft_invoice_id: r.draft_invoice_id, lines: [] };
      g.lines.push(r);
      m.set(r.customer_id, g);
    }
    return [...m.values()];
  }, [shown]);

  // Tiles read everything loaded, not the filtered view.
  const all = rows || [];
  const customers = new Set(all.map((l) => l.customer_id));
  const noDraft = new Set(all.filter((l) => !l.draft_invoice_id).map((l) => l.customer_id));

  // Adding puts ALL of the customer's charges on the draft, as before — a type
  // tab or search only narrows what is on screen, never what is billed.
  const add = async (g) => {
    if (!g.draft_invoice_id) { toast.error('This customer has no draft invoice — generate this month’s invoice first'); return; }
    setBusy(g.customer_id);
    try {
      const { data } = await addChargesToInvoice(g.draft_invoice_id, all.filter((l) => l.customer_id === g.customer_id).map((l) => l.extra_line_id));
      toast.success(data.message);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };

  const cols = [
    { key: 'd', header: 'Charge', render: (l) => l.description, sub: (l) => TYPE_LABEL[typeOf(l)] },
    { key: 'a', header: 'Amount', numeric: true, render: (l) => <Money value={l.amount} />, sub: (l) => `+ ${l.gst_rate || 18}% GST` },
    { key: 'w', header: 'Raised', render: (l) => <DateTime value={l.raised_at} /> },
  ];
  const filtered = Boolean(type || search.trim());

  return (
    <DeskShell
      title="Support Charges to Bill"
      breadcrumb="Finance"
      subtitle="Approved support charges not on an invoice yet — add each customer's to their draft invoice."
    >
      <div className="c-stack">
        <div className="c-tiles">
          <StatTile label="Customers" value={rows ? customers.size : null} />
          <StatTile label="Charges" value={rows ? all.length : null} />
          <StatTile label="Total to bill" value={rows ? <Money value={sumOf(all)} /> : null} delta="before GST" family="earning" />
          <StatTile label="Customers with no draft invoice" value={rows ? noDraft.size : null} family={noDraft.size ? 'moving' : undefined} />
        </div>

        <Notice tone="info">Parts are free unless Support marked them chargeable; the warehouse set each price. Adding them puts them on the customer’s draft invoice with 18% GST.</Notice>

        <Panel
          toolbar={(
            <>
              <Tabs
                tabs={TABS.map((t) => ({ ...t, count: rows ? all.filter((l) => !t.key || typeOf(l) === t.key).length : null }))}
                value={type}
                onChange={setType}
              />
              <FilterBar
                filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'Customer or charge' }]}
                values={{ search }}
                onChange={(k, v) => setSearch(v)}
                onClear={() => setSearch('')}
                count={rows ? <>{byCustomer.length} customer{byCustomer.length === 1 ? '' : 's'} · <Money value={sumOf(shown)} /></> : '…'}
              />
            </>
          )}
        >
          {rows === null ? <EmptyState title="Loading…" /> : byCustomer.length === 0 ? (
            filtered
              ? <EmptyState title="No charges match" action={<Button variant="quiet" onClick={() => { setType(''); setSearch(''); }}>Clear filters</Button>} />
              : <EmptyState title="Nothing to bill" body="Every approved support charge is already on an invoice." />
          ) : byCustomer.map((g) => (
            <div key={g.customer_id} className="c-listgroup">
              <div className="c-listgroup-h">
                <span className="c-listgroup-t">
                  {g.customer_name}
                  <small>{g.lines.length} charge{g.lines.length === 1 ? '' : 's'} · <Money value={sumOf(g.lines)} /> + GST</small>
                </span>
                {g.draft_invoice_id ? (
                  <span className="inline-flex items-center" style={{ gap: 8 }}>
                    <Link to={`/carret/money/invoices/${g.draft_invoice_id}`}>Draft invoice</Link>
                    {canEdit && (
                      <Button variant="primary" disabled={busy === g.customer_id} onClick={() => add(g)}>
                        {filtered ? `Add all ${all.filter((l) => l.customer_id === g.customer_id).length} to the draft invoice` : 'Add to the draft invoice'}
                      </Button>
                    )}
                  </span>
                ) : null}
              </div>
              {!g.draft_invoice_id && (
                <Notice tone="warn" title="No draft invoice yet" action={<Link to="/carret/money/invoices">Invoices</Link>}>
                  Generate this month’s invoice for {g.customer_name || 'this customer'} first; these charges can then be added to it.
                </Notice>
              )}
              <DataTable columns={cols} rows={g.lines} rowKey={(l) => l.extra_line_id} />
            </div>
          ))}
        </Panel>
      </div>
    </DeskShell>
  );
}
