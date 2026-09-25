import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, ConfirmDialog, DataTable, DocNumber, Drawer, EmptyState, Field, FormGrid, Input,
  Notice, Section, Select, StatusChip, Textarea,
} from '../../../components/carret';
import {
  attachSoSerial, bulkUpdateSoSerialAddresses, detachSoSerial, getAvailableSerials, listSoSerials,
  updateSoSerialAddress,
} from '../../sales-pipeline/salesPipelineApi';
import { assignTicket, getTeamMembers, logTicketNote, updateTicket } from '../../floor-pipeline/floorPipelineApi';
import { usePermission } from '../../../hooks/usePermission';
import { AddressFields, AddressText, validateAddress } from './CustomerAddresses';
import { configText } from './LineItemsEditor';
import { SO_SECTIONS, parseJson } from './sellShared';

/**
 * Sales order → Laptops & Dispatch QC.
 *
 * Attaching a laptop reserves it and opens its Dispatch QC ticket; only a
 * QC-passed laptop can go on a challan. So this panel is where an order
 * becomes shippable, and it says, per line, exactly what is still missing.
 *
 * Scanning is first-class: the attach endpoint accepts a TTSPL code or serial,
 * so a laptop in hand can be attached without searching a list.
 */
const SERIAL_EDIT_SECTIONS = [...SO_SECTIONS, 'delivery_challans', 'replacement_so_laptop_qc', 'so_laptop_qc'];

const qcChip = (a) => {
  const s = String(a.qc_status || 'pending').toLowerCase();
  if (s === 'passed') return <StatusChip status="approved" title="Dispatch QC passed" />;
  if (s === 'failed') return <StatusChip status="rejected" title="Dispatch QC failed" />;
  return <StatusChip status="pending" title="Dispatch QC not finished" />;
};

const toStored = (a, extra = {}) => ({
  name: a.name, phone: a.phone, address: a.address, city: a.city, state: a.state,
  pincode: a.zip_code || a.pincode, landmark: a.landmark || '', ...extra,
});
const fromStored = (a) => (a ? { ...a, zip_code: a.zip_code || a.pincode || '' } : null);

