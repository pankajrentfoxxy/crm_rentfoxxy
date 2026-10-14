import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, DataTable, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, Notice, Section, Textarea,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { createLoan, getTicketLoanContext, listAvailableLaptops } from '../../../loan-laptops/loanLaptopApi';
import { errMsg } from '../serveShared';
import { LoanChip, PolicyChip, specLine } from './loanShared';

/**
 * The ticket's loan laptops: live loans, and "Lend a laptop" on each repair
 * pickup (the loan can go out before the customer's laptop is collected).
 * Hidden when the loan feature is not installed or the user cannot raise loans.
 */
function whereOriginal(p) {
  if (p.warehouse_received_at) return 'Their laptop is at the warehouse';
  if (p.original_collected) return 'Their laptop is collected, on the way in';
  return 'Their laptop is not collected yet — a loan can still go now';
}

function RequestLoanDrawer({ ticketId, pickup, onClose, onDone }) {
  const d = pickup?.delivery_defaults || {};
  const [q, setQ] = useState('');
  const [laptops, setLaptops] = useState(null);
  const [picked, setPicked] = useState(null);
  const [addr, setAddr] = useState({
    name: d.contact_name || '', phone: d.contact_phone || '', address: d.address || '', city: d.city || '', state: d.state || '', pincode: d.pincode || '',
  });
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pickup) return undefined;
    let live = true;
    const t = setTimeout(() => {
      listAvailableLaptops(pickup.item_id, q.trim() || undefined)
        .then(({ data }) => { if (live) setLaptops(data.data?.laptops || []); })
        .catch((e) => { if (live) { setLaptops([]); toast.error(errMsg(e, 'Could not load stock')); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [pickup, q]);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await createLoan({
        ticket_id: ticketId,
        pickup_item_id: pickup.item_id,
        loan_serial_id: picked.serial_id,
        delivery_address: addr,
        contact_name: addr.name,
        contact_phone: addr.phone,
        remarks,
      });
      toast.success(data.data.status === 'pending_approval'
        ? `${data.data.request_number} sent to Accounts for approval`
        : `${data.data.request_number} allowed by policy — warehouse raises the Loan DC`);
      onDone(data.data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const setA = (k) => (e) => setAddr({ ...addr, [k]: e.target.value });
  return (
    <Drawer
      open={Boolean(pickup)}
      onClose={onClose}
      width="44rem"
      title={`Lend a laptop while ${pickup?.ttspl_id || ''} is repaired`}
      footer={<Button variant="primary" disabled={busy || !picked || !addr.address.trim()} onClick={submit}>{busy ? 'Saving…' : 'Ask for this loan'}</Button>}
    >
      <div className="c-stack">
        <p className="text-ink-3">Their laptop: {specLine(pickup?.original?.spec)}. A loan laptop is never charged and has no Sales Order; rent applies only if the customer later keeps it and Accounts approve.</p>
        <Field label="In stock, QC passed"><Input placeholder="Search TTSPL, model, processor…" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        {laptops === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={[
              { key: 't', header: 'Laptop', render: (l) => <DocNumber value={l.ttspl_id} />, sub: (l) => specLine(l.spec) },
              { key: 'p', header: 'Policy', render: (l) => <PolicyChip decision={l.policy?.decision} /> },
              { key: 'x', header: '', render: (l) => (picked?.serial_id === l.serial_id ? <strong>Chosen</strong> : null) },
            ]}
            rows={laptops}
            rowKey={(l) => l.serial_id}
            onRowClick={(l) => { if (l.policy?.decision !== 'not_allowed') setPicked(l); else toast.error(l.policy?.reason || 'The policy does not allow this laptop'); }}
            empty={<EmptyState title="No laptop matches" />}
          />
        )}
        {picked && (
          <Notice tone={picked.policy?.approval_required ? 'warn' : 'good'} title={`${picked.ttspl_id} chosen`}>
            {picked.policy?.reason}
            {picked.policy?.approval_required ? ' Accounts approve it and set the rent (if kept) before the Loan DC.' : ''}
          </Notice>
        )}
        <FormGrid cols={2}>
          <Field label="Contact name"><Input value={addr.name} onChange={setA('name')} /></Field>
          <Field label="Contact phone"><Input inputMode="numeric" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></Field>
          <Field label="Deliver to" required span={2}><Textarea rows={2} value={addr.address} onChange={setA('address')} /></Field>
          <Field label="City"><Input value={addr.city} onChange={setA('city')} /></Field>
          <Field label="State"><Input value={addr.state} onChange={setA('state')} /></Field>
          <Field label="Pincode"><Input inputMode="numeric" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></Field>
          <Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </FormGrid>
      </div>
    </Drawer>
  );
}

export default function TicketLoanPanel({ ticketId, refreshKey = '' }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canRaise = hasPermission('loan_laptops', 'edit');
  const [ctx, setCtx] = useState(null);
  const [lendFor, setLendFor] = useState(null);

  const load = useCallback(() => {
    if (!canRaise) return;
    getTicketLoanContext(ticketId)
      .then(({ data }) => setCtx(data.data))
      .catch(() => setCtx(null)); // not installed / no access: stay hidden
    // refreshKey: the ticket was reloaded (a pickup was raised or moved on).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, canRaise, refreshKey]);
  useEffect(() => { load(); }, [load]);

  if (!ctx) return null;
  const pickups = ctx.pickups || [];
  const loans = ctx.loans || [];
  if (!pickups.length && !loans.length) return null;

  return (
    <Section title="Loan laptop">
      <div className="c-stack">
        {loans.length > 0 && (
          <DataTable
            columns={[
              { key: 'n', header: 'Loan', render: (l) => <DocNumber value={l.request_number} /> },
              { key: 'l', header: 'Loan laptop', render: (l) => <DocNumber value={l.loan_ttspl_id || '—'} />, sub: (l) => `for ${l.original_ttspl_id || '—'}` },
              { key: 's', header: 'Where it is', render: (l) => <LoanChip status={l.status} /> },
            ]}
            rows={loans}
            rowKey={(l) => l.id}
            onRowClick={(l) => navigate(`/carret/serve/loans/${l.id}`)}
          />
        )}
        {pickups.length > 0 && (
          <DataTable
            columns={[
              { key: 't', header: 'Repair pickup', render: (p) => <DocNumber value={p.ttspl_id || '—'} />, sub: (p) => whereOriginal(p) },
              { key: 'e', header: '', render: (p) => (p.eligible ? null : <span className="text-ink-3">{(p.reasons || []).join('; ')}</span>) },
              {
                key: 'x',
                header: '',
                render: (p) => (p.eligible ? <Button variant="primary" onClick={(e) => { e.stopPropagation(); setLendFor(p); }}>Lend a laptop</Button> : null),
              },
            ]}
            rows={pickups}
            rowKey={(p) => p.item_id}
          />
        )}
      </div>
      <RequestLoanDrawer
        key={lendFor?.item_id || 'none'}
        ticketId={ticketId}
        pickup={lendFor}
        onClose={() => setLendFor(null)}
        onDone={(created) => { setLendFor(null); load(); if (created?.id) navigate(`/carret/serve/loans/${created.id}`); }}
      />
    </Section>
  );
}
