import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, DataTable, DateTime, EmptyState, Money } from '../../../components/carret';
import { deleteSalesOrderDraft, listSalesOrderDrafts } from '../../sales-pipeline/salesPipelineApi';

const typeLabel = (t) => ({ sale: 'Sale', rental: 'Rental', demo: 'Demo' }[String(t || '').toLowerCase()] || t || '—');

/**
 * Sales orders → Drafts: the new-SO forms saved half-way (migration 406).
 * A row reopens the form; creating the order there removes the draft.
 */
export default function SoDraftsTable() {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: '', rows: [] });
  const [deleteFor, setDeleteFor] = useState(null);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    listSalesOrderDrafts()
      .then(({ data }) => setState({ loading: false, error: '', rows: data?.drafts || [] }))
      .catch((e) => setState({ loading: false, error: e?.response?.data?.message || 'Could not load drafts.', rows: [] }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (r) => {
    try {
      await deleteSalesOrderDraft(r.draft_id);
      toast.success('Draft deleted');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not delete the draft.');
    }
  };

  if (state.loading) return <EmptyState title="Loading…" />;
  if (state.error) return <EmptyState title="Could not load drafts" body={state.error} />;

  const columns = [
    { key: 'draft_id', header: 'Draft', render: (r) => <span className="font-mono">Draft #{r.draft_id}</span> },
    { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || <span className="text-ink-3">No customer yet</span> },
    { key: 'quotation_type', header: 'Type', render: (r) => typeLabel(r.quotation_type), sub: (r) => (r.quotation_number ? `from ${r.quotation_number}` : null) },
    { key: 'created_by_name', header: 'Saved by', render: (r) => r.created_by_name || '—' },
    { key: 'total', header: 'Value', numeric: true, render: (r) => <Money value={Number(r.total) || 0} showZero={false} /> },
    { key: 'updated_at', header: 'Last saved', render: (r) => <DateTime value={r.updated_at} /> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <button
          type="button"
          className="c-icon-btn"
          aria-label={`Delete draft ${r.draft_id}`}
          onClick={(e) => { e.stopPropagation(); setDeleteFor(r); }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={state.rows}
        rowKey={(r) => r.draft_id}
        onRowClick={(r) => navigate(`/carret/sell/sales-orders/new?draft=${r.draft_id}`)}
        empty={<EmptyState title="No drafts" body="Use “Save as draft” on a new sales order to keep it here without taking an SO number." action={<Button onClick={() => navigate('/carret/sell/sales-orders/new')}>New sales order</Button>} />}
      />
      <ConfirmDialog
        open={!!deleteFor}
        onClose={() => setDeleteFor(null)}
        onConfirm={() => { if (deleteFor) remove(deleteFor); }}
        title={`Delete the draft for ${deleteFor?.customer_name || 'no customer'}?`}
        body="This cannot be undone."
        confirmLabel="Delete draft"
      />
    </>
  );
}