export default function SoLaptopsPanel({ soNumber, billing, cancelled, inPlace, onChanged }) {
  const { hasPermission, user } = usePermission();
  const canEdit = SERIAL_EDIT_SECTIONS.some((s) => hasPermission(s, 'edit'));
  const isSuper = user?.role === 'super_admin';

  const [data, setData] = useState({ loading: true, error: null, lines: [], summary: null });
  const [attachLine, setAttachLine] = useState(null);
  const [assign, setAssign] = useState(null);
  const [addrFor, setAddrFor] = useState(null);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(() => {
    listSoSerials(soNumber)
      .then(({ data: d }) => setData({ loading: false, error: null, lines: d?.lines || [], summary: d?.summary || null }))
      .catch((e) => setData({ loading: false, error: e?.response?.data?.message || 'Could not load the laptops.', lines: [], summary: null }));
  }, [soNumber]);
  useEffect(() => { load(); }, [load]);

  const refresh = () => { load(); onChanged?.(); };

  const s = data.summary || {};
  const openAllocs = data.lines.flatMap((l) => (l.allocations || []).filter((a) => !a.dc_number && a.status !== 'dispatched'));

  const sameForAll = async () => {
    if (!billing) { toast.error('The order has no billing address to copy.'); return; }
    try {
      await bulkUpdateSoSerialAddresses(soNumber, {
        addresses: openAllocs.map((a) => ({ allocation_id: a.allocation_id, delivery_address: toStored(billing), is_wfh: false })),
      });
      toast.success('Every laptop not yet on a challan now ships to the billing address');
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not update the addresses.');
    }
  };

  const doRemove = async () => {
    const a = removing;
    try {
      await detachSoSerial(soNumber, a.allocation_id);
      toast.success(`${a.ttspl_id || a.serial_number} removed and back in stock`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not remove the laptop.');
    }
  };

  let banner = null;
  if (inPlace) {
    banner = <Notice tone="info" title="Sale in place">These laptops are already with the customer. No Dispatch QC and no challan: confirm the sale from the order header.</Notice>;
  } else if (s.ready_for_dc) {
    banner = <Notice tone="good" title="Every laptop is attached and has passed Dispatch QC">Ready for a delivery challan.</Notice>;
  } else if (s.total_ordered) {
    const bits = [
      `${s.total_attached || 0} of ${s.total_ordered} attached`,
      `${s.passed || 0} passed QC`,
      s.pending ? `${s.pending} waiting for QC` : null,
      s.failed ? `${s.failed} failed QC` : null,
    ].filter(Boolean).join(' · ');
    banner = (
      <Notice tone={s.failed ? 'serious' : 'info'} title={bits}>
        {(s.passed || 0) > 0 ? 'QC-passed laptops can go on a challan now; the rest can follow on another challan.' : 'A challan needs at least one laptop that has passed Dispatch QC.'}
      </Notice>
    );
  }

  if (data.loading) return <EmptyState title="Loading laptops…" />;
  if (data.error) return <EmptyState title="Could not load the laptops" body={data.error} />;

  return (
    <div className="c-stack">
      {banner}
      {canEdit && !cancelled && openAllocs.length > 1 && (
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Button onClick={sameForAll}>Ship every laptop to the billing address</Button>
          <span className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
            Or set each laptop’s address below. One challan is made per address.
          </span>
        </div>
      )}

      {data.lines.map((line) => {
        const allocs = line.allocations || [];
        const cols = [
          {
            key: 'ttspl', header: 'Laptop',
            render: (a) => (
              <Link to={`/carret/stock/assets/${encodeURIComponent(a.ttspl_id || a.serial_number)}`} onClick={(e) => e.stopPropagation()}>
                <DocNumber value={a.ttspl_id || a.serial_number} />
              </Link>
            ),
            sub: (a) => [a.serial_number, configText({ brand: a.serial_brand, model_name: a.serial_model, processor: a.serial_processor, generation: a.serial_generation, ram: a.serial_ram, storage: a.serial_storage })].filter(Boolean).join(' · '),
          },
          {
            key: 'qc', header: 'Dispatch QC',
            render: (a) => (
              <span className="flex items-center flex-wrap" style={{ gap: '6px' }}>
                {qcChip(a)}
                {a.qc_ticket_id && (
                  <Link to={`/floor-pipeline/tickets/${a.qc_ticket_id}`} className="font-ui" style={{ fontSize: 'var(--d-sm)' }}>
                    Ticket #{a.qc_ticket_id}
                  </Link>
                )}
                {a.qc_ticket_id && canEdit && String(a.qc_status || 'pending') === 'pending' && (
                  <Button variant="quiet" onClick={() => setAssign({ ticket_id: a.qc_ticket_id, ttspl: a.ttspl_id || a.serial_number })}>Assign</Button>
                )}
              </span>
            ),
            sub: (a) => a.ticket_stage || null,
          },
          {
            key: 'addr', header: 'Ships to',
            render: (a) => {
              const d = parseJson(a.delivery_address);
              return d?.address ? `${d.name || ''}${d.city ? `, ${d.city}` : ''}${a.is_wfh ? ' · WFH' : ''}` : <span className="text-ink-3">Order address</span>;
            },
          },
          {
            key: 'dc', header: 'Challan',
            render: (a) => (a.dc_number
              ? <Link to={`/carret/move/challans/${encodeURIComponent(a.dc_number)}`}><DocNumber value={a.dc_number} /></Link>
              : <span className="text-ink-3">—</span>),
          },
          {
            key: 'act', header: '', align: 'right',
            render: (a) => {
              const onDc = a.dc_number || a.status === 'dispatched';
              if (!canEdit || cancelled || onDc) return null;
              const passed = String(a.qc_status) === 'passed';
              return (
                <span className="flex justify-end" style={{ gap: '4px' }}>
                  <Button variant="quiet" onClick={() => setAddrFor(a)}>Address</Button>
                  {(!passed || isSuper) && <Button variant="quiet" onClick={() => setRemoving(a)}>Remove</Button>}
                </span>
              );
            },
          },
        ];

        return (
          <Section
            key={line.line_id}
            title={`${configText(line) || 'Laptop'} — ${line.attached_count || allocs.length} of ${line.ordered_qty} attached`}
            actions={canEdit && !cancelled && line.remaining_qty > 0 && (
              <Button variant="primary" onClick={() => setAttachLine(line)}>Attach laptop ({line.remaining_qty} left)</Button>
            )}
          >
            {allocs.length
              ? <DataTable columns={cols} rows={allocs} rowKey={(a) => a.allocation_id} />
              : <p className="font-ui text-ink-3 m-0">No laptop attached to this line yet.</p>}
          </Section>
        );
      })}

      <AttachDrawer
        soNumber={soNumber}
        line={attachLine}
        onClose={() => setAttachLine(null)}
        onAttached={(res) => {
          refresh();
          if (res?.qc_ticket?.ticket_id || res?.qc_ticket_id) {
            setAssign({ ticket_id: res.qc_ticket?.ticket_id || res.qc_ticket_id, ttspl: res.serial?.ttspl_id || res.serial?.serial_number });
          }
        }}
      />
      <AssignQcDrawer ticket={assign} onClose={() => setAssign(null)} onDone={refresh} />
      <AddressDrawer alloc={addrFor} billing={billing} onClose={() => setAddrFor(null)} onSaved={refresh} />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={doRemove}
        title={`Remove ${removing?.ttspl_id || removing?.serial_number || 'this laptop'}?`}
        body="It goes back to stock and its Dispatch QC ticket is cancelled."
        confirmLabel="Remove"
      />
    </div>
  );
}

/** Attach: scan a code, or pick from the stock that matches this line. */
function AttachDrawer({ soNumber, line, onClose, onAttached }) {
  const [code, setCode] = useState('');
  const [search, setSearch] = useState('');
  const [stock, setStock] = useState({ loading: false, rows: [], error: null });
  const [busy, setBusy] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!line) return;
    setCode(''); setSearch('');
    setStock({ loading: true, rows: [], error: null });
    getAvailableSerials({ processor: line.processor, generation: line.generation, ram: line.ram, storage: line.storage, quotation_type: line.quotation_type })
      .then(({ data }) => setStock({ loading: false, rows: data?.serials || data?.data || [], error: null }))
      .catch((e) => setStock({ loading: false, rows: [], error: e?.response?.data?.message || 'Could not load matching stock.' }));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [line]);

  const attach = async (body, key) => {
    setBusy(key);
    try {
      const { data } = await attachSoSerial(soNumber, { ...body, line_id: line.line_id });
      toast.success(`${data?.serial?.ttspl_id || data?.serial?.serial_number || 'Laptop'} attached — Dispatch QC ticket opened`);
      onAttached?.(data);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not attach that laptop.');
    } finally {
      setBusy('');
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stock.rows;
    return stock.rows.filter((r) => [r.unique_product_serial, r.inventory_asset_code, r.serial_number, r.brand, r.model, r.label]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [stock.rows, search]);

  return (
    <Drawer open={Boolean(line)} onClose={onClose} title="Attach a laptop" width="40rem">
      {line && (
        <div className="c-stack">
          <Notice tone="info" title={configText(line)}>
            Matched on processor, generation, RAM and storage. Units reserved on another order, or on a vendor return, are not offered.
          </Notice>
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) attach({ ttspl_id: code.trim() }, 'scan'); }}>
            <Field label="Scan or type a TTSPL code or serial number">
              <div className="flex" style={{ gap: '8px' }}>
                <Input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" placeholder="TTSPL…" autoComplete="off" />
                <Button variant="primary" type="submit" disabled={!code.trim() || busy === 'scan'}>{busy === 'scan' ? 'Attaching…' : 'Attach'}</Button>
              </div>
            </Field>
          </form>
          <div className="c-card">
            <div className="c-toolbar">
              <label className="c-search">
                <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter the matching stock" />
              </label>
              <div className="c-toolbar-end">{stock.loading ? 'Loading…' : `${rows.length} matching`}</div>
            </div>
            {stock.error && <EmptyState title="Could not load stock" body={stock.error} />}
            {!stock.loading && !stock.error && (
              <DataTable
                rows={rows}
                rowKey={(r) => r.serial_id}
                columns={[
                  { key: 'id', header: 'Laptop', render: (r) => <DocNumber value={r.unique_product_serial || r.inventory_asset_code || r.serial_number} />, sub: (r) => [r.serial_number, [r.brand, r.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') },
                  { key: 'cfg', header: 'Config', render: (r) => [r.processor, r.generation, r.ram, r.storage].filter(Boolean).join(' · ') },
                  { key: 'a', header: '', align: 'right', render: (r) => <Button onClick={() => attach({ serial_id: r.serial_id }, r.serial_id)} disabled={Boolean(busy)}>{busy === r.serial_id ? '…' : 'Attach'}</Button> },
                ]}
                empty={<EmptyState title="No matching laptop in stock" body="Units already reserved on another order or waiting on a challan are not shown. Scan a code above if you have the laptop in hand." />}
              />
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** Give the new Dispatch QC ticket to someone on the Dispatch QC team. */
function AssignQcDrawer({ ticket, onClose, onDone }) {
  const [members, setMembers] = useState([]);
  const [who, setWho] = useState('');
  const [priority, setPriority] = useState('high');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ticket) return;
    setWho(''); setPriority('high'); setNotes('');
    getTeamMembers('Dispatch QC Team')
      .then(({ data }) => {
        const list = data?.members || [];
        setMembers(list);
        if (list.length) {
          const best = list.reduce((b, m) => ((m.active_tickets ?? 0) < (b.active_tickets ?? 0) ? m : b));
          setWho(String(best.user_id));
        }
      })
      .catch(() => setMembers([]));
  }, [ticket]);

  const save = async () => {
    if (!who) { toast.error('Choose who does the Dispatch QC'); return; }
    setBusy(true);
    try {
      await assignTicket(ticket.ticket_id, { user_id: Number(who) });
      if (priority !== 'high') await updateTicket(ticket.ticket_id, { priority });
      if (notes.trim()) await logTicketNote(ticket.ticket_id, { notes: notes.trim() });
      toast.success(`Dispatch QC for ${ticket.ttspl || `ticket #${ticket.ticket_id}`} assigned`);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not assign the ticket.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={Boolean(ticket)}
      onClose={onClose}
      title="Assign Dispatch QC"
      footer={(
        <div className="flex justify-end" style={{ gap: '8px' }}>
          <Button variant="quiet" onClick={onClose}>Later</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Assigning…' : 'Assign'}</Button>
        </div>
      )}
    >
      {ticket && (
        <FormGrid cols={1}>
          <Notice tone="info" title={`Ticket #${ticket.ticket_id}${ticket.ttspl ? ` · ${ticket.ttspl}` : ''}`}>
            The laptop cannot go on a challan until this check passes. Choosing Later leaves it unassigned on the floor.
          </Notice>
          <Field label="Assign to" hint="The person with the fewest open tickets is picked for you.">
            <Select
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder={members.length ? 'Choose' : 'No one on the Dispatch QC team'}
              options={members.map((m) => ({ value: String(m.user_id), label: `${m.name}${m.active_tickets != null ? ` — ${m.active_tickets} open` : ''}` }))}
            />
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)} options={['low', 'normal', 'high', 'urgent'].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
          </Field>
          <Field label="Note"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </FormGrid>
      )}
    </Drawer>
  );
}

/** Where one laptop ships. Drives how challans are split. */
function AddressDrawer({ alloc, billing, onClose, onSaved }) {
  const [addr, setAddr] = useState(null);
  const [wfh, setWfh] = useState({ on: false, name: '', phone: '' });
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!alloc) return;
    const d = parseJson(alloc.delivery_address);
    setAddr(fromStored(d) || fromStored(billing) || null);
    setWfh({ on: Boolean(alloc.is_wfh), name: d?.employee_name || '', phone: d?.employee_phone || '' });
    setNotes(alloc.delivery_notes || '');
    setErrors({});
  }, [alloc, billing]);

  const save = async () => {
    const e = validateAddress(addr);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await updateSoSerialAddress(alloc.allocation_id, {
        delivery_address: toStored(addr, wfh.on ? { employee_name: wfh.name, employee_phone: wfh.phone } : {}),
        is_wfh: wfh.on,
        delivery_notes: notes,
      });
      toast.success('Address saved');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save the address.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={Boolean(alloc)}
      onClose={onClose}
      title={`Ship ${alloc?.ttspl_id || alloc?.serial_number || 'laptop'} to`}
      width="40rem"
      footer={(
        <div className="flex justify-end" style={{ gap: '8px' }}>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save address'}</Button>
        </div>
      )}
    >
      <div className="c-stack">
        {billing && (
          <div className="flex items-start" style={{ gap: '12px' }}>
            <div style={{ flex: 1 }}><AddressText address={billing} /></div>
            <Button onClick={() => setAddr(fromStored(billing))}>Use billing address</Button>
          </div>
        )}
        <AddressFields value={addr} onChange={setAddr} errors={errors} />
        <Checkbox label="Work-from-home delivery to an employee" checked={wfh.on} onChange={(e) => setWfh((w) => ({ ...w, on: e.target.checked }))} />
        {wfh.on && (
          <FormGrid cols={2}>
            <Field label="Employee name"><Input value={wfh.name} onChange={(e) => setWfh((w) => ({ ...w, name: e.target.value }))} /></Field>
            <Field label="Employee phone"><Input value={wfh.phone} onChange={(e) => setWfh((w) => ({ ...w, phone: e.target.value }))} /></Field>
          </FormGrid>
        )}
        <Field label="Delivery notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}
