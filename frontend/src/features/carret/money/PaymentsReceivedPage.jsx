import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import {
  DataTable, DateTime, DocNumber, EmptyState, Field, FilterBar, Input, Money, Panel, SearchSelect, StatTile,
} from '../../../components/carret';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { PAYMENT_METHODS, errMsg, listPayments, useCustomerOptions } from './moneyApi';
import { MoneyChip, Pager, Tiles } from './moneyShared';

/**
 * Finance → Payments received (Builder 1). Every customer payment recorded
 * against an invoice, newest first, with search (invoice, reference,
 * customer), customer, method and date filters. Each row links to its invoice,
 * where payments are recorded. Payments taken on a sales order (advance,
 * security) stay on the sales order.
 */
export default function PaymentsReceivedPage() {
  const customerOptions = useCustomerOptions();
  const [filters, setFilters] = useState({ search: '', method: '' });
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, rows: [], total: 0, amount: 0, totalPages: 1 });
  const search = useDebouncedValue(filters.search);

  const params = useMemo(() => ({
    page,
    limit: 50,
    search: search.trim() || undefined,
    method: filters.method || undefined,
    customer_id: customerId || undefined,
    from: from || undefined,
    to: to || undefined,
  }), [page, search, filters.method, customerId, from, to]);

  useEffect(() => { setPage(1); }, [search, filters.method, customerId, from, to]);

  useEffect(() => {
    let off = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    listPayments(params)
      .then(({ data }) => {
        if (!off) {
          setState({
            loading: false, rows: data.payments || [], total: data.total || 0, amount: data.amount_total || 0, totalPages: data.total_pages || 1,
          });
        }
      })
      .catch((e) => { if (!off) setState({ loading: false, rows: [], total: 0, amount: 0, totalPages: 1, error: errMsg(e) }); });
    return () => { off = true; };
  }, [params]);

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => { setFilters({ search: '', method: '' }); setCustomerId(''); setFrom(''); setTo(''); }, []);

  const columns = useMemo(() => [
    { key: 'd', header: 'Received', render: (p) => <DateTime value={p.payment_date} />, sub: (p) => p.recorded_by_name || null },
    { key: 'c', header: 'Customer', render: (p) => p.customer_name || `#${p.customer_id}` },
    {
      key: 'i',
      header: 'Invoice',
      render: (p) => (p.invoice_id ? <Link to={`/carret/money/invoices/${p.invoice_id}`} onClick={(e) => e.stopPropagation()}><DocNumber value={p.invoice_number} /></Link> : '—'),
      sub: (p) => (p.invoice_status ? <MoneyChip status={p.invoice_status} /> : null),
    },
    { key: 'm', header: 'Method', render: (p) => PAYMENT_METHODS.find((m) => m.value === p.method)?.label || p.method || '—' },
    { key: 'r', header: 'Reference', render: (p) => (p.reference ? <DocNumber value={p.reference} /> : '—'), sub: (p) => p.notes || null },
    { key: 'a', header: 'Amount', numeric: true, render: (p) => <Money value={p.amount} /> },
  ], []);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Invoice, reference or customer' },
    { key: 'method', label: 'Method', options: PAYMENT_METHODS },
  ]), []);

  return (
    <DeskShell title="Payments received" breadcrumb="Finance" subtitle="Customer payments recorded against invoices.">
      <div className="c-stack">
        <Tiles>
          <StatTile label="Payments" value={state.loading ? null : state.total} />
          <StatTile label="Amount received" value={state.loading ? null : <Money value={state.amount} />} delta="for the filters shown" />
        </Tiles>
        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={`${state.total} payment(s)`}
              right={(
                <div className="flex flex-wrap items-end" style={{ gap: '8px' }}>
                  <div style={{ minWidth: '220px' }}>
                    <SearchSelect aria-label="Customer" options={customerOptions} value={customerId} placeholder="Customer: All" onChange={(e) => setCustomerId(e.target.value)} />
                  </div>
                  <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                  <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                </div>
              )}
            />
          )}
        >
          {state.loading && <EmptyState title="Loading…" />}
          {state.error && <EmptyState title="Could not load payments" body={state.error} />}
          {!state.loading && !state.error && (
            <>
              <DataTable columns={columns} rows={state.rows} rowKey={(p) => p.payment_id} empty={<EmptyState title="No payments match" body="Record a payment from its invoice." />} />
              <Pager page={page} totalPages={state.totalPages} onPage={setPage} />
            </>
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
