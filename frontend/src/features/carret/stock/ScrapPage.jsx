import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, Notice, Segmented, StatusChip, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  cancelScrap, createScrapChallan, decideScrap, errMsg, fetchScrapChallans, fetchScrapRequests, fetchScrappedAwaitingChallan,
} from './stockApi';

/**
 * Stock → Scrap (claude/carret-stock.md, ST-D2).
 *   Requests — a laptop someone asked to scrap; a manager (scrap_approval) who
 *     did not ask approves or rejects.
 *   To hand over — approved (scrapped) laptops not yet on a scrap challan:
 *     pick them, enter what the buyer pays for each, raise the challan.
 *   Challans — every scrap challan (laptops and parts); dispatch, e-sign and
 *     PDF are on the challan page.
 * Discarded spare parts are put on challans from Parts → Discarded (old view).
 */
const WAREHOUSE_ROLES = ['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead', 'procurement'];
const REQ_LABEL = { pending: 'Waiting for approval', approved: 'Approved — scrapped', rejected: 'Rejected', cancelled: 'Withdrawn' };

export default function ScrapPage() {
  const { hasPermission, user } = usePermission();
  const canApprove = hasPermission('scrap_approval', 'edit');
  const canChallan = WAREHOUSE_ROLES.includes(user?.role) || hasPermission('scrap_challans', 'edit');
  const [tab, setTab] = useState('requests');
  const [reqStatus, setReqStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [decide, setDecide] = useState(null);
  const [picked, setPicked] = useState({});
  const [values, setValues] = useState({});
  const [challan, setChallan] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    const req = tab === 'requests' ? fetchScrapRequests(reqStatus)
      : tab === 'handover' ? fetchScrappedAwaitingChallan()
        : fetchScrapChallans({ limit: 100 });
    req.then(({ data }) => setRows(data.data || [])).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [tab, reqStatus]);
  useEffect(() => { load(); setPicked({}); }, [load]);

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
  const chosen = (tab === 'handover' ? rows || [] : []).filter((r) => picked[r.serial_id]);
  const saleTotal = chosen.reduce((s, r) => s + (Number(values[r.serial_id]) || 0), 0);
  const submitChallan = async () => {
    setBusy(true);
    try {
      const saleValues = Object.fromEntries(chosen.filter((r) => values[r.serial_id] !== undefined && values[r.serial_id] !== '').map((r) => [`laptop:${r.serial_id}`, values[r.serial_id]]));
      const { data } = await createScrapChallan({
        serial_ids: chosen.map((r) => r.serial_id),
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
      setTab('challans');
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
    ...(canChallan ? [{ key: 'x', header: '', width: '2.5rem', render: (r) => <input type="checkbox" aria-label={`Pick ${r.ttspl_id}`} checked={Boolean(picked[r.serial_id])} onChange={() => setPicked({ ...picked, [r.serial_id]: !picked[r.serial_id] })} /> }] : []),
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id || r.serial_number} />, sub: (r) => r.model_name },
    { key: 'r', header: 'Why scrapped', render: (r) => r.reason || '—' },
    { key: 'd', header: 'Scrapped', render: (r) => <DateTime value={r.status_changed_at} /> },
    {
      key: 'v',
      header: 'Buyer pays (₹)',
      render: (r) => (picked[r.serial_id]
        ? <Input type="number" min="0" value={values[r.serial_id] ?? ''} onChange={(e) => setValues({ ...values, [r.serial_id]: e.target.value })} style={{ maxWidth: '8rem' }} />
        : null),
    },
  ];
  const challanCols = [
    { key: 'n', header: 'Scrap challan', render: (c) => <Link to={`/inventory-management/scrap-challans/${encodeURIComponent(c.challan_number)}`}><DocNumber value={c.challan_number} /></Link> },
    { key: 'b', header: 'Buyer', render: (c) => c.recipient_name, sub: (c) => c.contact_mobile },
    { key: 'i', header: 'Items', numeric: true, render: (c) => c.item_count },
    { key: 'v', header: 'Sale value', numeric: true, render: (c) => (c.sale_total != null ? `₹${Number(c.sale_total).toLocaleString('en-IN')}` : '—') },
    { key: 's', header: 'Status', render: (c) => <StatusChip status={c.status} />, sub: (c) => c.cancel_reason || null },
    { key: 'd', header: 'Date', render: (c) => <DateTime value={c.dispatched_at || c.created_at} /> },
  ];

  return (
    <DeskShell title="Scrap" breadcrumb="Stock" subtitle="Scrap requests, approval, and handing scrapped laptops to the buyer on a scrap challan.">
      <div className="c-stack">
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="Show" value={tab} onChange={setTab} options={[{ value: 'requests', label: 'Requests' }, { value: 'handover', label: 'To hand over' }, { value: 'challans', label: 'Scrap challans' }]} />
          {tab === 'requests' && <Segmented label="Status" value={reqStatus} onChange={setReqStatus} options={[{ value: 'pending', label: 'Waiting' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]} />}
          {tab === 'handover' && canChallan && chosen.length > 0 && (
            <Button variant="primary" onClick={() => setChallan({ name: '', address: '', contact: '', mobile: '', billing: '', remarks: '' })}>
              Scrap challan for {chosen.length} laptop(s){saleTotal ? ` · ₹${saleTotal.toLocaleString('en-IN')}` : ''}
            </Button>
          )}
          {tab === 'challans' && <Link to="/inventory-management/discarded-parts" className="text-ink-3">Discarded parts → scrap challan (old view)</Link>}
        </div>
        {tab === 'requests' && <Notice tone="info">Raise a scrap request from the laptop&apos;s page (Stock → Assets → the laptop → Scrap…). Someone other than the requester approves.</Notice>}
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={tab === 'requests' ? reqCols : tab === 'handover' ? handoverCols : challanCols}
            rows={rows}
            rowKey={(r) => r.id || r.serial_id || r.challan_number}
            empty={<EmptyState title="Nothing here" />}
          />
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
            <p>{chosen.length} laptop(s){saleTotal ? `, buyer pays ₹${saleTotal.toLocaleString('en-IN')} in total` : ''}. Dispatch, e-way bill and signatures are done on the challan page.</p>
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
