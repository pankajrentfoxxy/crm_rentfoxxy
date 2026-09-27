import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, DataTable, Drawer, Field, FormGrid, Input, Money, Notice, Section, Select,
} from '../../../components/carret';
import { addTicketServiceCharge, fetchTicketServiceCharges, removeServiceCharge } from './serveApi';
import { errMsg } from './serveShared';

const STATUS = { pending: 'Waiting for Accounts', approved: 'Approved — to bill', rejected: 'Rejected', billed: 'On service order' };

/**
 * Service charges on a ticket's SOLD (gorefurbo) laptops (claude/carret-lockin-warranty.md, W1–W2).
 * Out of warranty all service is chargeable: parts are charged automatically
 * once priced and fitted; the lead adds the service / labour charge here.
 * Accounts approve and bill them on a gorefurbo service order.
 */
export default function ServiceChargesPanel({ ticketId, items, canLead }) {
  const sold = (items || []).filter((i) => i.warranty_status);
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchTicketServiceCharges(ticketId).then(({ data }) => setRows(data.data || [])).catch(() => setRows([]));
  }, [ticketId]);
  useEffect(() => { if (sold.length) load(); }, [load, sold.length]);

  if (!sold.length) return null;
  const outOfWarranty = sold.filter((i) => i.warranty_status !== 'in');

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await addTicketServiceCharge(ticketId, {
        ticket_item_id: form.item, description: form.description, amount: form.amount, quantity: form.quantity,
      });
      toast.success(data.message);
      setForm(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async (r) => {
    try { await removeServiceCharge(r.id); load(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <Section
      title="Service charges (sold laptop)"
      actions={canLead && <Button onClick={() => setForm({ item: String(sold[0].id), description: '', amount: '', quantity: 1 })}>Add service charge</Button>}
    >
      {outOfWarranty.length > 0 && (
        <Notice tone="crit" title="Out of warranty — all service is chargeable">
          {outOfWarranty.map((i) => i.ttspl_id || i.serial_number).join(', ')}: paid repair only, no free replacement.
          Parts are charged automatically once the warehouse prices them; add the labour / service charge here.
        </Notice>
      )}
      {rows && rows.length > 0 ? (
        <DataTable
          columns={[
            { key: 'd', header: 'Charge', render: (r) => r.description, sub: (r) => (r.charge_kind === 'part' ? 'Part' : 'Service') },
            { key: 'a', header: 'Amount', numeric: true, render: (r) => <Money value={r.amount} />, sub: (r) => `${r.quantity} × ₹${Number(r.unit_price).toLocaleString('en-IN')} + ${r.gst_rate}% GST` },
            { key: 's', header: 'Status', render: (r) => STATUS[r.status] || r.status, sub: (r) => r.order_number || r.decision_note || null },
            { key: 'x', header: '', render: (r) => (canLead && r.charge_kind === 'service' && r.status === 'pending' ? <Button variant="quiet" onClick={() => remove(r)}>Remove</Button> : null) },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
        />
      ) : <p className="text-ink-3">No charges yet.</p>}

      <Drawer open={Boolean(form)} onClose={() => setForm(null)} title="Add service charge" footer={<Button variant="primary" disabled={busy} onClick={save}>Add</Button>}>
        {form && (
          <div className="c-stack">
            <Field label="Laptop" required>
              <Select value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} options={sold.map((i) => ({ value: String(i.id), label: `${i.ttspl_id || i.serial_number} — ${i.warranty_status === 'in' ? 'in warranty' : 'out of warranty'}` }))} />
            </Field>
            <Field label="What was done" required><Input value={form.description} placeholder="e.g. Motherboard repair labour" onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <FormGrid cols={2}>
              <Field label="Price (₹, before GST)" required><Input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="Quantity"><Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
            </FormGrid>
            <p className="text-ink-3">Accounts approve it and bill it on a gorefurbo service order (18% GST).</p>
          </div>
        )}
      </Drawer>
    </Section>
  );
}
