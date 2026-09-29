import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, Drawer, EmptyState, Field, Input, Notice, SearchSelect, Select,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { REPORTS } from './reportsCatalog';
import {
  RecordView, ReportBlocks, ReportTable, downloadCsv,
} from './reportsShared';
import { errMsg } from './controlShared';

/**
 * One report from the catalogue: its filters, its blocks, a drawer for the
 * rows behind any number, and its downloads. The same page renders all of
 * them — the report entry decides what is fetched and shown.
 */
function FilterField({ f, value, onChange, options, disabled }) {
  if (f.kind === 'check') {
    return <Checkbox label={f.label} checked={Boolean(value)} onChange={(e) => onChange(f.key, e.target.checked)} />;
  }
  let input;
  if (f.kind === 'date') {
    input = <Input type="date" value={value || ''} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value)} />;
  } else if (f.kind === 'search') {
    input = <Input type="search" value={value || ''} placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} />;
  } else if (f.kind === 'searchselect') {
    input = <SearchSelect value={value || ''} placeholder={f.placeholder} options={[{ value: '', label: f.placeholder || 'Any' }, ...options]} onChange={(e) => onChange(f.key, e.target.value)} aria-label={f.label} />;
  } else {
    input = <Select value={value || ''} placeholder={f.placeholder} options={options} onChange={(e) => onChange(f.key, e.target.value)} />;
  }
  return <Field label={f.label}>{input}</Field>;
}

function DrillDrawer({ drill, onClose }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!drill) return undefined;
    let live = true;
    setData(null);
    drill.load()
      .then((d) => { if (live) setData(d ?? (drill.kind === 'rows' ? [] : null)); })
      .catch((e) => { if (live) { setData(drill.kind === 'rows' ? [] : null); toast.error(errMsg(e, 'Could not load')); } });
    return () => { live = false; };
  }, [drill]);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(errMsg(e, 'Download failed')); } finally { setBusy(false); }
  };

  const footer = drill && (
    <div className="flex items-center" style={{ gap: '8px' }}>
      {drill.kind === 'rows' && <Button disabled={!data?.length} onClick={() => downloadCsv(data, drill.columns, drill.csv)}>CSV</Button>}
      {drill.excel && <Button disabled={busy} onClick={() => run(drill.excel)}>Excel</Button>}
      {drill.pdf && <Button variant="primary" disabled={busy} onClick={() => run(drill.pdf)}>PDF</Button>}
    </div>
  );

  return (
    <Drawer open={Boolean(drill)} onClose={onClose} title={drill?.title || ''} width="min(64rem, 100vw)" footer={footer}>
      {drill && (data === null && drill.kind === 'rows' ? <EmptyState title="Loading…" /> : drill.kind === 'rows' ? (
        <div className="c-stack">
          <p className="text-ink-3">{data.length} row(s)</p>
          <ReportTable rows={data} columns={drill.columns} />
        </div>
      ) : data === null ? <EmptyState title="Loading…" /> : <RecordView record={data} />)}
    </Drawer>
  );
}

export default function ReportViewPage() {
  const { reportKey } = useParams();
  const { hasPermission } = usePermission();
  const def = useMemo(() => REPORTS.find((r) => r.key === reportKey), [reportKey]);
  const allowed = Boolean(def && def.sections.some((s) => hasPermission(s, 'view')));

  const [draft, setDraft] = useState(() => (def ? def.defaults() : {}));
  const [values, setValues] = useState(() => (def ? def.defaults() : {}));
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState({});
  const [data, setData] = useState(null);
  // Last good answer: filters whose choices come from the report itself keep them while it reloads.
  const [optData, setOptData] = useState(null);
  const [drill, setDrill] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!def) return;
    const d = def.defaults();
    setDraft(d); setValues(d); setPage(1); setData(null); setOptData(null); setOptions({});
  }, [def]);

  useEffect(() => {
    if (!def?.optionsLoader || !allowed) return;
    def.optionsLoader().then((o) => setOptions(o || {})).catch(() => setOptions({}));
  }, [def, allowed]);

  const load = useCallback(() => {
    if (!def || !allowed) return undefined;
    let live = true;
    setData(null);
    def.load(values, page)
      .then((d) => { if (live) { setData(d || {}); setOptData(d || {}); } })
      .catch((e) => { if (live) { setData({ error: errMsg(e, 'Could not load the report') }); } });
    return () => { live = false; };
  }, [def, allowed, values, page]);
  useEffect(() => load(), [load]);

  if (!def) {
    return (
      <DeskShell title="Report not found" breadcrumb="Control">
        <EmptyState title="No such report" action={<Link to="/carret/control/reports">All reports</Link>} />
      </DeskShell>
    );
  }
  if (!allowed) {
    return (
      <DeskShell title={def.label} breadcrumb="Control · Reports">
        <Notice tone="warn">You do not have access to this report.</Notice>
      </DeskShell>
    );
  }

  const setField = (key, value) => setDraft((p) => ({ ...p, [key]: value }));
  const apply = () => { setPage(1); setValues({ ...draft }); };
  const reset = () => { const d = def.defaults(); setDraft(d); setPage(1); setValues(d); };
  const ready = data && !data.error;
  const blocks = ready ? def.blocks(data, values) : [];
  const downloads = def.downloads ? def.downloads(values) : [];

  const runDownload = async (dl) => {
    setBusy(dl.label);
    try {
      if (dl.csv) {
        const rows = await dl.csv.load();
        downloadCsv(rows, dl.csv.columns, dl.csv.csv);
      } else {
        await dl.run();
      }
      toast.success('Downloaded');
    } catch (e) {
      toast.error(errMsg(e, 'Download failed'));
    } finally {
      setBusy('');
    }
  };

  return (
    <DeskShell
      title={def.label}
      breadcrumb="Control · Reports"
      subtitle={def.blurb}
      actions={(
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Link to="/carret/control/reports">All reports</Link>
          {downloads.map((dl) => (
            <Button key={dl.label} disabled={Boolean(busy)} onClick={() => runDownload(dl)}>{busy === dl.label ? 'Preparing…' : dl.label}</Button>
          ))}
        </div>
      )}
    >
      <div className="c-stack">
        {def.filters.length > 0 && (
          <div className="c-card" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '12px', alignItems: 'end' }}>
              {def.filters.map((f) => (
                <FilterField
                  key={f.key}
                  f={f}
                  value={draft[f.key]}
                  onChange={setField}
                  options={f.options ? f.options(options, optData) : []}
                  disabled={f.kind === 'date' && Boolean(draft.all_time)}
                />
              ))}
              <div className="flex items-center" style={{ gap: '8px' }}>
                <Button variant="primary" onClick={apply}>Apply</Button>
                <Button variant="quiet" onClick={reset}>Reset</Button>
              </div>
            </div>
          </div>
        )}
        {data === null && <EmptyState title="Loading…" />}
        {data?.error && <Notice tone="crit" title="The report did not load">{data.error}</Notice>}
        {ready && <ReportBlocks blocks={blocks} onDrill={setDrill} onPage={setPage} />}
      </div>
      <DrillDrawer drill={drill} onClose={() => setDrill(null)} />
    </DeskShell>
  );
}
