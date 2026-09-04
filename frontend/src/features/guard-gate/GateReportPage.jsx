import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, LayoutDashboard, Loader2, ShieldAlert } from 'lucide-react';
import {
  DateRangeFilter,
  ListPagination,
  PageHeader,
  SearchField,
  StatCard,
} from '../../components/ui/primitives';
import SheetsColumnFilter from '../../components/ui/SheetsColumnFilter';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import {
  detectDatePreset,
  todayDateInput,
} from '../../utils/dateRangeFilter';
import { getGateReport, getGateReportColumnValues } from './guardGateApi';
import {
  GATE_COLUMN_TYPES,
  GATE_TABLE_COLUMNS,
  clearColumnFilterParams,
  columnFiltersToParams,
  readColumnFiltersFromParams,
} from './gateReportColumnFilters';

const PAGE_SIZE = 50;

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function sourceLabel(value) {
  const s = String(value || '').replace(/_/g, ' ').trim();
  if (!s) return '—';
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function periodParams(dateFrom, dateTo) {
  const preset = detectDatePreset(dateFrom, dateTo);
  if (preset === 'all') return { period: 'all' };
  const params = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  return params;
}

function cellValue(row, key) {
  if (key === 'scan_time') return formatDateTime(row.scan_time);
  if (key === 'direction') return String(row.direction || '—').toUpperCase();
  if (key === 'source_type') return sourceLabel(row.source_type);
  if (key === 'validation_result') return String(row.validation_result || '—').toUpperCase();
  return row[key] || '—';
}

export default function GateReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayDateInput();
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const searchDebounced = useDebouncedValue(searchInput.trim(), 320);
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || today);
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || today);
  const [direction, setDirection] = useState(searchParams.get('direction') || '');
  const [page, setPage] = useState(Number(searchParams.get('page') || 1) || 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const queryKey = searchParams.toString();
  const columnFilters = useMemo(() => readColumnFiltersFromParams(searchParams), [queryKey]);
  const cfParams = useMemo(() => columnFiltersToParams(columnFilters), [columnFilters]);

  const apiParams = useMemo(() => ({
    ...periodParams(dateFrom, dateTo),
    q: searchDebounced || undefined,
    direction: direction || undefined,
    page,
    limit: PAGE_SIZE,
    ...cfParams,
  }), [dateFrom, dateTo, searchDebounced, direction, page, cfParams]);

  useEffect(() => { setPage(1); }, [searchDebounced, dateFrom, dateTo, direction, queryKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getGateReport(apiParams)
      .then((res) => {
        if (cancelled) return;
        setData(res.data?.data || res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.message || 'Unable to load gate report');
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiParams]);

  const applyColumnFilter = useCallback((columnKey, filter) => {
    setSearchParams((prev) => {
      const next = clearColumnFilterParams(prev);
      const merged = { ...readColumnFiltersFromParams(prev) };
      if (filter) merged[columnKey] = filter;
      else delete merged[columnKey];
      const cf = columnFiltersToParams(merged);
      Object.entries(cf).forEach(([k, v]) => next.set(k, v));
      next.set('page', '1');
      return next;
    });
    setPage(1);
  }, [setSearchParams]);

  const clearColumnFilter = useCallback((columnKey) => {
    applyColumnFilter(columnKey, null);
  }, [applyColumnFilter]);

  const fetchColumnOptions = useCallback(async (columnKey) => {
    const { data: payload } = await getGateReportColumnValues({
      ...periodParams(dateFrom, dateTo),
      q: searchDebounced || undefined,
      direction: direction || undefined,
      column: columnKey,
      ...cfParams,
    });
    return payload?.data || payload || [];
  }, [dateFrom, dateTo, searchDebounced, direction, cfParams]);

  const toggleDirection = (dir) => {
    setDirection((prev) => (prev === dir ? '' : dir));
    setPage(1);
  };

  const rows = data?.rows || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE };
  const rangeLabel = detectDatePreset(dateFrom, dateTo) === 'all'
    ? 'all dates'
    : detectDatePreset(dateFrom, dateTo) === 'custom'
      ? `${dateFrom || '…'} – ${dateTo || '…'}`
      : detectDatePreset(dateFrom, dateTo);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <PageHeader
        title="Gate Dashboard"
        subtitle="Inward and outward laptop scans at the warehouse gate"
        icon={LayoutDashboard}
      />

      <div className="flex flex-col xl:flex-row xl:items-end gap-3">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search TTSPL, serial, DC, AWB, guard, brand…"
          className="max-w-none w-full xl:max-w-md"
        />
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={(v) => { setDateFrom(v); setPage(1); }}
          onDateToChange={(v) => { setDateTo(v); setPage(1); }}
          onRangeChange={({ dateFrom: from, dateTo: to }) => {
            setDateFrom(from);
            setDateTo(to);
            setPage(1);
          }}
          layout="inline"
        />
      </div>

      {error ? (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Inward"
          value={data?.inward ?? '—'}
          icon={ArrowDownToLine}
          tone="teal"
          hint={rangeLabel}
          active={direction === 'inward'}
          onClick={() => toggleDirection('inward')}
        />
        <StatCard
          label="Outward"
          value={data?.outward ?? '—'}
          icon={ArrowUpFromLine}
          tone="amber"
          hint={rangeLabel}
          active={direction === 'outward'}
          onClick={() => toggleDirection('outward')}
        />
        <StatCard
          label="Invalid attempts"
          value={data?.invalid ?? '—'}
          icon={ShieldAlert}
          tone="red"
          hint={rangeLabel}
        />
        <StatCard
          label="Total scans"
          value={data?.total_scans ?? '—'}
          icon={LayoutDashboard}
          tone="blue"
          hint={rangeLabel}
        />
      </div>

      {direction ? (
        <button
          type="button"
          onClick={() => setDirection('')}
          className="text-xs text-slate-600 underline"
        >
          Clear {direction} filter · show all directions
        </button>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Laptop scans</h2>
          <span className="text-xs text-slate-400">
            {loading ? 'Loading…' : `${pagination.total || 0} laptop${pagination.total === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="overflow-x-auto">
          {loading && !rows.length ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading
            </div>
          ) : (
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  {GATE_TABLE_COLUMNS.map((col) => (
                    <SheetsColumnFilter
                      key={col.key}
                      columnKey={col.key}
                      label={col.label}
                      filterType={GATE_COLUMN_TYPES[col.key] || 'text'}
                      activeFilter={columnFilters[col.key]}
                      onApplyFilter={applyColumnFilter}
                      onClearFilter={clearColumnFilter}
                      fetchOptions={fetchColumnOptions}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length ? rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    {GATE_TABLE_COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 whitespace-nowrap ${
                          col.key === 'ttspl' || col.key === 'serial_number' ? 'font-mono text-slate-900' : 'text-slate-700'
                        } ${col.key === 'validation_result'
                          ? (row.validation_result === 'valid' ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold')
                          : ''
                        }`}
                      >
                        {cellValue(row, col.key)}
                      </td>
                    ))}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={GATE_TABLE_COLUMNS.length} className="px-4 py-10 text-center text-sm text-slate-500">
                      No laptop scans in this date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 pb-4">
          <ListPagination
            page={pagination.page || page}
            totalPages={pagination.totalPages || 1}
            total={pagination.total || 0}
            pageSize={pagination.limit || PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  );
}
