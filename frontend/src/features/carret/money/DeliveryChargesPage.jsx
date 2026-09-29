import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Money, Notice, Panel, SearchSelect, Section, StatTile,
} from '../../../components/carret';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  MONTHS, MONTH_OPTIONS, blobErrMsg, deliveryChargesExcel, deliveryChargesStatement, errMsg, getDeliveryCharges,
  saveBlob, useCustomerOptions, yearOptions,
} from './moneyApi';
import { Tiles } from './moneyShared';

/**
 * Finance → Delivery charges (Builder 1). The shipping charge on each outbound
 * DC (and the Rs 799 work-from-home return pickup on a return DC), by the month
 * it was dispatched, grouped by customer, with a per-customer statement PDF
 * and an Excel of the month. These are collected outside the rental invoice.
 *
 * Kept as its own page, not merged into Support charges to bill: that page puts
 * Support's chargeable parts ON the draft invoice; this one is a read-only
 * statement of DC shipping charges that never go on the invoice — different
 * data, different action.
 */
export default function DeliveryChargesPage() {
  const now = new Date();
  const customerOptions = useCustomerOptions();
  const [filters, setFilters] = useState({ search: '', month: String(now.getMonth() + 1), year: String(now.getFullYear()) });
  const [customerId, setCustomerId] = useState('');
  const [state, setState] = useState({ loading: true, report: null });
  const [busy, setBusy] = useState('');
  const search = useDebouncedValue(filters.search);

  useEffect(() => {
    if (!filters.month || !filters.year) { setState({ loading: false, report: null }); return undefined; }
    let off = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    getDeliveryCharges({ month: filters.month, year: filters.year, customer_id: customerId || undefined, search: search.trim() || undefined })
      .then(({ data }) => { if (!off) setState({ loading: false, report: data }); })
      .catch((e) => { if (!off) setState({ loading: false, report: null, error: errMsg(e) }); });
    return () => { off = true; };
  }, [filters.month, filters.year, customerId, search]);

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => { setFilters((f) => ({ ...f, search: '' })); setCustomerId(''); }, []);

  const excel = async () => {
    setBusy('xlsx');
    try {
      const { data } = await deliveryChargesExcel({ month: filters.month, year: filters.year, customer_id: customerId || undefined, search: search.trim() || undefined });
      saveBlob(data, `Delivery-Charges-${MONTHS[Number(filters.month)]}-${filters.year}.xlsx`);
    } catch (e) {
      toast.error(await blobErrMsg(e, 'Export failed'));
    } finally {
      setBusy('');
    }
  };
  const statement = async (c) => {
    setBusy(`pdf${c.customer_id}`);
    try {
      const { data } = await deliveryChargesStatement({ month: filters.month, year: filters.year, customer_id: c.customer_id });
      saveBlob(data, `Delivery-Charges-${String(c.customer_name || c.customer_id).replace(/[^A-Za-z0-9]+/g, '-')}-${MONTHS[Number(filters.month)]}-${filters.year}.pdf`, 'application/pdf');
    } catch (e) {
      toast.error(await blobErrMsg(e, 'Statement failed'));
    } finally {
      setBusy('');
    }
  };

  const report = state.report;
  const customers = report?.customers || [];
  const trend = report?.trend || [];
  const peak = useMemo(() => Math.max(1, ...trend.map((t) => Number(t.total || 0))), [trend]);

  const dcCols = [
    { key: 'dc', header: 'DC', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => r.kind },
    { key: 'so', header: 'Sales order', render: (r) => (r.sales_order_number ? <DocNumber value={r.sales_order_number} /> : '—') },
    { key: 'd', header: 'Dispatched', render: (r) => <DateTime value={r.dispatched_at} />, sub: (r) => (r.delivered_at ? 'delivered' : null) },
    { key: 'to', header: 'Delivered to', render: (r) => r.delivery_address || '—', sub: (r) => r.delivery_contact || null },
    { key: 'q', header: 'Laptops', numeric: true, render: (r) => r.laptop_qty },
    { key: 'a', header: 'Charge', numeric: true, render: (r) => <Money value={r.delivery_charge} /> },
  ];

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Customer, DC, SO or address' },
    { key: 'month', label: 'Month', options: MONTH_OPTIONS },
    { key: 'year', label: 'Year', options: yearOptions() },
  ]), []);

  return (
    <DeskShell
      title="Delivery charges"
      breadcrumb="Finance"
      subtitle="Shipping charges on outbound and return DCs, collected outside the rental invoice."
      actions={<Button variant="quiet" disabled={busy === 'xlsx' || !customers.length} onClick={excel}>{busy === 'xlsx' ? 'Exporting…' : 'Excel'}</Button>}
    >
      <div className="c-stack">
        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={report ? report.label : ''}
              right={(
                <div style={{ minWidth: '220px' }}>
                  <SearchSelect aria-label="Customer" options={customerOptions} value={customerId} placeholder="Customer: All" onChange={(e) => setCustomerId(e.target.value)} />
                </div>
              )}
            />
          )}
        >
          <div className="c-card-b">
            <Tiles>
              <StatTile label="Total to collect" value={state.loading ? null : <Money value={report?.summary?.total || 0} />} />
              <StatTile label="Customers" value={state.loading ? null : report?.summary?.customer_count ?? 0} />
              <StatTile label="DCs charged" value={state.loading ? null : report?.summary?.dc_count ?? 0} delta={`${report?.summary?.laptop_qty ?? 0} laptops`} />
            </Tiles>
          </div>
        </Panel>

        {trend.length > 0 && (
          <Section title="Last 12 months">
            <div style={{ display: 'grid', gap: '4px' }}>
              {trend.map((t) => (
                <div key={t.label} className="flex items-center font-ui" style={{ gap: '10px', fontSize: 'var(--d-sm)' }}>
                  <span className="text-ink-2" style={{ width: '72px' }}>{t.label}</span>
                  <span style={{ flex: 1, background: 'var(--surface-2)', height: '10px', borderRadius: '4px', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${(Number(t.total || 0) / peak) * 100}%`, background: 'var(--accent)' }} />
                  </span>
                  <span style={{ width: '120px', textAlign: 'right' }}><Money value={t.total} /></span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {state.loading && <EmptyState title="Loading…" />}
        {state.error && <EmptyState title="Could not load delivery charges" body={state.error} />}
        {!state.loading && !state.error && !customers.length && (
          <EmptyState title="No delivery charges this month" body="Only DCs with a shipping charge that were dispatched in the month appear here." />
        )}
        {!state.loading && customers.length > 0 && (
          <Notice tone="info">Send each customer&apos;s statement with the next rental invoice. Rejected and cancelled DCs are left out.</Notice>
        )}
        {customers.map((c) => (
          <Section
            key={c.customer_id ?? c.customer_name}
            title={`${c.customer_name || 'Unknown customer'} · ${c.dc_count} DC(s) · ₹${Number(c.total).toLocaleString('en-IN')}`}
            actions={c.customer_id ? (
              <Button variant="quiet" disabled={busy === `pdf${c.customer_id}`} onClick={() => statement(c)}>
                {busy === `pdf${c.customer_id}` ? 'Preparing…' : 'Statement PDF'}
              </Button>
            ) : null}
          >
            <DataTable columns={dcCols} rows={c.dcs || []} rowKey={(r) => r.dc_number} />
          </Section>
        ))}
      </div>
    </DeskShell>
  );
}
