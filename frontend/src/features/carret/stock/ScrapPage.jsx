import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, Money, Notice, Segmented, StatusChip, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  PART_UNITS_VIEW_SECTIONS, cancelScrap, createScrapChallan, decideScrap, downloadScrapChallanPdf, errMsg, fetchDiscardedParts, fetchScrapChallans,
  fetchScrapRequests, fetchScrappedAwaitingChallan,
} from './stockApi';
import { laptopSub } from './laptopSub';

/**
 * Stock → Scrap (claude/carret-stock.md, ST-D2).
 *   Requests — a laptop someone asked to scrap; a manager (scrap_approval) who
 *     did not ask approves or rejects.
 *   To hand over — approved (scrapped) laptops not yet on a scrap challan:
 *     pick them, enter what the buyer pays for each, raise the challan.
 *   Challans — every scrap challan (laptops and parts): search, status, dates;
 *     dispatch, e-sign, e-way, cancel and PDF are on the Carret challan record
 *     (/carret/stock/scrap/challans/:no — replaces the old Scrap Challans screens).
 *   Discarded parts — catalogue parts marked discarded (PRT units) not yet on
 *     a scrap challan (replaces the old /inventory-management/discarded-parts):
 *     pick them, enter what the buyer pays, raise the challan. Laptops and
 *     parts picked on both tabs go on one challan (same API, POST
 *     /scrap-challans/create with serial_ids + instance_ids).
 * Dead parts with no CRM record (DP numbers) go out on a Part DC from
 * Movement → Dead parts — in & out, not here.
 */
const WAREHOUSE_ROLES = ['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead', 'procurement'];
const REQ_LABEL = { pending: 'Waiting for approval', approved: 'Approved — scrapped', rejected: 'Rejected', cancelled: 'Withdrawn' };

