import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Laptop } from 'lucide-react';
import { usePermission } from '../../../hooks/usePermission';
import { Button } from '../../../components/ui/primitives';
import LoanStatusBadge from './LoanStatusBadge';
import CreateLoanRequestModal from './CreateLoanRequestModal';
import { getTicketLoanContext } from '../loanLaptopApi';

/** "Loan laptop" card on the support ticket: live loans + raise one per repair pickup. */
export default function TicketLoanSection({ ticketId }) {
  const { hasPermission } = usePermission();
  const canRaise = hasPermission('loan_laptops', 'edit');
  const [ctx, setCtx] = useState(null);
  const [modalPickup, setModalPickup] = useState(null);

  const load = useCallback(() => {
    if (!canRaise) return;
    getTicketLoanContext(ticketId)
      .then(({ data }) => setCtx(data.data))
      .catch(() => setCtx(null)); // feature not installed / no access: hide quietly
  }, [ticketId, canRaise]);
  useEffect(() => { load(); }, [load]);

  if (!ctx) return null;
  const repairPickups = ctx.pickups || [];
  if (!repairPickups.length && !(ctx.loans || []).length) return null;

  return (
    <section className="support-v3-card border-sky-200 bg-sky-50/30">
      <div className="flex items-center gap-2 mb-3">
        <Laptop className="w-5 h-5 text-sky-700" />
        <h3 className="text-base font-semibold text-slate-900">Loan laptop</h3>
      </div>

      {(ctx.loans || []).length > 0 && (
        <div className="space-y-2 mb-3">
          {ctx.loans.map((l) => (
            <Link key={l.id} to={`/loan-laptops/${l.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white border border-slate-200 px-3 py-2 hover:border-sky-300">
              <span className="text-sm">
                <span className="font-semibold text-slate-900">{l.request_number}</span>
                <span className="text-slate-500"> · {l.loan_ttspl_id} for {l.original_ttspl_id}</span>
              </span>
              <LoanStatusBadge status={l.status} />
            </Link>
          ))}
        </div>
      )}

      {repairPickups.map((p) => (
        <div key={p.item_id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2 border-t border-sky-100 first:border-0">
          <div className="text-sm min-w-0">
            <span className="font-mono font-semibold text-slate-900">{p.ttspl_id}</span>
            <span className="text-slate-500"> · repair pickup ({p.status})</span>
            {!p.eligible && <p className="text-xs text-slate-500">{p.reasons.join('; ')}</p>}
          </div>
          {p.eligible && (
            <Button size="sm" onClick={() => setModalPickup(p)}>Request loan laptop</Button>
          )}
        </div>
      ))}

      {modalPickup && (
        <CreateLoanRequestModal
          ticketId={ticketId}
          pickup={modalPickup}
          onClose={() => setModalPickup(null)}
          onCreated={() => { setModalPickup(null); load(); }}
        />
      )}
    </section>
  );
}
