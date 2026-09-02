import React, { useCallback, useEffect, useState } from 'react';
import { ListTodo } from 'lucide-react';
import toast from 'react-hot-toast';
import { getTaskflowPendingCount, getTaskflowSsoUrl } from '../utils/taskflowApi';

const POLL_MS = 45000;

export default function TaskflowNavButton() {
  const [count, setCount] = useState(0);
  const [opening, setOpening] = useState(false);

  const loadCount = useCallback(() => {
    getTaskflowPendingCount()
      .then((data) => setCount(Number(data?.count || 0)))
      .catch(() => setCount(0));
  }, []);

  useEffect(() => {
    loadCount();
    const id = setInterval(loadCount, POLL_MS);
    const onFocus = () => loadCount();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadCount]);

  const openTaskflow = async () => {
    if (opening) return;
    setOpening(true);
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setOpening(false);
      toast.error('Allow pop-ups to open TaskFlow in a new tab');
      return;
    }
    try {
      const data = await getTaskflowSsoUrl();
      if (!data?.url) throw new Error(data?.message || 'TaskFlow SSO URL missing');
      if (data.warning) toast.error(data.warning, { duration: 8000 });
      tab.opener = null;
      tab.location.replace(data.url);
    } catch (err) {
      tab.close();
      toast.error(err.response?.data?.message || err.message || 'Could not open TaskFlow');
    } finally {
      setOpening(false);
    }
  };

  const badge = count > 99 ? '99+' : String(count);

  return (
    <button
      type="button"
      onClick={openTaskflow}
      disabled={opening}
      title="Open TaskFlow in a new tab"
      className="relative inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg disabled:opacity-60"
    >
      <ListTodo className="w-4 h-4" />
      <span className="hidden sm:inline">{opening ? 'Opening…' : 'TaskFlow'}</span>
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center">
          {badge}
        </span>
      )}
    </button>
  );
}
