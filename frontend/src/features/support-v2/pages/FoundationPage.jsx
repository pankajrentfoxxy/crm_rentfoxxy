import React, { useState } from 'react';
import {
  AssetLineCard,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClassificationChain,
  DataTable,
  EmptyState,
  FilterBar,
  FilterSelect,
  KpiTile,
  Modal,
  Mono,
  PageHeader,
  PriorityChip,
  prioritySpine,
  SearchField,
  SectionDivider,
  SectionLoader,
  SlaChip,
  StatCard,
  StatusPill,
  Timeline,
  TimelineItem,
  TICKET_STATUS_META,
  TypeTag,
  ViewChip,
  WO_STATUS_META,
  WO_TYPE_META,
  WorkOrderCard,
} from '../../../components/ui/supportPrimitives';

const SWATCHES = [
  ['pri1', '#B32A45'], ['pri1-bg', '#FCEBEE'], ['pri2', '#C2660F'], ['pri2-bg', '#FDF0E3'],
  ['pri3', '#8F6D0A'], ['pri3-bg', '#FBF4DE'], ['pri4', '#5A6472'], ['pri4-bg', '#EEF0F3'],
  ['sup-ink', '#0E1116'], ['sup-ink2', '#39414F'], ['sup-muted', '#6B7382'], ['sup-faint', '#98A0AE'],
  ['sup-canvas', '#F4F6F8'], ['sup-canvas2', '#EDF0F3'], ['sup-line', '#DFE3E9'], ['sup-lineSoft', '#EAEDF1'],
  ['sup-accent', '#134B60'], ['sup-accent2', '#0D7C86'], ['sup-accentSoft', '#E4F1F3'],
  ['sup-ok', '#1B7A4D'], ['sup-okBg', '#E5F3EC'], ['sup-warn', '#B4780C'],
];

const TABLE_ROWS = [
  { id: 1, ticket_number: 'STK-26-27-00412', customer: 'Acme Logistics', priority: 1 },
  { id: 2, ticket_number: 'STK-26-27-00413', customer: 'Demo Gold Office', priority: 2 },
  { id: 3, ticket_number: 'STK-26-27-00414', customer: 'North Hub', priority: 4 },
];

