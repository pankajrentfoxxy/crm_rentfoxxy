import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DocNumber, EmptyState, Field, FormGrid, Input, Money, Notice, Section, Select, StatusChip, Textarea,
} from '../../../components/carret';
import {
  createVendorReturnTicket, fetchVendorReturnTicketEligible, fetchVendorReturnTicketEligibleVendors,
} from '../../vendor-management/vendorManagementApi';
import { errMsg } from './procureShared';
import {
  MAX_DAYS_AHEAD, RETURN_REASONS, addDays, laptopLine, prettyDate, specLine, todayIst, validateRequestFields,
} from './returnRequestShared';

/**
 * Procure → Vendor returns → New return request (D10).
 *
 * Vendor → its rented laptops sitting with us → why, the date rent stops
 * (today or later) and the pickup slot → saved as a draft, then the record
 * shows the mail and PDF before anything goes to the vendor.
 */
export default function ReturnRequestFormPage() {
  const navigate = useNavigate();
  const today = todayIst();
  const [vendors, setVendors] = useState(null);
  const [vendorId, setVendorId] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState({});
  const [f, setF] = useState({ reason_code: '', return_reason: '', rent_stop_date: today, pickup_date: '', pickup_time: '11:00', remarks: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    fetchVendorReturnTicketEligibleVendors()
      .then(({ data }) => setVendors(data.data || []))
      .catch((e) => { setVendors([]); toast.error(errMsg(e, 'Could not load vendors')); });
  }, []);

  useEffect(() => {
    setPicked({});
    if (!vendorId) { setRows(null); return undefined; }
    setRows(null);
    const t = setTimeout(() => {
      fetchVendorReturnTicketEligible({ vendor_id: vendorId, search: search || undefined, limit: 200 })
        .then(({ data }) => setRows(data.data || []))
        .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load laptops')); });
    }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [vendorId, search]);

  const pickedRows = Object.values(picked);
  const rent = pickedRows.reduce((n, r) => n + (Number(r.monthly_rent_rate) || 0), 0);
  const vendor = (vendors || []).find((v) => String(v.vendor_id) === String(vendorId));

  const toggle = (r) => setPicked((p) => {
    const n = { ...p };
    if (n[r.serial_id]) delete n[r.serial_id]; else n[r.serial_id] = r;
    return n;
  });
  const allPicked = rows && rows.length > 0 && rows.every((r) => picked[r.serial_id]);

  const columns = useMemo(() => [
    { key: 'x', header: '', width: '2.5rem', render: (r) => <input type="checkbox" aria-label={`Pick ${r.ttspl_id}`} checked={Boolean(picked[r.serial_id])} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} /> },
    { key: 't', header: 'Asset', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => r.serial_number },
    { key: 'l', header: 'Laptop', render: laptopLine, sub: specLine },
    { key: 's', header: 'With us as', render: (r) => <StatusChip status={r.inventory_status} label={{ in_stock: 'In stock', returned: 'Back from customer', qc_failed: 'QC failed' }[r.inventory_status]} /> },
    { key: 'p', header: 'PO', render: (r) => r.po_number },
    { key: 'r', header: 'Rent / month', numeric: true, render: (r) => <Money value={r.monthly_rent_rate} showZero={false} /> },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [picked]);

  const save = async () => {
    if (!vendorId) { toast.error('Choose the vendor'); return; }
    if (!pickedRows.length) { toast.error('Pick the laptops going back'); return; }
    const err = validateRequestFields(f);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const { data } = await createVendorReturnTicket({
        vendor_id: Number(vendorId),
        serial_ids: pickedRows.map((r) => r.serial_id),
        reason_code: f.reason_code,
        return_reason: f.reason_code === 'other' ? f.return_reason.trim() : undefined,
        rent_stop_date: f.rent_stop_date,
        pickup_date: f.pickup_date,
        pickup_time: f.pickup_time,
        remarks: f.remarks.trim() || undefined,
      });
      toast.success(`${data.ticket.ticket_number} saved — check the mail, then send it`);
      navigate(`/carret/procure/return-requests/${encodeURIComponent(data.ticket.ticket_number)}`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not save the request'));
      setBusy(false);
    }
  };

  return (
    <DeskShell title="New return request" breadcrumb="Procure / Vendor returns" subtitle="Tell a vendor we are returning rented laptops, and from when rent stops.">
      <div className="c-stack">
        <Section title="1 · Vendor">
          {vendors === null ? <EmptyState title="Loading…" /> : (
            vendors.length === 0
              ? <EmptyState title="No rented laptops to return" body="Only laptops on a rental PO, sitting in our warehouse with rent still running, can go on a request." />
              : (
                <Field label="Vendor" required hint="Only vendors with rented laptops in our warehouse are listed.">
                  <Select
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                    placeholder="Choose…"
                    options={vendors.map((v) => ({ value: String(v.vendor_id), label: `${v.business_name || v.first_name || `#${v.vendor_id}`} — ${v.inward_count} laptop(s)${v.email ? '' : ' · no email on file'}` }))}
                  />
                </Field>
              )
          )}
          {vendor && !vendor.email && <Notice tone="crit" title="This vendor has no email address">Add one on the vendor record — the request can’t be sent without it.</Notice>}
        </Section>

        {vendorId && (
          <Section
            title={`2 · Laptops going back${pickedRows.length ? ` · ${pickedRows.length} picked` : ''}`}
            actions={(
              <>
                <Input type="search" placeholder="TTSPL or serial" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '14rem' }} aria-label="Search laptops" />
                {rows && rows.length > 0 && (
                  <Button variant="quiet" onClick={() => setPicked(allPicked ? {} : Object.fromEntries(rows.map((r) => [r.serial_id, r])))}>
                    {allPicked ? 'Clear' : 'Pick all'}
                  </Button>
                )}
              </>
            )}
          >
            {rows === null ? <EmptyState title="Loading…" /> : (
              <DataTable columns={columns} rows={rows} rowKey={(r) => r.serial_id} onRowClick={toggle} empty={<EmptyState title="No laptops found" />} />
            )}
          </Section>
        )}

        {vendorId && (
          <Section title="3 · Reason, rent stop and pickup">
            <FormGrid cols={3}>
              <Field label="Why they go back" required hint="Worded into the mail to the vendor.">
                <Select value={f.reason_code} onChange={set('reason_code')} placeholder="Choose…" options={RETURN_REASONS} />
              </Field>
              <Field label="Rent stops from" required hint={f.rent_stop_date ? `Rent is billed up to ${prettyDate(addDays(f.rent_stop_date, -1))}.` : `Today or up to ${MAX_DAYS_AHEAD} days ahead.`}>
                <Input type="date" min={today} max={addDays(today, MAX_DAYS_AHEAD)} value={f.rent_stop_date} onChange={set('rent_stop_date')} />
              </Field>
              <Field label="Pickup on" required hint="When the vendor can collect from our warehouse.">
                <div className="flex" style={{ gap: '8px' }}>
                  <Input type="date" min={today} value={f.pickup_date} onChange={set('pickup_date')} aria-label="Pickup date" />
                  <Input type="time" value={f.pickup_time} onChange={set('pickup_time')} aria-label="Pickup time" style={{ width: '8rem' }} />
                </div>
              </Field>
              {f.reason_code === 'other' && (
                <Field label="The reason" required span={3}><Input value={f.return_reason} onChange={set('return_reason')} maxLength={300} /></Field>
              )}
              <Field label="Note for the vendor (optional)" span={3} hint="Printed in the mail and on the PDF.">
                <Textarea rows={2} value={f.remarks} onChange={set('remarks')} maxLength={1000} />
              </Field>
            </FormGrid>
          </Section>
        )}
      </div>

      {vendorId && (
        <div className="c-card" style={{ position: 'sticky', bottom: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
          <strong>{pickedRows.length} laptop(s)</strong>
          {rent > 0 && <span className="text-ink-3">rent <Money value={rent} /> / month stops from {prettyDate(f.rent_stop_date)}</span>}
          <span style={{ marginLeft: 'auto' }} />
          <Button variant="quiet" onClick={() => navigate('/carret/procure/returns')}>Cancel</Button>
          <Button variant="primary" disabled={busy || !pickedRows.length} onClick={save}>{busy ? 'Saving…' : 'Save and preview the mail'}</Button>
        </div>
      )}
    </DeskShell>
  );
}
