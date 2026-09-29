import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FilterBar, FormGrid, Input, KeyValue, Money,
  Notice, Panel, SearchSelect, StatTile, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  errMsg, listDeposits, newRequestKey, recordDeposit, todayYmd, useCustomerOptions,
} from './moneyApi';
import { MoneyChip, Tiles } from './moneyShared';

/**
 * Finance → Security deposits (Builder 1, MD3 / SD1). Where each deposit came
 * from (billed on an invoice, taken on a sales order, recorded here), what is
 * still held and what was refunded. A deposit is refunded only when the
 * customer's account is closed — the row opens the customer, where Accounts
 * close the account and the refund is worked out against what is still owed.
 */

const STATUSES = [
  { value: 'held', label: 'Held' },
  { value: 'partially_refunded', label: 'Part refunded' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'adjusted', label: 'Adjusted' },
];
const SOURCES = [
  { value: 'invoice', label: 'Billed on an invoice' },
  { value: 'sales_order', label: 'Taken on a sales order' },
  { value: 'manual', label: 'Recorded here' },
];
const sourceOf = (d) => (d.so_payment_id ? 'Sales order payment' : d.invoice_id ? 'Invoice security line' : 'Recorded manually');

function RecordDepositDrawer({ open, onClose, onDone, customerOptions }) {
  const [form, setForm] = useState({ customer_id: '', amount: '', received_date: todayYmd(), sales_order_number: '', notes: '' });
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({ customer_id: '', amount: '', received_date: todayYmd(), sales_order_number: '', notes: '' });
    setKey(newRequestKey('dep'));
  }, [open]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.customer_id && Number(form.amount) > 0 && form.received_date && form.received_date <= todayYmd();
  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await recordDeposit({ ...form, amount: Math.round(Number(form.amount) * 100) / 100 }, key);
      toast.success(data.duplicate ? 'This deposit was already recorded' : 'Deposit recorded');
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not record the deposit'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title="Record a security deposit" footer={<Button variant="primary" disabled={!valid || busy} onClick={submit}>{busy ? 'Saving…' : 'Record deposit'}</Button>}>
      <div className="c-stack">
        <Notice tone="info">
          For a deposit received outside the invoice (a cheque or transfer against the agreement). Deposits billed on an invoice
          and those taken as a sales-order payment appear here on their own — do not record them twice.
        </Notice>
        <Field label="Customer" required><SearchSelect options={customerOptions} value={form.customer_id} placeholder="Choose customer" onChange={set('customer_id')} /></Field>
        <FormGrid cols={2}>
          <Field label="Amount" required><Input type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} /></Field>
          <Field label="Received on" required><Input type="date" max={todayYmd()} value={form.received_date} onChange={set('received_date')} /></Field>
        </FormGrid>
        <Field label="Sales order" hint="Optional"><Input value={form.sales_order_number} maxLength={50} onChange={set('sales_order_number')} /></Field>
        <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      </div>
    </Drawer>
  );
}

function DepositDrawer({ deposit, onClose }) {
  return (
    <Drawer open={Boolean(deposit)} onClose={onClose} title={deposit ? `Deposit #${deposit.deposit_id}` : ''}>
      {deposit && (
        <div className="c-stack">
          <KeyValue
            cols={2}
            items={[
              { label: 'Customer', value: <Link to={`/carret/sell/customers/${deposit.customer_id}`}>{deposit.customer_name || `#${deposit.customer_id}`}</Link> },
              { label: 'Status', value: <MoneyChip status={deposit.status} /> },
              { label: 'Collected', value: <Money value={deposit.amount} /> },
              { label: 'Received on', value: <DateTime value={deposit.received_date} /> },
              { label: 'Source', value: sourceOf(deposit) },
              { label: 'Invoice', value: deposit.invoice_id ? <Link to={`/carret/money/invoices/${deposit.invoice_id}`}><DocNumber value={deposit.invoice_number} /></Link> : null },
              { label: 'Sales order', value: deposit.sales_order_number ? <DocNumber value={deposit.sales_order_number} /> : null },
              { label: 'Laptop', value: deposit.ttspl_id },
              { label: 'Refunded', value: <Money value={deposit.refund_amount || 0} /> },
              { label: 'Refunded on', value: deposit.refund_date ? <DateTime value={deposit.refund_date} /> : null },
              { label: 'Refund reference', value: deposit.refund_reference },
              { label: 'Still held', value: <Money value={deposit.held_amount} /> },
            ]}
          />
          {deposit.notes && <Notice tone="info" title="Notes"><span style={{ whiteSpace: 'pre-wrap' }}>{deposit.notes}</span></Notice>}
          {deposit.customer_closed_at
            ? <Notice tone="good" title="Account closed">Closed on <DateTime value={deposit.customer_closed_at} />; the deposit was settled at closure.</Notice>
            : (
              <Notice
                tone="info"
                title="Refunds happen at account closure"
                action={<Link className="c-btn" to={`/carret/sell/customers/${deposit.customer_id}`}>Open customer</Link>}
              >
                When every laptop is back and nothing is open, use Close account… on the customer: the deposit is refunded less anything still owed.
              </Notice>
            )}
        </div>
      )}
    </Drawer>
  );
}