export default function FoundationPage() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('open');
  const [q, setQ] = useState('');
  const soon = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const mid = new Date(Date.now() + 14 * 3600 * 1000).toISOString();
  const late = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const breached = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const started = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        eyebrow="Design contract"
        title="Design system"
        subtitle="This page is the contract. If a screen disagrees with this page, the screen is wrong."
      />

      <SectionDivider>1 · Priority</SectionDivider>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((p) => <PriorityChip key={p} priority={p} showLabel />)}
      </div>
      <div className="space-y-1.5">
        {[1, 2, 3, 4].map((p) => (
          <div key={p} className={`bg-white border border-sup-line rounded-[10px] px-3 py-2 ${prioritySpine(p)}`}>
            <Mono bold>STK-26-27-00{410 + p}</Mono>
            <span className="text-[12px] text-sup-muted ml-2">Spined row · P{p}</span>
          </div>
        ))}
      </div>

      <SectionDivider>2 · SLA</SectionDivider>
      <div className="flex flex-wrap gap-6 items-end">
        <div><div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold mb-1">ok</div><SlaChip dueAt={soon} startedAt={started} /></div>
        <div><div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold mb-1">warn</div><SlaChip dueAt={mid} startedAt={new Date(Date.now() - 14 * 3600 * 1000).toISOString()} /></div>
        <div><div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold mb-1">risk</div><SlaChip dueAt={late} startedAt={new Date(Date.now() - 21 * 3600 * 1000).toISOString()} /></div>
        <div><div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold mb-1">breached</div><SlaChip dueAt={breached} /></div>
        <div><div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold mb-1">paused</div><SlaChip paused /></div>
      </div>

      <SectionDivider>3 · Status</SectionDivider>
      <div className="flex flex-wrap gap-2 items-center">
        {Object.keys(TICKET_STATUS_META).map((s) => <StatusPill key={s} status={s} />)}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {Object.keys(WO_STATUS_META).map((s) => <StatusPill key={s} kind="wo" status={s} />)}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {Object.keys(WO_TYPE_META).map((t) => <TypeTag key={t} type={t} />)}
      </div>

      <SectionDivider>4 · Buttons</SectionDivider>
      <div className="space-y-2">
        {['primary', 'secondary', 'ghost', 'success', 'danger', 'subtle'].map((v) => (
          <div key={v} className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-[10px] uppercase tracking-wide text-sup-faint">{v}</span>
            <Button variant={v} size="sm">{v} sm 25</Button>
            <Button variant={v} size="md">{v} md 30</Button>
            <Button variant={v} size="lg">{v} lg 34</Button>
            <Button variant={v} size="touch">{v} touch</Button>
            <Button variant={v} loading>Loading</Button>
            <Button variant={v} disabled>Disabled</Button>
          </div>
        ))}
      </div>

      <SectionDivider>5 · Badges</SectionDivider>
      <div className="flex flex-wrap gap-2">
        {['gray', 'blue', 'green', 'amber', 'orange', 'red', 'purple', 'outline'].map((t) => (
          <Badge key={t} tone={t}>{t}</Badge>
        ))}
      </div>

      <SectionDivider>6 · Typography</SectionDivider>
      <div className="space-y-1">
        <div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold">Eyebrow</div>
        <h1 className="text-[19px] font-bold tracking-[-0.025em] text-sup-ink">H1 · 19px bold</h1>
        <p className="text-[12px] text-sup-muted">Subtitle · 12px muted</p>
        <div className="text-[12.5px] font-semibold text-sup-ink">Card title · 12.5px</div>
        <div className="text-[9.5px] uppercase tracking-[0.09em] text-sup-faint font-semibold">Table header</div>
        <Mono bold>STK-26-27-00412 · WO-000041 · TTSPL1073</Mono>
        <div className="text-[27px] font-bold tracking-[-0.035em] tabular-nums">27</div>
      </div>

      <SectionDivider>7 · Forms</SectionDivider>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[10px] uppercase tracking-wide text-sup-faint font-semibold">
          Input 31px
          <input className="block mt-0.5 h-[31px] w-56 border border-sup-line rounded-md px-2 text-[12.5px]" defaultValue="Contact name" />
        </label>
        <FilterSelect label="Select 28px" value="1" onChange={() => {}}>
          <option value="1">P1 Critical</option>
        </FilterSelect>
        <SearchField value={q} onChange={setQ} placeholder="Search tickets…" className="w-56" />
        <ViewChip active>Filter chip</ViewChip>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-sup-ink2">
          <input type="checkbox" className="rounded-sm border-sup-line" defaultChecked /> Checkbox
        </label>
      </div>
      <textarea className="w-full max-w-md h-20 border border-sup-line rounded-md p-2 text-[12.5px]" defaultValue="Notes at spec density." />

      <SectionDivider>8 · Table</SectionDivider>
      <Card>
        <DataTable
          columns={[
            { key: 'ticket_number', header: 'Ticket', render: (r) => <Mono bold>{r.ticket_number}</Mono> },
            { key: 'customer', header: 'Customer' },
            { key: 'priority', header: 'Pri', render: (r) => <PriorityChip priority={r.priority} /> },
          ]}
          rows={TABLE_ROWS}
          keyField="id"
          rowClassName={(r) => prioritySpine(r.priority)}
        />
      </Card>

      <SectionDivider>9 · Cards</SectionDivider>
      <div className="grid md:grid-cols-3 gap-3">
        <Card>
          <CardHeader title="Card header" actions={<Button size="sm" variant="secondary">Action</Button>} />
          <CardBody><p className="text-[12px] text-sup-muted m-0">Card body 15px padding, 10px radius.</p></CardBody>
        </Card>
        <StatCard label="Open tickets" value="24" hint="Across all priorities" />
        <StatCard label="Breached" value="3" hint="Need a reason code" alarm />
        <KpiTile label="My jobs" value="2" hint="Today" />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <WorkOrderCard
          woNumber="WO-000041"
          type="FIELD_VISIT"
          status="ASSIGNED"
          priority={1}
          title="Cracked screen — TTSPL1073"
          subtitle="Acme Logistics · Site 2"
          dueAt={late}
        />
        <AssetLineCard
          ttsplId="TTSPL1073"
          serial="S802C0F170715DA8401"
          type="Hardware"
          subtype="Memory"
          issue="8 GB DDR4 failure"
        />
      </div>

      <SectionDivider>10 · Feedback</SectionDivider>
      <div className="grid md:grid-cols-2 gap-3">
        <Card><EmptyState title="Nothing here" hint="Clear a filter or pick another saved view" /></Card>
        <Card><SectionLoader label="Loading…" /></Card>
      </div>
      <div className="space-y-2">
        <div className="rounded-[10px] border border-sup-ok bg-sup-okBg px-3 py-2 text-[12px] text-sup-ok">ok bar — suggestion / success</div>
        <div className="rounded-[10px] border border-sup-warn/40 bg-[#FBF4DE] px-3 py-2 text-[12px] text-sup-warn">warn bar</div>
        <div className="rounded-[10px] border border-pri1-ring bg-[#FEF7F8] px-3 py-2 text-[12px] text-pri1">hot bar — P1 / breach only</div>
        <div className="rounded-[10px] border border-sup-line bg-sup-accentSoft px-3 py-2 text-[12px] text-sup-accent">note bar</div>
      </div>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal
        open={open}
        title="Approve charge"
        subtitle="Closes on Escape, backdrop and the X"
        onClose={() => setOpen(false)}
        size="sm"
        footer={<Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>}
      >
        <p className="text-[12.5px] text-sup-ink2 m-0">Chargeable so far: <Mono bold>₹2,850</Mono></p>
      </Modal>
      <FilterBar>
        <ViewChip active={view === 'open'} onClick={() => setView('open')} count={24}>All open</ViewChip>
        <ViewChip active={view === 'mine'} onClick={() => setView('mine')} count={2}>Mine</ViewChip>
        <ViewChip active={view === 'breach'} onClick={() => setView('breach')} count={3} danger>Breached</ViewChip>
      </FilterBar>
      <ClassificationChain type="Hardware" subtype="Display" issue="Cracked screen" />
      <Timeline>
        <TimelineItem title="Ticket created" meta="16 Aug 22:10 · Demo Agent">Raised from the customer portal.</TimelineItem>
        <TimelineItem title="Classified" meta="16 Aug 22:14 · Demo Lead" last>Hardware › Display › Cracked screen</TimelineItem>
      </Timeline>

      <SectionDivider>11 · Colour tokens</SectionDivider>
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {SWATCHES.map(([name, hex]) => (
          <div key={name} className="bg-white border border-sup-line rounded-[10px] overflow-hidden">
            <div className="h-10" style={{ background: hex }} />
            <div className="px-2 py-1.5">
              <div className="text-[10.5px] font-semibold text-sup-ink">{name}</div>
              <Mono className="text-[10px] text-sup-muted">{hex}</Mono>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
