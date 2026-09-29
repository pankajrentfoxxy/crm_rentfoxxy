import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, DocumentHeader, EmptyState, Field, KeyValue, Notice, Section, Input, SignaturePad,
} from '../../../components/carret';
import { fileUrl } from '../procure/procureShared';
import { fetchPartChallan, signPartChallan } from './serveApi';
import { errMsg } from './serveShared';

/**
 * Support → Parts desk → technician part challan (replaces the old
 * /support-parts/challans/:id page, same endpoints). The warehouse makes the
 * challan on the Parts desk; the technician signs here to take the parts
 * (now or later), then the PDF is ready. Backend: GET /support-parts/challans/:id
 * and POST …/sign-and-issue (warehouse sees all, a technician only their own).
 */
const STATUS_LABEL = { draft: 'Waiting for the technician’s signature', issued: 'Issued', partially_returned: 'Part returned', fully_returned: 'All returned' };
const RETURN_LABEL = { used: 'Fitted', returned: 'Returned', held: 'With the technician' };

const itemCols = [
  { key: 'p', header: 'Part', render: (i) => i.part_name, sub: (i) => i.prt_id || null },
  { key: 'q', header: 'Qty', numeric: true, render: (i) => i.quantity },
  { key: 's', header: 'Where it is', render: (i) => RETURN_LABEL[i.return_status] || i.return_status || '—' },
];

function SignatureCard({ label, url, at }) {
  return (
    <div className="c-card" style={{ padding: '12px' }}>
      <div className="text-ink-3" style={{ marginBottom: '6px' }}>{label}</div>
      {url ? <img src={fileUrl(url)} alt={label} style={{ maxHeight: '5rem', maxWidth: '100%' }} /> : <span className="text-ink-3">Not signed</span>}
      {at && <div className="text-ink-3" style={{ marginTop: '4px' }}><DateTime value={at} format="datetime" /></div>}
    </div>
  );
}

export default function PartChallanRecordPage() {
  const { challanId } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [signer, setSigner] = useState('');
  const [esign, setEsign] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchPartChallan(challanId)
      .then(({ data }) => { setC(data.challan); setItems(data.items || []); setSigner((s) => s || data.challan?.tech_name || ''); })
      .catch((e) => setError(errMsg(e, 'Could not load the challan.')));
  }, [challanId]);
  useEffect(() => { load(); }, [load]);

  const back = <Button onClick={() => navigate('/carret/serve/parts-desk?tab=dcs')}>Parts desk</Button>;
  if (error) return <DeskShell title="Part challan" breadcrumb="Support / Parts desk"><EmptyState title="Could not load this challan" body={error} action={back} /></DeskShell>;
  if (!c) return <DeskShell title="Part challan" breadcrumb="Support / Parts desk"><EmptyState title="Loading…" /></DeskShell>;

  const canSign = ['draft', 'challan_generated'].includes(c.status);
  const sign = async () => {
    setBusy(true);
    try {
      await signPartChallan(c.id, { esign_data: esign, signer_name: signer.trim() });
      toast.success('Parts issued to the technician');
      load();
    } catch (e) { toast.error(errMsg(e, 'Sign failed')); } finally { setBusy(false); }
  };

  return (
    <DeskShell title={c.challan_number} breadcrumb="Support / Parts desk" subtitle={c.tech_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={c.challan_number}
          type="Support part challan"
          status={c.status === 'draft' ? 'pending' : c.status}
          actions={c.pdf_path ? <a className="c-btn" href={fileUrl(c.pdf_path)} target="_blank" rel="noopener noreferrer">PDF</a> : null}
          meta={[
            { label: 'Issued to', value: c.tech_name || '—' },
            { label: 'Ticket', value: c.ticket_id ? <Link to={`/carret/serve/tickets/${c.ticket_id}`}>{c.ticket_number}</Link> : '—' },
            { label: 'Customer', value: c.customer_name || '—' },
            { label: 'Laptop', value: c.ttspl_id ? <DocNumber value={c.ttspl_id} /> : '—' },
            { label: 'Issued', value: c.issued_at ? <DateTime value={c.issued_at} format="datetime" /> : '—' },
          ]}
        />
        <Notice tone={canSign ? 'warn' : 'info'} title={STATUS_LABEL[c.status] || c.status}>
          {canSign ? 'The technician signs below to take these parts. The PDF is made once they sign.' : 'Each part is fitted on the ticket or returned to the warehouse from the Parts desk.'}
        </Notice>

        <Section title={`Parts · ${items.length}`}>
          <DataTable columns={itemCols} rows={items} rowKey={(i) => i.id} empty={<EmptyState title="No parts" />} />
        </Section>

        <Section title="Signatures">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '12px' }}>
            <SignatureCard label="Technician" url={c.tech_esign_url} at={c.tech_esign_at} />
            <SignatureCard label="Warehouse" url={c.wh_esign_url} at={c.wh_esign_at} />
          </div>
        </Section>

        {canSign && (
          <Section title="Technician signs">
            <div className="c-stack">
              <Field label="Technician's name" required><Input value={signer} onChange={(e) => setSigner(e.target.value)} /></Field>
              {esign ? (
                <div className="flex items-center" style={{ gap: '8px' }}>
                  <img src={esign} alt="Signature" style={{ maxHeight: '5rem', background: 'var(--surface)', border: '1px solid var(--rule)' }} />
                  <Button variant="quiet" onClick={() => setEsign(null)}>Sign again</Button>
                </div>
              ) : <SignaturePad onSave={setEsign} onCancel={() => setEsign(null)} />}
              <div className="flex justify-end">
                <Button variant="primary" disabled={busy || !esign || !signer.trim()} onClick={sign}>{busy ? 'Issuing…' : 'Issue the parts'}</Button>
              </div>
            </div>
          </Section>
        )}

        <Section title="Details">
          <KeyValue cols={2} items={[
            { label: 'Technician email', value: c.tech_email || '—' },
            { label: 'Made by', value: c.issued_by_name || '—' },
            { label: 'Created', value: <DateTime value={c.created_at} format="datetime" /> },
          ]}
          />
        </Section>
      </div>
    </DeskShell>
  );
}
