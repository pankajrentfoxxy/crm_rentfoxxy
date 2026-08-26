import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, Plus, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { isSupportLead } from '../../utils/supportAccess';
import { ticketHasUnassignedAssigneeSlots } from './utils';
import { useAuth } from '../../context/AuthContext';
import TicketCard from './components/TicketCard';
import SupportTicketList from './SupportTicketList';

const TYPE_CHIPS = [
  { key: '', label: 'All', countKey: 'all' },
  { key: 'complaint', label: 'Complaint', countKey: 'complaint' },
  { key: 'pickup', label: 'Pickup', countKey: 'pickup' },
  { key: 'replacement', label: 'Replacement', countKey: 'replacement' },
];

const emptyCopy = {
  active: { title: 'No support tickets yet', body: 'Create your first ticket to get started.' },
  overdue: { title: 'All tickets are up to date', body: 'No overdue tickets right now.', icon: CheckCircle2 },
  pending_assign: { title: 'All machines have technicians assigned', body: 'Nothing waiting for assignment.' },
  my_open: { title: 'You have no assigned tickets right now', body: 'New assignments will appear here.' }
};

function SupportTicketsViewCards({ view = 'active', showFilters = true, splitSections = false }) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeTickets, setActiveTickets] = useState([]);
  const [closedTickets, setClosedTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [closedOffset, setClosedOffset] = useState(0);
  const [closedTotal, setClosedTotal] = useState(0);
  const [technicians, setTechnicians] = useState([]);
  const [typeCounts, setTypeCounts] = useState({ all: 0, complaint: 0, pickup: 0, replacement: 0 });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const buildFilterParams = useCallback(() => {
    const base = new URLSearchParams();
    if (debounced) base.set('search', debounced);
    base.set('view', view === 'all' ? 'active' : view);
    return base;
  }, [debounced, view]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const base = buildFilterParams();

      if (splitSections) {
        const activeParams = new URLSearchParams(base);
        activeParams.set('view', view === 'all' ? 'active' : view);
        const closedParams = new URLSearchParams(base);
        closedParams.set('view', 'closed');
        closedParams.set('limit', '50');
        closedParams.set('offset', String(closedOffset));
        const countParams = new URLSearchParams(base);
        countParams.set('view', view === 'all' ? 'active' : view);
        const [activeRes, closedRes, countsRes] = await Promise.all([
          api.get(`/support/tickets?${activeParams}`),
          api.get(`/support/tickets?${closedParams}`),
          api.get(`/support/tickets/counts?${countParams}`)
        ]);
        setActiveTickets(activeRes.data.tickets || []);
        setClosedTickets(closedRes.data.tickets || []);
        setClosedTotal(closedRes.data.total || 0);
        setTypeCounts(countsRes.data.counts || { all: 0, complaint: 0, pickup: 0, replacement: 0 });
      } else {
        const params = new URLSearchParams(base);
        params.set('view', view);
        if (typeFilter) params.set('type', typeFilter);
        const countParams = new URLSearchParams(base);
        countParams.set('view', view);
        const [{ data }, countsRes] = await Promise.all([
          api.get(`/support/tickets?${params}`),
          api.get(`/support/tickets/counts?${countParams}`)
        ]);
        setActiveTickets(data.tickets || []);
        setClosedTickets([]);
        setClosedTotal(0);
        setTypeCounts(countsRes.data.counts || { all: 0, complaint: 0, pickup: 0, replacement: 0 });
      }
    } catch (e) {
      setActiveTickets([]);
      setClosedTickets([]);
      setTypeCounts({ all: 0, complaint: 0, pickup: 0, replacement: 0 });
      toast.error(e.response?.data?.message || e.message || 'Failed to load support tickets');
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams, typeFilter, view, splitSections, closedOffset]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isSupportLead(user)) return;
    api.get('/support/technicians').then((r) => setTechnicians(r.data.technicians || [])).catch(() => setTechnicians([]));
  }, [user]);

  const handleAssign = async (ticketId, assignedTo) => {
    await api.post(`/support/tickets/${ticketId}/assign-all`, { assigned_to: assignedTo });
    load();
  };

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (debounced) params.set('search', debounced);
    if (typeFilter) params.set('type', typeFilter);
    params.set('view', view === 'all' ? 'all' : view);
    const res = await api.get(`/support/tickets/export?${params}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'support-tickets.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const empty = emptyCopy[view] || emptyCopy.active;
  const EmptyIcon = empty.icon;

  return (
    <div className="space-y-4">
      {showFilters && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, ticket # or serial number…"
              className="w-full pl-10 pr-3 py-3 rounded-lg border border-slate-300 min-h-[44px] text-base"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {TYPE_CHIPS.map((chip) => (
              <button
                key={chip.key || 'all'}
                type="button"
                className={`support-filter-chip ${chip.key || 'all'}${typeFilter === chip.key ? ' active' : ''}`}
                onClick={() => setTypeFilter(chip.key)}
              >
                {chip.label} ({typeCounts[chip.countKey] ?? 0})
              </button>
            ))}
            {view === 'all' && isSupportLead(user) && (
              <button type="button" className="support-btn-outline ml-auto" onClick={exportCsv}>Export</button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" />
        </div>
      ) : (
        <>
          <section>
            {splitSections && (
              <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                Pending & in progress — {activeTickets.length} tickets
              </h2>
            )}
            {activeTickets.length ? (
              <div className="support-ticket-grid">
                {activeTickets.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    technicians={technicians}
                    canAssign={isSupportLead(user) && ticketHasUnassignedAssigneeSlots(ticket)}
                    onAssigned={handleAssign}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-xl border border-slate-200 px-4">
                {EmptyIcon && <EmptyIcon className="w-10 h-10 mx-auto text-green-600 mb-3" />}
                <p className="font-medium">{empty.title}</p>
                <p className="text-sm text-slate-500 mt-1">{empty.body}</p>
                {isSupportLead(user) && view === 'active' && (
                  <Link to="/support/tickets/new" className="support-btn-primary inline-flex items-center gap-2 mt-4">
                    <Plus className="w-4 h-4" /> New ticket
                  </Link>
                )}
              </div>
            )}
          </section>

          {splitSections && (
            <section className="pt-6 border-t border-slate-200">
              <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-green-600" />
                Closed — {closedTickets.length} tickets
              </h2>
              {closedTickets.length ? (
                <>
                  <div className="support-ticket-grid">
                    {closedTickets.map((ticket) => (
                      <TicketCard key={ticket.id} ticket={ticket} closed technicians={technicians} />
                    ))}
                  </div>
                  {closedTickets.length < closedTotal && (
                    <button type="button" className="support-btn-outline mt-4" onClick={() => setClosedOffset((v) => v + 50)}>
                      Load older
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">No closed tickets in the last 30 days.</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default function SupportTicketsView({ enhancedList = false, ...props }) {
  if (enhancedList) return <SupportTicketList />;
  return <SupportTicketsViewCards {...props} />;
}
