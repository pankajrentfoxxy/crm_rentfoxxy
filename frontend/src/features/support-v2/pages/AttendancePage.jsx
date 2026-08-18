import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, PageHeader } from '../../../components/ui/supportPrimitives';
import { fetchAttendance, putAttendance } from '../supportV2Api';

export default function AttendancePage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchAttendance({ date })
      .then((r) => setRows(r.data?.rows || []))
      .catch((e) => toast.error(e.response?.data?.message || 'Could not load attendance'))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const mark = async (userId, status) => {
    setBusy(`${userId}-${status}`);
    try {
      const r = await putAttendance({ user_id: userId, date, status });
      if (status === 'ABSENT') {
        const n = (r.data?.moved || []).length;
        const f = (r.data?.failed || []).length;
        toast.success(n || f
          ? `Marked absent · moved ${n} P1/P2 job(s)${f ? `, ${f} left unassigned` : ''}`
          : 'Marked absent');
      } else {
        toast.success('Marked present');
      }
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-3">
      <PageHeader
        title="Technician attendance"
        subtitle="Mark present or absent. Absent people cannot take jobs that day; their open P1/P2 jobs move to someone with bandwidth."
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 border rounded px-2 text-[12px]" />
      {loading ? <p className="text-[12px] text-sup-muted">Loading…</p> : (
        <table className="w-full text-[12px] bg-white border border-sup-lineSoft rounded-[10px] overflow-hidden">
          <thead className="bg-sup-canvas2 text-sup-muted">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">Jobs today</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="border-t border-sup-lineSoft">
                <td className="px-3 py-2 font-semibold">{r.name}</td>
                <td className="px-3 py-2">{r.role}</td>
                <td className="px-3 py-2">{r.jobs_today} / {r.max_jobs_per_day}</td>
                <td className={`px-3 py-2 ${r.status === 'ABSENT' ? 'text-pri1 font-semibold' : 'text-sup-ok'}`}>
                  {r.status}{!r.on_shift && r.status === 'PRESENT' ? ' · off shift' : ''}
                </td>
                <td className="px-3 py-2 space-x-2">
                  <Button size="sm" variant="secondary" loading={busy === `${r.user_id}-PRESENT`} onClick={() => mark(r.user_id, 'PRESENT')}>
                    Present
                  </Button>
                  <Button size="sm" loading={busy === `${r.user_id}-ABSENT`} onClick={() => mark(r.user_id, 'ABSENT')}>
                    Absent
                  </Button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sup-muted">No support people found.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