export default function SecurityDepositsPage() {
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('security_deposits', 'create');
  const customerOptions = useCustomerOptions();
  const [filters, setFilters] = useState({ search: '', status: '', source: '' });
  const [customerId, setCustomerId] = useState('');
  const [state, setState] = useState({ loading: true, rows: [] });
  const [nonce, setNonce] = useState(0);
  const [recordOpen, setRecordOpen] = useState(false);
  const [open, setOpen] = useState(null);
  const search = useDebouncedValue(filters.search);

  useEffect(() => {
    let off = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    listDeposits({
      search: search.trim() || undefined, status: filters.status || undefined, source: filters.source || undefined, customer_id: customerId || undefined,
    })
      .then(({ data }) => { if (!off) setState({ loading: false, rows: data.deposits || [] }); })
      .catch((e) => { if (!off) setState({ loading: false, rows: [], error: errMsg(e) }); });
    return () => { off = true; };
  }, [search, filters.status, filters.source, customerId, nonce]);

  const totals = useMemo(() => state.rows.reduce((a, d) => ({
    collected: a.collected + Number(d.amount || 0),
    held: a.held + Number(d.held_amount || 0),
    refunded: a.refunded + Number(d.refund_amount || 0),
  }), { collected: 0, held: 0, refunded: 0 }), [state.rows]);

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => { setFilters({ search: '', status: '', source: '' }); setCustomerId(''); }, []);

  const columns = useMemo(() => [
    { key: 'c', header: 'Customer', render: (d) => d.customer_name || `#${d.customer_id}`, sub: (d) => (d.customer_closed_at ? 'account closed' : null) },
    { key: 'l', header: 'Laptop / order', render: (d) => d.ttspl_id || d.sales_order_number || '—', sub: (d) => sourceOf(d) },
    { key: 'i', header: 'Invoice', render: (d) => (d.invoice_number ? <DocNumber value={d.invoice_number} /> : '—') },
    { key: 'r', header: 'Received', render: (d) => <DateTime value={d.received_date} /> },
    { key: 's', header: 'Status', render: (d) => <MoneyChip status={d.status} /> },
    { key: 'a', header: 'Collected', numeric: true, render: (d) => <Money value={d.amount} /> },
    { key: 'f', header: 'Refunded', numeric: true, render: (d) => <Money value={d.refund_amount || 0} showZero={false} /> },
    { key: 'h', header: 'Held', numeric: true, render: (d) => <Money value={d.held_amount} /> },
  ], []);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Customer, TTSPL, SO, invoice, DC' },
    { key: 'status', label: 'Status', options: STATUSES },
    { key: 'source', label: 'Source', options: SOURCES },
  ]), []);

  return (
    <DeskShell
      title="Security deposits"
      breadcrumb="Finance"
      subtitle="Collected on invoices, sales orders or by hand; refunded only when the account closes."
      actions={canCreate ? <Button variant="primary" onClick={() => setRecordOpen(true)}>Record deposit</Button> : null}
    >
      <div className="c-stack">
        <Tiles>
          <StatTile label="Deposits" value={state.loading ? null : state.rows.length} />
          <StatTile label="Collected" value={state.loading ? null : <Money value={totals.collected} />} />
          <StatTile label="Still held" value={state.loading ? null : <Money value={totals.held} />} />
          <StatTile label="Refunded" value={state.loading ? null : <Money value={totals.refunded} />} />
        </Tiles>
        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={`${state.rows.length} deposit(s)`}
              right={(
                <div style={{ minWidth: '220px' }}>
                  <SearchSelect aria-label="Customer" options={customerOptions} value={customerId} placeholder="Customer: All" onChange={(e) => setCustomerId(e.target.value)} />
                </div>
              )}
            />
          )}
        >
          {state.loading && <EmptyState title="Loading…" />}
          {state.error && <EmptyState title="Could not load deposits" body={state.error} />}
          {!state.loading && !state.error && (
            <DataTable columns={columns} rows={state.rows} rowKey={(d) => d.deposit_id} onRowClick={setOpen} empty={<EmptyState title="No deposits match" />} />
          )}
        </Panel>
      </div>
      <RecordDepositDrawer open={recordOpen} onClose={() => setRecordOpen(false)} onDone={() => setNonce((n) => n + 1)} customerOptions={customerOptions} />
      <DepositDrawer deposit={open} onClose={() => setOpen(null)} />
    </DeskShell>
  );
}
