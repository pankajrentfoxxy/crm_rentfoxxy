import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FilterBar, FormGrid, Input, Money, Notice, Panel,
  SearchSelect, StatTile, StatusChip, Textarea,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  DN_STATUS_LABEL, createDebitNote, dnChipStatus, errMsg, isDraftNote, useBillableVendors, useDebitNotes,
} from './vendorMoneyApi';

/**
 * Finance → Vendors → Debit notes. Replaces vendor-billing/DebitNotesPage.
 *
 * Money the vendor owes us, deducted from their next vendor bill. Drafts are
 * raised at Rs 0 when a laptop goes back (return, repair, QC fail): set the
 * amount, then someone approves it. A Rs 0 note cannot be approved.
 */
const STATUS_OPTIONS = Object.entries(DN_STATUS_LABEL).map(([value, label]) => ({ value, label: label.split(' —')[0] }));

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function CreateDrawer({ open, onClose, vendors, onDone }) {
  const [form, setForm] = useState({ vendor_id: '', reason: '', description: '', quantity: '', unit_rate: '', amount: '', ttspl: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const computed = form.amount !== '' ? Number(form.amount) : (Number(form.quantity) || 0) * (Number(form.unit_rate) || 0);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await createDebitNote({
        vendor_id: Number(form.vendor_id),
        reason: form.reason.trim(),
        description: form.description.trim() || null,
        quantity: form.quantity === '' ? undefined : Number(form.quantity),
        unit_rate: form.unit_rate === '' ? undefined : Number(form.unit_rate),
        amount: form.amount === '' ? undefined : Number(form.amount),
        ttspl_ids: form.ttspl.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
      });
      toast.success(`${data.debit_note.debit_note_number} raised — someone approves it next`);
      onDone(data.debit_note);
    } catch (e) {
      toast.error(errMsg(e, 'Could not raise the debit note.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Raise a debit note"
      footer={<Button variant="primary" disabled={busy || !form.vendor_id || !form.reason.trim()} onClick={save}>{busy ? 'Saving…' : 'Raise'}</Button>}
    >
      <FormGrid cols={1}>
        <Field label="Vendor" required>
          <SearchSelect
            value={form.vendor_id}
            onChange={(e) => set('vendor_id', e.target.value)}
            placeholder="Choose a vendor…"
            options={vendors.map((v) => ({ value: String(v.vendor_id), label: v.vendor_name || `Vendor #${v.vendor_id}` }))}
          />
        </Field>
        <Field label="Reason" required hint="e.g. Damage, short supply, rent overcharged">
          <Input value={form.reason} maxLength={255} onChange={(e) => set('reason', e.target.value)} />
        </Field>
        <Field label="Laptops (TTSPL codes)" hint="Optional, separated by commas or spaces.">
          <Input value={form.ttspl} onChange={(e) => set('ttspl', e.target.value)} />
        </Field>
        <Field label="Units"><Input type="number" min="0" step="1" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>
        <Field label="Rate per unit"><Input type="number" min="0" step="0.01" value={form.unit_rate} onChange={(e) => set('unit_rate', e.target.value)} /></Field>
        <Field label="Amount" hint={form.amount === '' ? `Blank = units × rate (₹${computed.toFixed(2)}). Rs 0 stays a draft.` : null}>
          <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
        </Field>
        <Field label="Description"><Textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
      </FormGrid>
    </Drawer>
  );
}

export default function DebitNotesListPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('debit_notes', 'create');
  const [filters, setFilters] = useState({});
  const [createOpen, setCreateOpen] = useState(false);
  const search = useDebounced(filters.search || '');
  const { vendors } = useBillableVendors(true);
  const { loading, error, rows } = useDebitNotes({
    search, vendor_id: filters.vendor_id, status: filters.status, draft: filters.draft,
  });

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => setFilters({}), []);

  const stats = useMemo(() => {
    const s = { drafts: 0, pending: 0, pendingAmt: 0, waiting: 0, waitingAmt: 0 };
    rows.forEach((r) => {
      if (isDraftNote(r)) s.drafts += 1;
      else if (r.status === 'pending') { s.pending += 1; s.pendingAmt += Number(r.amount || 0); }
      if (r.status === 'approved') { s.waiting += 1; s.waitingAmt += Number(r.amount || 0); }
    });
    return s;
  }, [rows]);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Note number, vendor, TTSPL or reason' },
    { key: 'vendor_id', label: 'Vendor', options: vendors.map((v) => ({ value: String(v.vendor_id), label: v.vendor_name || `#${v.vendor_id}` })) },
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
    { key: 'draft', label: 'Rs 0 drafts', options: [{ value: '1', label: 'only' }] },
  ]), [vendors]);

  const columns = useMemo(() => [
    { key: 'n', header: 'Debit note', render: (r) => <DocNumber value={r.debit_note_number} />, sub: (r) => r.reason },
    { key: 'v', header: 'Vendor', render: (r) => r.vendor_name || `#${r.vendor_id}`, sub: (r) => r.po_number || null },
    {
      key: 's', header: 'Status',
      render: (r) => (isDraftNote(r)
        ? <StatusChip status="draft" label="Draft — set the amount" />
        : <StatusChip status={dnChipStatus(r.status)} label={DN_STATUS_LABEL[r.status]?.split(' —')[0] || r.status} />),
      sub: (r) => (r.adjusted_in_bill_number ? `on ${r.adjusted_in_bill_number}` : null),
    },
    { key: 'src', header: 'From', render: (r) => (r.source ? String(r.source).replace(/_/g, ' ') : 'manual'), sub: (r) => r.source_ref || null },
    { key: 'd', header: 'Raised', render: (r) => <DateTime value={r.created_at} /> },
    { key: 'a', header: 'Amount', numeric: true, render: (r) => <Money value={r.amount} /> },
  ], []);

  return (
    <DeskShell
      title="Debit Notes"
      breadcrumb="Finance / Vendors"
      subtitle="What vendors owe us — deducted from their next vendor bill."
      actions={canCreate && <Button variant="primary" onClick={() => setCreateOpen(true)}>Raise debit note</Button>}
    >
      <div className="c-stack">
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <StatTile label="Rs 0 drafts" value={loading ? null : stats.drafts} family={stats.drafts ? 'moving' : undefined} delta="set the amount" />
          <StatTile label="To approve" value={loading ? null : stats.pending} delta={<Money value={stats.pendingAmt} />} />
          <StatTile label="Approved, waiting for a bill" value={loading ? null : stats.waiting} delta={<Money value={stats.waitingAmt} />} />
        </div>
        {stats.drafts > 0 && !filters.draft && (
          <Notice tone="warn" title={`${stats.drafts} draft(s) at Rs 0`} action={<Button onClick={() => onFilter('draft', '1')}>Show them</Button>}>
            Raised automatically when a laptop went back to its vendor. Open each one, set what the vendor owes, then have it approved.
          </Notice>
        )}
        <Panel
          toolbar={(
            <FilterBar filters={filterDefs} values={filters} onChange={onFilter} onClear={onClear} count={loading ? '…' : `${rows.length} shown`} />
          )}
        >
          {loading && <EmptyState title="Loading…" />}
          {error && <EmptyState title="Could not load debit notes" body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.debit_note_id}
              onRowClick={(r) => navigate(`/carret/money/debit-notes/${r.debit_note_id}`)}
              empty={<EmptyState title="No debit notes match" action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>} />}
            />
          )}
        </Panel>
      </div>
      {createOpen && (
        <CreateDrawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          vendors={vendors}
          onDone={(n) => { setCreateOpen(false); navigate(`/carret/money/debit-notes/${n.debit_note_id}`); }}
        />
      )}
    </DeskShell>
  );
}
