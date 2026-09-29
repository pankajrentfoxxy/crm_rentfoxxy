import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import { Button, EmptyState, Input, Notice, Section } from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { REPORT_GROUPS, visibleReports } from './reportsCatalog';

/**
 * Control → Reports. The fourteen reports of the old /reports area, grouped,
 * each shown only to people holding its report section. Open one to filter,
 * view, drill into the rows behind a number and download (Excel / PDF / CSV).
 */
function ReportCard({ report, onOpen }) {
  const downloads = report.key === 'production-qc-report' ? 'PDF · CSV' : report.downloads ? 'Excel · CSV' : 'CSV';
  return (
    <div className="c-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div className="font-ui" style={{ fontWeight: 600 }}>{report.label}</div>
      <div className="text-ink-3" style={{ flex: 1 }}>{report.blurb}</div>
      <div className="flex items-center" style={{ gap: '8px', justifyContent: 'space-between' }}>
        <span className="text-ink-3 font-mono" style={{ fontSize: 'var(--d-sm)' }}>{downloads}</span>
        <Button variant="primary" onClick={() => onOpen(report)}>Open</Button>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [q, setQ] = useState('');
  const mine = useMemo(() => visibleReports(hasPermission), [hasPermission]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return mine.filter((r) => words.every((w) => `${r.label} ${r.blurb} ${r.group}`.toLowerCase().includes(w)));
  }, [mine, q]);
  const open = (r) => navigate(`/carret/control/reports/${r.key}`);

  return (
    <DeskShell title="Reports" breadcrumb="Control" subtitle="Money, sales, stock, floor, support and movement reports — view, drill down and download.">
      <div className="c-stack">
        <Input type="search" placeholder="Find a report" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '20rem' }} aria-label="Find a report" />
        {mine.length === 0 && <Notice tone="warn">You have no report access. Ask an admin for the report you need.</Notice>}
        {mine.length > 0 && shown.length === 0 && <EmptyState title="No report matches" />}
        {REPORT_GROUPS.map((g) => {
          const list = shown.filter((r) => r.group === g);
          if (!list.length) return null;
          return (
            <Section key={g} title={g}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                {list.map((r) => <ReportCard key={r.key} report={r} onOpen={open} />)}
              </div>
            </Section>
          );
        })}
      </div>
    </DeskShell>
  );
}
