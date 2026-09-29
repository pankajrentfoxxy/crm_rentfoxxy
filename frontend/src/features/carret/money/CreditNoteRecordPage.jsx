import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, DocumentHeader, EmptyState, Money, Notice, Section, StatTile,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  approveCreditNote, blobErrMsg, creditNotePdf, errMsg, getCreditNote, saveBlob,
} from './moneyApi';
import { MoneyChip, Tiles } from './moneyShared';
import { CancelCreditNoteDrawer } from './CreditNoteDrawers';

/**
 * Credit note record (Builder 1, MD2): its laptops, approve all or only the
 * ticked laptops (the rest stay on the draft), cancel, the PDF, and the other
 * notes raised for the same return in the same month.
 */

const lineKey = (line, idx) => {
  const sid = Number(line?.serial_id);
  if (Number.isFinite(sid) && sid > 0) return `s:${sid}`;
  const t = String(line?.ttspl_id || '').trim();
  return t ? `t:${t}` : `i:${idx}`;
};

export default function CreditNoteRecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission, user } = usePermission();
  const canApprove = hasPermission('credit_notes', 'edit');
  const me = Number(user?.user_id || user?.id || 0);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(() => {
    getCreditNote(id)
      .then(({ data: d }) => { setData(d); setError(''); setPicked(new Set()); })
      .catch((e) => setError(errMsg(e, 'Credit note not found')));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const cn = data?.credit_note;
  const lines = useMemo(() => (Array.isArray(cn?.line_items) ? cn.line_items : []).map((l, i) => ({ ...l, _key: lineKey(l, i) })), [cn]);
  const related = useMemo(() => [...(data?.pending_credit_notes || []), ...(data?.approved_credit_notes || [])]
    .filter((n) => Number(n.credit_note_id) !== Number(id)), [data, id]);

  if (error) {
    return (
      <DeskShell title="Credit note" breadcrumb="Finance / Credit notes">
        <EmptyState title="Could not open this credit note" body={error} action={<Button onClick={() => navigate('/carret/money/credit-notes')}>Back to credit notes</Button>} />
      </DeskShell>
    );
  }
  if (!cn) return <DeskShell title="Credit note" breadcrumb="Finance / Credit notes"><EmptyState title="Loading…" /></DeskShell>;

  const st = String(cn.status || '').toLowerCase();
  const isMaker = Number(cn.created_by) > 0 && Number(cn.created_by) === me;
  const canAct = canApprove && st === 'pending' && !isMaker;
  const pickedAmount = lines.filter((l) => picked.has(l._key)).reduce((a, l) => a + Number(l.amount || 0), 0);

  const approve = async (selectedOnly) => {
    setBusy('approve');
    try {
      const body = selectedOnly ? { line_keys: [...picked] } : {};
      const { data: d } = await approveCreditNote(cn.credit_note_id, body);
      const num = d.credit_note?.credit_note_number || cn.credit_note_number;
      toast.success(d.applied ? `${num} approved and taken off the draft invoice` : `${num} approved — it comes off the customer's next draft invoice`);
      if (d.credit_note && Number(d.credit_note.credit_note_id) !== Number(cn.credit_note_id)) {
        navigate(`/carret/money/credit-notes/${d.credit_note.credit_note_id}`);
      } else {
        load();
      }
    } catch (e) {
      toast.error(errMsg(e, 'Approve failed'));
    } finally {
      setBusy('');
    }
  };

  const pdf = async () => {
    setBusy('pdf');
    try {
      const { data: blob } = await creditNotePdf(cn.credit_note_id);
      saveBlob(blob, `${cn.credit_note_number}.pdf`.replace(/\//g, '-'), 'application/pdf');
    } catch (e) {
      toast.error(await blobErrMsg(e, 'The PDF includes approved notes only'));
    } finally {
      setBusy('');
    }
  };

  const toggle = (k) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const lineCols = [
    ...(canAct ? [{
      key: 'pick',
      header: '',
      width: '36px',
      render: (l) => <input type="checkbox" aria-label={`Select ${l.ttspl_id || l._key}`} checked={picked.has(l._key)} onChange={() => toggle(l._key)} />,
    }] : []),
    { key: 't', header: 'Laptop', render: (l) => l.ttspl_id || '—', sub: (l) => (l.serial_number ? `SN ${l.serial_number}` : null) },
    { key: 'i', header: 'Item', render: (l) => [l.brand, l.model].filter(Boolean).join(' ') || '—', sub: (l) => l.return_dc_number || l.service_dc_number || null },
    { key: 'p', header: 'Credited days', render: (l) => <span><DateTime value={l.from_date || l.rent_start} /> – <DateTime value={l.to_date || l.rent_end} /></span>, sub: (l) => (l.days_in_month ? `${l.days_in_month} day(s)` : null) },
    { key: 'a', header: 'Amount', numeric: true, render: (l) => <Money value={l.amount} /> },
  ];

  return (
    <DeskShell title={cn.credit_note_number} breadcrumb="Finance / Credit notes">
      <div className="c-stack">
        <DocumentHeader
          docNumber={cn.credit_note_number}
          type={`Credit note · ${cn.credit_note_type || 'other'}`}
          actions={(
            <>
              <MoneyChip status={cn.status} />
              {canAct && lines.length > 1 && picked.size > 0 && (
                <Button variant="primary" disabled={busy === 'approve'} onClick={() => approve(true)}>Approve {picked.size} laptop(s)</Button>
              )}
              {canAct && <Button variant={picked.size ? 'secondary' : 'primary'} disabled={busy === 'approve'} onClick={() => approve(false)}>Approve all</Button>}
              {(st === 'approved' || st === 'applied') && <Button variant="quiet" disabled={busy === 'pdf'} onClick={pdf}>PDF</Button>}
              {canApprove && st !== 'cancelled' && <Button variant="quiet" onClick={() => setCancelOpen(true)}>Cancel</Button>}
            </>
          )}
          meta={[
            { label: 'Customer', value: <Link to={`/carret/sell/customers/${cn.customer_id}`}>{cn.customer_name || `#${cn.customer_id}`}</Link> },
            { label: 'Invoice', value: cn.invoice_number ? <Link to={`/carret/money/invoices/${cn.applied_in_invoice_id || cn.invoice_id}`}><DocNumber value={cn.invoice_number} /></Link> : '—' },
            { label: 'Reason', value: cn.reason },
            { label: 'Raised', value: <DateTime value={cn.created_at} /> },
            { label: 'Approved', value: cn.approved_at ? <DateTime value={cn.approved_at} /> : (st === 'pending' ? 'awaiting' : '—') },
            cn.return_dc_number ? { label: 'Return DC', value: <DocNumber value={cn.return_dc_number} /> } : null,
          ].filter(Boolean)}
        />

        {isMaker && st === 'pending' && (
          <Notice tone="info">You raised this credit note, so someone else approves it (maker-checker).</Notice>
        )}
        {st === 'approved' && (
          <Notice tone="info">Approved and waiting: it comes off the customer&apos;s next draft invoice that can absorb it in full.</Notice>
        )}
        {st === 'cancelled' && (
          <Notice tone="warn" title="Cancelled"><DateTime value={cn.cancelled_at} /> — {cn.cancellation_reason || 'no reason recorded'}</Notice>
        )}
        {cn.description && <Notice tone="info" title="Description">{cn.description}</Notice>}

        <Tiles>
          <StatTile label="Amount" value={<Money value={cn.amount} />} />
          <StatTile label="Laptops" value={lines.length} />
          {canAct && lines.length > 1 && <StatTile label="Ticked" value={picked.size} delta={<Money value={pickedAmount} />} />}
        </Tiles>

        <Section title="Laptops credited">
          <DataTable columns={lineCols} rows={lines} rowKey={(l) => l._key} empty={<EmptyState title="No laptop lines" body="A manual credit note carries an amount, not laptops." />} />
        </Section>

        {related.length > 0 && (
          <Section title="Other notes for the same return and month">
            <DataTable
              columns={[
                { key: 'n', header: 'Credit note', render: (n) => <DocNumber value={n.credit_note_number} /> },
                { key: 's', header: 'Status', render: (n) => <MoneyChip status={n.status} /> },
                { key: 'l', header: 'Laptops', numeric: true, render: (n) => n.laptop_count },
                { key: 'a', header: 'Amount', numeric: true, render: (n) => <Money value={n.amount} /> },
              ]}
              rows={related}
              rowKey={(n) => n.credit_note_id}
              onRowClick={(n) => navigate(`/carret/money/credit-notes/${n.credit_note_id}`)}
            />
          </Section>
        )}
      </div>

      <CancelCreditNoteDrawer note={cn} open={cancelOpen} onClose={() => setCancelOpen(false)} onDone={load} />
    </DeskShell>
  );
}
