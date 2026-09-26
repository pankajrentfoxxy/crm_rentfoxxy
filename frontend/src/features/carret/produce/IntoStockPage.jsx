import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, Notice, Section, Select, StatusChip,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { errMsg } from './produceShared';

/**
 * Production → Into stock.
 *
 * The one way a refurbished laptop goes into stock (PD5): it passed QC2, and
 * the warehouse scans its serial into a carret and slot. Only then is it "in
 * stock" and tagged Ready-to-Rent / Ready-to-Sell. A laptop the floor manager
 * failed, or that is not ours, is refused.
 */
const PA = '/production-assets';
const CARRETS = Array.from({ length: 30 }, (_, i) => String(i + 1));
const SLOTS = 17;
const TAG = { rental: 'Ready to rent', sale: 'Ready to sell', both: 'Rent or sell' };

export default function IntoStockPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canReceive = hasPermission('pending_inventory', 'edit');
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [pick, setPick] = useState(null);
  const [form, setForm] = useState({ serial: '', carret: '', slot: '' });
  const [taken, setTaken] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`${PA}/pending-inventory`, { params: { limit: 500 } })
      .then(({ data }) => setRows(data.data || []))
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load')); });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!form.carret) { setTaken(null); return; }
    api.get(`${PA}/carret-availability`, { params: { carret: form.carret } })
      .then(({ data }) => setTaken(new Set((data.data?.slots || []).map((x) => String(x.slot)))))
      .catch(() => setTaken(null));
  }, [form.carret]);

  const receive = async () => {
    setBusy(true);
    try {
      await api.post(`${PA}/${pick.production_asset_id}/receive`, { serial_number: form.serial.trim(), warehouse_carret: Number(form.carret), warehouse_carret_slot: Number(form.slot) });
      toast.success(`${pick.ttspl_id} is in stock at carret ${form.carret}, slot ${form.slot}`);
      setPick(null);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not receive it'));
    } finally {
      setBusy(false);
    }
  };

  const shown = (rows || []).filter((r) => !search.trim() || [r.ttspl_id, r.serial_number, r.model].some((x) => String(x || '').toLowerCase().includes(search.trim().toLowerCase())));
  const cols = [
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => [r.brand, r.model, r.processor, r.ram, r.ssd || r.storage].filter(Boolean).join(' · ') },
    { key: 'tag', header: 'For', render: (r) => (r.inventory_tag ? <StatusChip status="approved" label={TAG[r.inventory_tag] || r.inventory_tag} /> : <span className="text-ink-3">not tagged</span>) },
    { key: 'q', header: 'Passed QC2', render: (r) => (r.qc2_completed_at ? <DateTime value={r.qc2_completed_at} /> : '—'), sub: (r) => r.qc2_completed_by_name || null },
    { key: 'a', header: '', render: (r) => canReceive && <Button variant="primary" onClick={(e) => { e.stopPropagation(); setPick(r); setForm({ serial: '', carret: '', slot: '' }); }}>Receive</Button> },
  ];
  const freeSlots = Array.from({ length: SLOTS }, (_, i) => String(i + 1)).filter((s) => !taken || !taken.has(s));

  return (
    <DeskShell title="Into stock" breadcrumb="Production" subtitle="Laptops that passed QC, waiting to be scanned into a carret slot.">
      <div className="c-stack">
        <Section title={`Waiting · ${rows ? rows.length : '…'}`} actions={<Input type="search" placeholder="TTSPL, serial, model" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '14rem' }} aria-label="Search" />}>
          {rows === null ? <EmptyState title="Loading…" /> : (
            <DataTable columns={cols} rows={shown} rowKey={(r) => r.production_asset_id} onRowClick={(r) => r.ticket_id && navigate(`/carret/produce/tickets/${r.ticket_id}`)} empty={<EmptyState title="Nothing waiting" />} />
          )}
        </Section>
      </div>
      <Drawer open={Boolean(pick)} onClose={() => setPick(null)} title={`Receive ${pick?.ttspl_id || ''}`} footer={<Button variant="primary" disabled={busy || !form.serial.trim() || !form.carret || !form.slot} onClick={receive}>{busy ? 'Receiving…' : 'Put into stock'}</Button>}>
        {pick && (
          <div className="c-stack">
            <Notice tone="info">Scan the serial on the laptop in your hand — it must match {pick.ttspl_id}.</Notice>
            <Field label="Serial" required><Input autoFocus value={form.serial} onChange={(e) => setForm((f) => ({ ...f, serial: e.target.value.toUpperCase() }))} className="font-mono" /></Field>
            <FormGrid cols={2}>
              <Field label="Carret" required><Select value={form.carret} onChange={(e) => setForm((f) => ({ ...f, carret: e.target.value, slot: '' }))} placeholder="Pick" options={CARRETS} /></Field>
              <Field label="Slot" required hint={taken ? `${freeSlots.length} free` : undefined}><Select value={form.slot} onChange={(e) => setForm((f) => ({ ...f, slot: e.target.value }))} placeholder="Pick" options={freeSlots} disabled={!form.carret} /></Field>
            </FormGrid>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}