export default function ScrapPage() {
  const { hasPermission, user } = usePermission();
  const canApprove = hasPermission('scrap_approval', 'edit');
  const canChallan = WAREHOUSE_ROLES.includes(user?.role) || hasPermission('scrap_challans', 'edit');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canSeeParts = PART_UNITS_VIEW_SECTIONS.some((sec) => hasPermission(sec, 'view'));
  const tab = ['requests', 'handover', 'challans', ...(canSeeParts ? ['parts'] : [])].includes(params.get('tab')) ? params.get('tab') : 'requests';
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const [cf, setCf] = useState({ search: '', status: '', from: '', to: '' });
  const [partSearch, setPartSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [reqStatus, setReqStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [decide, setDecide] = useState(null);
  const [picked, setPicked] = useState({});
  const [values, setValues] = useState({});
  const [challan, setChallan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pdfFor, setPdfFor] = useState('');

  const load = useCallback(() => {
    setRows(null);
    let req;
    if (tab === 'requests') req = fetchScrapRequests(reqStatus);
    else if (tab === 'handover') req = fetchScrappedAwaitingChallan();
    else if (tab === 'parts') req = fetchDiscardedParts(partSearch.trim());
    else {
      req = fetchScrapChallans({
        limit: 50, page, search: cf.search.trim() || undefined, status: cf.status || undefined, date_from: cf.from || undefined, date_to: cf.to || undefined,
      });
    }
    req.then(({ data }) => { setRows(data.data || data.units || []); setPages(data.pagination?.totalPages || 1); }).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [tab, reqStatus, page, cf, partSearch]);
  // Picks (laptops and parts) survive switching tabs so one challan can carry both.
  useEffect(() => {
    const typing = (tab === 'challans' && cf.search) || (tab === 'parts' && partSearch);
    const t = setTimeout(load, typing ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, tab, cf.search, partSearch]);
  useEffect(() => { setPage(1); }, [cf]);

  const submitDecision = async () => {
    setBusy(true);
    try {
      const { data } = await decideScrap(decide.row.id, decide.approve, decide.note);
      toast.success(data.message);
      setDecide(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const withdraw = async (r) => {
    try { await cancelScrap(r.id); toast.success('Withdrawn'); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  // picked: `laptop:<serial_id>` / `part:<instance_id>` → row; values use the same keys.
  const pickKey = (kind, r) => (kind === 'laptop' ? `laptop:${r.serial_id}` : `part:${r.instance_id}`);
  const togglePick = (kind, r) => setPicked((p) => {
    const k = pickKey(kind, r);
    const n = { ...p };
    if (n[k]) delete n[k]; else n[k] = r;
    return n;
  });
  const pickedKeys = Object.keys(picked);
  const chosenLaptops = pickedKeys.filter((k) => k.startsWith('laptop:')).map((k) => picked[k]);
  const chosenParts = pickedKeys.filter((k) => k.startsWith('part:')).map((k) => picked[k]);
  const chosenCount = pickedKeys.length;
  const saleTotal = pickedKeys.reduce((s, k) => s + (Number(values[k]) || 0), 0);
  const pickedLabel = [
    chosenLaptops.length ? `${chosenLaptops.length} laptop${chosenLaptops.length === 1 ? '' : 's'}` : null,
    chosenParts.length ? `${chosenParts.length} part${chosenParts.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' + ');
  const submitChallan = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saleValues = Object.fromEntries(pickedKeys.filter((k) => values[k] !== undefined && values[k] !== '').map((k) => [k, values[k]]));
      const itemRemarks = Object.fromEntries(chosenParts.filter((u) => u.notes).map((u) => [u.instance_id, u.notes]));
      const { data } = await createScrapChallan({
        serial_ids: chosenLaptops.map((r) => r.serial_id),
        instance_ids: chosenParts.map((u) => u.instance_id),
        item_remarks: itemRemarks,
        sale_values: saleValues,
        recipient_name: challan.name,
        recipient_address: challan.address,
        contact_person: challan.contact,
        contact_mobile: challan.mobile,
        billing_address: challan.billing,
        remarks: challan.remarks,
      });
      toast.success(`Scrap challan ${data.challan_number} raised — dispatch it from the challan page`);
      setChallan(null);
      setPicked({});
      setValues({});
      navigate(`/carret/stock/scrap/challans/${encodeURIComponent(data.challan_number)}`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const reqCols = [
    { key: 't', header: 'Laptop', render: (r) => <Link to={`/carret/stock/assets/${encodeURIComponent(r.asset_code || '')}`}><DocNumber value={r.asset_code} /></Link>, sub: (r) => r.model_name },
    { key: 'r', header: 'Why', render: (r) => r.reason, sub: (r) => `was ${String(r.from_status || '').replace(/_/g, ' ')}` },
    { key: 'b', header: 'Asked by', render: (r) => r.requested_by_name || '—', sub: (r) => <DateTime value={r.created_at} /> },
    { key: 's', header: 'Status', render: (r) => REQ_LABEL[r.status] || r.status, sub: (r) => (r.decided_by_name ? `${r.decided_by_name}${r.decision_note ? ` — ${r.decision_note}` : ''}` : null) },
    {
      key: 'x',
      header: '',
      render: (r) => (r.status === 'pending' ? (
        <div className="flex" style={{ gap: '6px', justifyContent: 'flex-end' }}>
          {canApprove && Number(r.requested_by) !== Number(user?.user_id) && <Button variant="primary" onClick={() => setDecide({ row: r, approve: true, note: '' })}>Approve</Button>}
          {canApprove && <Button variant="quiet" onClick={() => setDecide({ row: r, approve: false, note: '' })}>Reject</Button>}
          {Number(r.requested_by) === Number(user?.user_id) && <Button variant="quiet" onClick={() => withdraw(r)}>Withdraw</Button>}
        </div>
      ) : null),
    },
  ];
  const handoverCols = [
    ...(canChallan ? [{ key: 'x', header: '', width: '2.5rem', render: (r) => <input type="checkbox" aria-label={`Pick ${r.ttspl_id}`} checked={Boolean(picked[pickKey('laptop', r)])} onChange={() => togglePick('laptop', r)} /> }] : []),
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id || r.serial_number} />, sub: laptopSub },
    { key: 'r', header: 'Why scrapped', render: (r) => r.reason || '—' },
    { key: 'd', header: 'Scrapped', render: (r) => <DateTime value={r.status_changed_at} /> },
    {
      key: 'v',
      header: 'Buyer pays (₹)',
      render: (r) => (picked[pickKey('laptop', r)]
        ? <Input type="number" min="0" value={values[pickKey('laptop', r)] ?? ''} onChange={(e) => setValues({ ...values, [pickKey('laptop', r)]: e.target.value })} style={{ maxWidth: '8rem' }} />
        : null),
    },
  ];
  const partCols = [
    ...(canChallan ? [{ key: 'x', header: '', width: '2.5rem', render: (u) => <input type="checkbox" aria-label={`Pick ${u.prt_id}`} checked={Boolean(picked[pickKey('part', u)])} onChange={() => togglePick('part', u)} /> }] : []),
    { key: 'p', header: 'Part', render: (u) => <DocNumber value={u.prt_id} />, sub: (u) => [u.part_name, u.serial_number].filter(Boolean).join(' · ') || null },
    { key: 'c', header: 'Category', render: (u) => u.category || '—', sub: (u) => [u.brand_name, u.model_name].filter(Boolean).join(' ') || null },
    { key: 'k', header: 'Our cost', numeric: true, render: (u) => (u.unit_cost != null ? <Money value={u.unit_cost} /> : '—') },
    { key: 'r', header: 'Why discarded', render: (u) => u.notes || '—', sub: (u) => (u.removed_from_ttspl_id ? `from ${u.removed_from_ttspl_id}` : null) },
    { key: 'd', header: 'Discarded', render: (u) => <DateTime value={u.updated_at || u.created_at} /> },
    {
      key: 'v',
      header: 'Buyer pays (₹)',
      render: (u) => (picked[pickKey('part', u)]
        ? <Input type="number" min="0" value={values[pickKey('part', u)] ?? ''} onChange={(e) => setValues({ ...values, [pickKey('part', u)]: e.target.value })} style={{ maxWidth: '8rem' }} />
        : null),
    },
  ];
  // The row opens the challan; its PDF button must not.
  const pdf = async (e, no) => {
    e.stopPropagation();
    setPdfFor(no);
    try { await downloadScrapChallanPdf(no); } catch (err) { toast.error(errMsg(err, 'PDF download failed')); } finally { setPdfFor(''); }
  };
  const challanCols = [
    { key: 'n', header: 'Scrap challan', render: (c) => <DocNumber value={c.challan_number} />, sub: (c) => c.remarks || null },
    { key: 'b', header: 'Buyer', render: (c) => c.recipient_name, sub: (c) => c.contact_mobile },
    { key: 'i', header: 'Items', numeric: true, render: (c) => c.item_count },
    { key: 'v', header: 'Sale value', numeric: true, render: (c) => (c.sale_total != null ? `₹${Number(c.sale_total).toLocaleString('en-IN')}` : '—') },
    { key: 's', header: 'Status', render: (c) => <StatusChip status={c.status} />, sub: (c) => c.cancel_reason || null },
    { key: 'd', header: 'Date', render: (c) => <DateTime value={c.dispatched_at || c.created_at} /> },
    {
      key: 'a',
      header: '',
      render: (c) => <Button variant="quiet" disabled={pdfFor === c.challan_number} onClick={(e) => pdf(e, c.challan_number)}>{pdfFor === c.challan_number ? 'PDF…' : 'PDF'}</Button>,
    },
  ];

  return (
    <DeskShell title="Scrap" breadcrumb="Stock" subtitle="Scrap requests, approval, and handing scrapped laptops and discarded parts to the buyer on a scrap challan.">
      <div className="c-stack">
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'requests', label: 'Requests' },
              { value: 'handover', label: 'To hand over' },
              ...(canSeeParts ? [{ value: 'parts', label: 'Discarded parts' }] : []),
              { value: 'challans', label: 'Scrap challans' },
            ]}
          />
          {tab === 'requests' && <Segmented label="Status" value={reqStatus} onChange={setReqStatus} options={[{ value: 'pending', label: 'Waiting' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]} />}
          {(tab === 'handover' || tab === 'parts') && canChallan && chosenCount > 0 && (
            <>
              <Button variant="primary" onClick={() => setChallan({ name: '', address: '', contact: '', mobile: '', billing: '', remarks: '' })}>
                Scrap challan for {pickedLabel}{saleTotal ? ` · ₹${saleTotal.toLocaleString('en-IN')}` : ''}
              </Button>
              <Button variant="quiet" onClick={() => { setPicked({}); setValues({}); }}>Clear picks</Button>
            </>
          )}
        </div>
        {tab === 'parts' && (
          <div className="flex flex-wrap items-end" style={{ gap: '8px' }}>
            <Input type="search" placeholder="PRT-ID, part, serial, TTSPL" value={partSearch} onChange={(e) => setPartSearch(e.target.value)} style={{ width: '18rem' }} aria-label="Search discarded parts" />
            <span className="text-ink-3">Parts marked discarded and not yet on a scrap challan. Laptops picked on To hand over go on the same challan.</span>
          </div>
        )}
        {tab === 'challans' && (
          <div className="flex flex-wrap items-end" style={{ gap: '8px' }}>
            <Input type="search" placeholder="Challan, buyer, TTSPL, PRT-ID, serial" value={cf.search} onChange={(e) => setCf({ ...cf, search: e.target.value })} style={{ width: '18rem' }} aria-label="Search scrap challans" />
            <Segmented label="Status" value={cf.status} onChange={(v) => setCf({ ...cf, status: v })} options={[{ value: '', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'dispatched', label: 'Dispatched' }, { value: 'cancelled', label: 'Cancelled' }]} />
            <Field label="From"><Input type="date" value={cf.from} onChange={(e) => setCf({ ...cf, from: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={cf.to} onChange={(e) => setCf({ ...cf, to: e.target.value })} /></Field>
            {(cf.search || cf.status || cf.from || cf.to) && <Button variant="quiet" onClick={() => setCf({ search: '', status: '', from: '', to: '' })}>Clear</Button>}
          </div>
        )}
        {tab === 'requests' && <Notice tone="info">Raise a scrap request from the laptop&apos;s page (Stock → Assets → the laptop → Scrap…). Someone other than the requester approves.</Notice>}
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={{ requests: reqCols, handover: handoverCols, parts: partCols }[tab] || challanCols}
            rows={rows}
            rowKey={(r) => r.id || r.serial_id || r.instance_id || r.challan_number}
            onRowClick={tab === 'challans' ? (c) => navigate(`/carret/stock/scrap/challans/${encodeURIComponent(c.challan_number)}`) : undefined}
            empty={<EmptyState title="Nothing here" />}
          />
        )}
        {tab === 'challans' && pages > 1 && (
          <div className="flex items-center justify-end" style={{ gap: '8px' }}>
            <Button variant="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
            <span className="text-ink-3">Page {page} of {pages}</span>
            <Button variant="quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</Button>
          </div>
        )}
      </div>

      <Drawer open={Boolean(decide)} onClose={() => setDecide(null)} title={decide?.approve ? `Approve scrap — ${decide?.row?.asset_code}` : `Reject scrap — ${decide?.row?.asset_code}`} footer={<Button variant="primary" disabled={busy || (!decide?.approve && (decide?.note || '').trim().length < 3)} onClick={submitDecision}>{decide?.approve ? 'Approve — scrap it' : 'Reject'}</Button>}>
        {decide && (
          <div className="c-stack">
            <p>{decide.row.reason}</p>
            {decide.approve && <Notice tone="warn">Scrapped is final. Open floor tickets on this laptop are cancelled; it then waits here to go out on a scrap challan.</Notice>}
            <Field label="Note" required={!decide.approve}><Textarea rows={3} value={decide.note} onChange={(e) => setDecide({ ...decide, note: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer open={Boolean(challan)} onClose={() => setChallan(null)} title="New scrap challan" width="36rem" footer={<Button variant="primary" disabled={busy || !challan?.name?.trim() || !challan?.address?.trim()} onClick={submitChallan}>Raise scrap challan</Button>}>
        {challan && (
          <div className="c-stack">
            <p>{pickedLabel}{saleTotal ? `, buyer pays ₹${saleTotal.toLocaleString('en-IN')} in total` : ''}. Dispatch, e-way bill and signatures are done on the challan page.</p>
            <Field label="Buyer / recycler name" required><Input value={challan.name} onChange={(e) => setChallan({ ...challan, name: e.target.value })} /></Field>
            <Field label="Buyer address" required><Textarea rows={2} value={challan.address} onChange={(e) => setChallan({ ...challan, address: e.target.value })} /></Field>
            <FormGrid cols={2}>
              <Field label="Contact person"><Input value={challan.contact} onChange={(e) => setChallan({ ...challan, contact: e.target.value })} /></Field>
              <Field label="Mobile"><Input value={challan.mobile} onChange={(e) => setChallan({ ...challan, mobile: e.target.value })} /></Field>
            </FormGrid>
            <Field label="Billing address (if different)"><Textarea rows={2} value={challan.billing} onChange={(e) => setChallan({ ...challan, billing: e.target.value })} /></Field>
            <Field label="Remarks"><Textarea rows={2} value={challan.remarks} onChange={(e) => setChallan({ ...challan, remarks: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}
