import React, { useState } from 'react';
import {
  AssetLineCard,
  ClassificationChain,
  FilterBar,
  FilterSelect,
  KpiTile,
  Modal,
  Mono,
  PriorityChip,
  SectionDivider,
  SlaChip,
  StatusPill,
  Timeline,
  TimelineItem,
  TypeTag,
  ViewChip,
  WorkOrderCard,
} from '../../../components/ui/supportPrimitives';

export default function FoundationPage() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('open');
  const soon = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const mid = new Date(Date.now() + 14 * 3600 * 1000).toISOString();
  const late = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const breached = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6">
      <div>
        <div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold">Phase 0</div>
        <h1 className="text-[19px] font-bold tracking-tight text-sup-ink">Design system</h1>
        <p className="text-[12px] text-sup-muted mt-1">
          Priority chips, SLA countdown, modal and cards. Used by every later screen.
        </p>
      </div>

      <SectionDivider>Priority</SectionDivider>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((p) => <PriorityChip key={p} priority={p} showLabel />)}
      </div>

      <SectionDivider>SLA chip</SectionDivider>
      <div className="flex flex-wrap gap-6 items-end">
        <SlaChip dueAt={soon} startedAt={new Date(Date.now() - 2 * 3600 * 1000).toISOString()} />
        <SlaChip dueAt={mid} startedAt={new Date(Date.now() - 14 * 3600 * 1000).toISOString()} />
        <SlaChip dueAt={late} startedAt={new Date(Date.now() - 21 * 3600 * 1000).toISOString()} />
        <SlaChip dueAt={breached} />
        <SlaChip paused />
      </div>

      <SectionDivider>Status · type · identifiers</SectionDivider>
      <div className="flex flex-wrap gap-2 items-center">
        <StatusPill status="NEW" />
        <StatusPill status="IN_PROGRESS" />
        <StatusPill status="RESOLVED" />
        <StatusPill kind="wo" status="EN_ROUTE" />
        <TypeTag type="REPAIR_PICKUP" />
        <Mono bold>STK-26-27-00412</Mono>
        <ClassificationChain type="Hardware" subtype="Display" issue="Cracked screen" />
      </div>

      <SectionDivider>KPI · filters</SectionDivider>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Open tickets" value="24" hint="Across all priorities" />
        <KpiTile label="Breached" value="3" tone="danger" hint="Need a reason code" />
        <KpiTile label="Unassigned WOs" value="7" tone="warn" />
        <KpiTile label="My jobs" value="2" tone="ok" />
      </div>
      <FilterBar>
        <ViewChip active={view === 'open'} onClick={() => setView('open')} count={24}>All open</ViewChip>
        <ViewChip active={view === 'mine'} onClick={() => setView('mine')} count={2}>Mine</ViewChip>
        <ViewChip active={view === 'breach'} onClick={() => setView('breach')} count={3} danger>Breached</ViewChip>
        <FilterSelect label="Priority" value="" onChange={() => {}}>
          <option value="">All</option>
          <option value="1">P1</option>
        </FilterSelect>
      </FilterBar>

      <SectionDivider>Cards · timeline · modal</SectionDivider>
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
      <Timeline>
        <TimelineItem title="Ticket created" meta="16 Aug 22:10 · Demo Agent">Raised from the customer portal.</TimelineItem>
        <TimelineItem title="Classified" meta="16 Aug 22:14 · Demo Lead" last>Hardware › Display › Cracked screen</TimelineItem>
      </Timeline>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 px-3 rounded-lg bg-sup-accent text-white text-[12px] font-semibold"
      >
        Open modal
      </button>
      <Modal
        open={open}
        title="Approve charge"
        subtitle="Closes on Escape, backdrop and the X"
        onClose={() => setOpen(false)}
        size="sm"
        footer={(
          <button type="button" onClick={() => setOpen(false)} className="h-9 px-3 rounded-lg border border-sup-line text-[12px] font-semibold">
            Close
          </button>
        )}
      >
        <p className="text-[12.5px] text-sup-ink2 m-0">Chargeable so far: <Mono bold>₹2,850</Mono></p>
      </Modal>
    </div>
  );
}
