import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Phone } from 'lucide-react';
import { getFollowUps, getLeads, updateFollowUp } from '../leadCrmApi';
import { STATUS_COLORS } from '../leadConstants';
import { daysInMonth, formatFollowUpDateTime, isSameDay, startOfMonth } from '../leadCrmUtils';
import toast from 'react-hot-toast';

export default function FollowUpCalendarPage() {
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [allLeads, setAllLeads] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [todayList, setTodayList] = useState([]);
  const [rescheduleId, setRescheduleId] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [leadsRes, fuRes] = await Promise.all([getLeads(), getFollowUps()]);
        setAllLeads((leadsRes.data?.leads || []).filter((l) => l.followUpDate));
        setOverdue(fuRes.data?.overdue || []);
        setTodayList(fuRes.data?.today || []);
      } catch { /* ignore */ }
    })();
  }, []);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = startOfMonth(year, month);
  const totalDays = daysInMonth(year, month);
  const startPad = first.getDay();

  const leadsOnDay = useMemo(() => {
    return allLeads.filter((l) => isSameDay(new Date(l.followUpDate), selected));
  }, [allLeads, selected]);

  const dotsForDay = (day) => {
    const d = new Date(year, month, day);
    const items = allLeads.filter((l) => isSameDay(new Date(l.followUpDate), d));
    if (!items.length) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dd = new Date(d); dd.setHours(0, 0, 0, 0);
    if (dd < today) return 'red';
    if (dd.getTime() === today.getTime()) return 'amber';
    return 'blue';
  };

  const handleReschedule = async () => {
    if (!rescheduleId || !rescheduleDate) return;
    try {
      await updateFollowUp(rescheduleId, { follow_up_date: rescheduleDate, follow_up_time: rescheduleTime || null, notes: 'Rescheduled from calendar' });
      toast.success('Follow-up updated');
      setRescheduleId(null);
      window.location.reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const LeadRow = ({ lead }) => {
    const st = STATUS_COLORS[lead.status] || STATUS_COLORS.Pending;
    return (
      <div className="p-3 rounded-xl border border-gray-100 bg-white shadow-sm text-sm">
        <div className="flex justify-between gap-2">
          <div>
            <Link to={`/lead-crm/leads/${lead.leadId}`} className="font-medium text-blue-600 hover:underline">
              {lead.companyName || lead.name}
            </Link>
            <p className="text-gray-500 text-xs">{lead.name} · {lead.phone}</p>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs h-fit ${st.bg} ${st.text}`}>{lead.status}</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">{formatFollowUpDateTime(lead.followUpDate, lead.followUpTime)}</p>
        <div className="flex gap-2 mt-2">
          <button type="button" onClick={() => { setRescheduleId(lead.leadId); setRescheduleDate(''); }}
            className="text-xs px-2 py-1 border rounded-lg">Reschedule</button>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="text-xs px-2 py-1 border rounded-lg flex items-center gap-1">
              <Phone className="w-3 h-3" /> Call
            </a>
          )}
          {lead.phone && (
            <a href={`https://wa.me/91${lead.phone.replace(/\D/g, '').slice(-10)}`} target="_blank" rel="noreferrer"
              className="text-xs px-2 py-1 border rounded-lg text-green-700">WhatsApp</a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Follow-ups</h1>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 rounded-xl border border-gray-100 bg-white shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft /></button>
            <h2 className="font-semibold">{cursor.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h2>
            <button type="button" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
            {Array.from({ length: totalDays }).map((_, i) => {
              const day = i + 1;
              const dot = dotsForDay(day);
              const d = new Date(year, month, day);
              const active = isSameDay(d, selected);
              return (
                <button key={day} type="button" onClick={() => setSelected(d)}
                  className={`aspect-square rounded-lg text-sm flex flex-col items-center justify-center gap-0.5 ${
                    active ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'
                  }`}>
                  {day}
                  {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot === 'red' ? 'bg-red-500' : dot === 'amber' ? 'bg-amber-500' : 'bg-blue-500'} ${active ? 'bg-white' : ''}`} />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
            <h3 className="font-semibold text-sm mb-1">
              Follow-ups — {selected.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </h3>
            <p className="text-xs text-gray-500 mb-3">Today ({todayList.length}) · Overdue ({overdue.length})</p>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {leadsOnDay.length === 0 ? <p className="text-sm text-gray-400">No follow-ups this day</p> : leadsOnDay.map((l) => <LeadRow key={l.leadId} lead={l} />)}
            </div>
          </div>
          {overdue.length > 0 && (
            <div className="rounded-xl border-2 border-red-200 bg-red-50/30 p-4">
              <h3 className="font-semibold text-sm text-red-800 mb-2">Overdue ({overdue.length})</h3>
              <div className="space-y-2 max-h-[30vh] overflow-y-auto">
                {overdue.map((l) => <LeadRow key={l.leadId} lead={l} />)}
              </div>
            </div>
          )}
        </div>
      </div>

      {rescheduleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl p-4 w-full max-w-sm space-y-3">
            <h3 className="font-semibold">Reschedule Follow-up</h3>
            <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
            <input type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setRescheduleId(null)} className="px-3 py-1.5 text-sm border rounded-lg">Cancel</button>
              <button type="button" onClick={handleReschedule} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
