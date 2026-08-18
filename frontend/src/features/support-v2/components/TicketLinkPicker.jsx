import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { searchTickets } from '../supportV2Api';
import { SUPPORT_V2_BASE } from '../supportV2Utils';

export default function TicketLinkPicker({
  value,
  onChange,
  suggestions = [],
  allowOpen = true,
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      searchTickets(q.trim())
        .then((r) => setHits(r.data?.rows || []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (t) => {
    onChange({
      target_ticket_id: t.ticket_id,
      ticket_number: t.ticket_number,
      subject: t.subject,
      link_type: 'RELATED',
    });
    setQ('');
    setHits([]);
  };

  return (
    <div className="space-y-2 text-[12px]">
      {value?.target_ticket_id ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-sup-accentSoft px-2 py-1.5">
          <span>
            Linked to <b>{value.ticket_number || `#${value.target_ticket_id}`}</b>
            {value.subject ? ` — ${value.subject}` : ''}
          </span>
          <button type="button" className="underline" onClick={() => onChange(null)}>Clear</button>
        </div>
      ) : (
        <>
          {suggestions.length > 0 && (
            <div className="space-y-1">
              <div className="font-semibold text-pri2">Open tickets</div>
              {suggestions.map((t) => (
                <div key={t.ticket_id} className="flex items-center justify-between gap-2">
                  {allowOpen ? (
                    <Link className="text-sup-accent underline" to={`${SUPPORT_V2_BASE}/tickets/${t.ticket_id}`}>
                      {t.ticket_number}
                    </Link>
                  ) : <span>{t.ticket_number}</span>}
                  <button
                    type="button"
                    className="text-[11px] underline"
                    onClick={() => pick(t)}
                  >
                    Link to existing
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ticket number to link"
            className="w-full rounded-md border border-sup-line px-2 py-1.5"
          />
          {hits.length > 0 && (
            <ul className="border border-sup-lineSoft rounded-md max-h-36 overflow-auto">
              {hits.map((t) => (
                <li key={t.ticket_id}>
                  <button type="button" className="w-full text-left px-2 py-1.5 hover:bg-sup-canvas2" onClick={() => pick(t)}>
                    {t.ticket_number} <span className="text-sup-faint">{t.subject || t.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
