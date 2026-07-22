import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../../utils/notificationsApi';
import { salesOrderDetailPath } from '../../features/sales-pipeline/salesOrderScope';

const POLL_MS = 30000;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data } = await fetchNotifications({ limit: 20 });
      if (!data?.success) return;
      setItems(data.notifications || []);
      setUnread(data.unread || 0);
    } catch {
      /* ignore poll errors */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const handleRead = async (n) => {
    try {
      await markNotificationRead(n.id);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((c) => Math.max(0, c - 1));
    } catch {
      toast.error('Could not mark notification read');
    }
  };

  const handleReadAll = async () => {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
      setUnread(0);
    } catch {
      toast.error('Could not clear notifications');
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50"
        title="Notifications"
      >
        <Bell className="w-5 h-5 text-slate-600" />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-40" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl z-50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-800">Notifications</span>
              {unread > 0 ? (
                <button type="button" className="text-xs text-blue-600" onClick={handleReadAll}>
                  Mark all read
                </button>
              ) : null}
            </div>
            {!items.length ? (
              <p className="p-4 text-sm text-slate-400 text-center">No notifications</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((n) => (
                  <li key={n.id} className={`p-3 text-sm ${n.read_at ? 'opacity-70' : 'bg-blue-50/40'}`}>
                    <p className="font-medium text-slate-800">{n.title || n.type}</p>
                    {n.body ? <p className="text-xs text-slate-600 mt-0.5">{n.body}</p> : null}
                    <p className="text-[10px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleString('en-IN')}</p>
                    <div className="flex gap-2 mt-2">
                      {n.sales_order_number ? (
                        <Link
                          to={salesOrderDetailPath(n.sales_order_number, 'rental')}
                          className="text-xs text-blue-600 hover:underline"
                          onClick={() => setOpen(false)}
                        >
                          Open SO
                        </Link>
                      ) : null}
                      {!n.read_at ? (
                        <button type="button" className="text-xs text-slate-500" onClick={() => handleRead(n)}>
                          Mark read
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
