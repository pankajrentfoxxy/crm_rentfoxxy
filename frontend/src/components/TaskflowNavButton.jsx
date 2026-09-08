import React, { useCallback, useEffect, useState } from 'react';
import { ListTodo } from 'lucide-react';
import toast from 'react-hot-toast';
import { getTaskflowPendingCount, getTaskflowSsoUrl } from '../utils/taskflowApi';

const POLL_MS = 45000;

export default function TaskflowNavButton() {
  const [count, setCount] = useState(0);
  const [integrationStatus, setIntegrationStatus] = useState('ok');
  const [opening, setOpening] = useState(false);

  const loadCount = useCallback(() => {
    getTaskflowPendingCount()
      .then((data) => {
        setCount(Number(data?.count || 0));
        setIntegrationStatus(data?.status || 'ok');
      })
      .catch(() => {
        setCount(0);
        setIntegrationStatus('unreachable');
      });
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
  const statusHint = {
    endpoint_missing: 'TaskFlow CRM integration is not deployed on task.rentfoxxy.com yet',
    sso_rejected: 'TaskFlow rejected CRM login — CRM_SSO_SECRET must match on both servers',
    timeout: 'TaskFlow server timed out — count unavailable',
    unreachable: 'Could not reach TaskFlow server',
    unmapped: 'Your CRM email is not linked to a TaskFlow user yet',
    taskflow_error: 'TaskFlow returned an error',
  }[integrationStatus];
  const title = statusHint
    ? `Open TaskFlow — ${statusHint}`
    : count > 0
      ? `Open TaskFlow — ${count} pending task${count === 1 ? '' : 's'}`
      : 'Open TaskFlow in a new tab';

  return (
    <button
      type="button"
      onClick={openTaskflow}
      disabled={opening}
      title={title}
      className="relative inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg disabled:opacity-60"
    >
      <ListTodo className="w-4 h-4" />
      <span className="hidden sm:inline">{opening ? 'Opening…' : 'TaskFlow'}</span>
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center">
          {badge}
        </span>
      )}
      {count === 0 && integrationStatus !== 'ok' && integrationStatus !== 'unmapped' && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white" aria-hidden />
      )}
    </button>
  );
}
