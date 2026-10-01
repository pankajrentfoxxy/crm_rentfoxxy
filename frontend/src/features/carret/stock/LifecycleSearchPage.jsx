import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DocNumber, EmptyState, Input, Notice, Panel, StatusChip,
} from '../../../components/carret';
import { errMsg, fetchAssets } from './stockApi';
import { laptopSub } from './laptopSub';

/**
 * Stock → Laptop Lifecycle: find a laptop by TTSPL or serial and open its
 * whole history (LifecyclePage). Recent searches are a per-browser
 * convenience only.
 */
const RECENT_KEY = 'carret.lifecycle.recent';
const RECENT_MAX = 8;

function readRecent() {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.code === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberLifecycleSearch(entry) {
  try {
    const code = String(entry?.code || '').trim();
    if (!code) return;
    const next = [{ ...entry, code, at: Date.now() }, ...readRecent().filter((x) => x.code.toUpperCase() !== code.toUpperCase())].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage blocked: nothing to remember */ }
}

export default function LifecycleSearchPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState({ loading: false, rows: [], error: null, searched: '' });
  const [recent, setRecent] = useState(() => readRecent());

  // Live results from the asset list search (TTSPL, serial, model, customer, PO).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) { setRes({ loading: false, rows: [], error: null, searched: '' }); return undefined; }
    let cancelled = false;
    setRes((r) => ({ ...r, loading: true, error: null }));
    const t = setTimeout(() => {
      fetchAssets({ search: term, limit: 15 })
        .then(({ data }) => { if (!cancelled) setRes({ loading: false, rows: data?.data || [], error: null, searched: term }); })
        .catch((e) => { if (!cancelled) setRes({ loading: false, rows: [], error: errMsg(e, 'Search failed'), searched: term }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const open = (code, row) => {
    const c = String(code || '').trim();
    if (!c) return;
    rememberLifecycleSearch({ code: c, serial: row?.serial_number || null, model: row?.model_name || null });
    setRecent(readRecent());
    navigate(`/carret/stock/lifecycle/${encodeURIComponent(c)}`);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    // An exact TTSPL / serial match opens straight away; anything else needs a pick.
    const exact = res.rows.find((r) => [r.ttspl_id, r.serial_number].some((v) => v && v.toUpperCase() === term.toUpperCase()));
    if (exact) open(exact.ttspl_id || exact.serial_number, exact);
    else if (res.rows.length === 1) open(res.rows[0].ttspl_id || res.rows[0].serial_number, res.rows[0]);
    else open(term);
  };

  const cols = useMemo(() => [
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id || r.serial_number} />, sub: laptopSub },
    { key: 's', header: 'State', render: (r) => (r.inventory_status ? <StatusChip status={r.inventory_status} /> : <span className="text-ink-3">No status</span>) },
    { key: 'c', header: 'Customer / place', render: (r) => r.customer_name || r.location || '—', sub: (r) => r.current_dc_number || null },
    { key: 'p', header: 'Purchase order', render: (r) => r.purchase_order_number || '—', sub: (r) => r.vendor_name || null },
  ], []);

  return (
    <DeskShell
      title="Laptop Lifecycle"
      breadcrumb="Stock"
      subtitle="Search a laptop to see its whole life: purchase, floor, stock, every customer, returns, charger, and what it has earned against what it cost."
    >
      <div className="c-stack" style={{ maxWidth: '64rem' }}>
        <Panel>
          <form onSubmit={onSubmit} className="c-card-b" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Input
              type="search"
              autoFocus
              placeholder="TTSPL code or serial number"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="TTSPL code or serial number"
              style={{ flex: '1 1 18rem', minWidth: 0, fontSize: '16px' }}
            />
            <Button variant="primary" type="submit" disabled={!q.trim()}>Open lifecycle</Button>
          </form>
        </Panel>

        {res.error && <Notice tone="crit">{res.error}</Notice>}

        {q.trim().length >= 3 ? (
          <Panel title={res.loading ? 'Searching…' : `Matches for “${res.searched || q.trim()}”`}>
            {!res.loading && (
              <DataTable
                columns={cols}
                rows={res.rows}
                rowKey={(r) => r.serial_id}
                onRowClick={(r) => open(r.ttspl_id || r.serial_number, r)}
                empty={<EmptyState title="No laptop matches" body="Try the full TTSPL code (TTSPL1234) or the serial printed on the laptop." />}
              />
            )}
          </Panel>
        ) : (
          <Panel
            title="Recent"
            actions={recent.length > 0 && (
              <Button variant="quiet" onClick={() => { try { window.localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } setRecent([]); }}>Clear</Button>
            )}
          >
            {recent.length === 0 ? (
              <EmptyState title="No recent laptops" body="Type at least 3 characters of a TTSPL code or serial number." />
            ) : (
              <ul className="c-card-b" style={{ listStyle: 'none', margin: 0, display: 'grid', gap: '4px' }}>
                {recent.map((r) => (
                  <li key={r.code}>
                    <button
                      type="button"
                      onClick={() => open(r.code, { serial_number: r.serial, model_name: r.model })}
                      className="font-ui"
                      style={{
                        width: '100%', textAlign: 'left', display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap',
                        padding: '8px 10px', borderRadius: 'var(--d-radius)', border: '1px solid var(--rule)',
                        background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{r.code}</span>
                      {r.serial && r.serial !== r.code && <span className="text-ink-3" style={{ fontSize: '13px' }}>S/N {r.serial}</span>}
                      {r.model && <span className="text-ink-3" style={{ fontSize: '13px' }}>{r.model}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </DeskShell>
  );
}
