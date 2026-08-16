import React, { useEffect, useState } from 'react';
import api from '../../../utils/api';
import { listOffline, listenOfflineFlush, flushOffline } from '../offlineQueue';

export default function OfflineBanner() {
  const [n, setN] = useState(0);
  const refresh = () => listOffline().then((rows) => setN(rows.length)).catch(() => setN(0));
  useEffect(() => {
    refresh();
    return listenOfflineFlush(api, refresh);
  }, []);
  if (!n) return null;
  return (
    <div className="rounded-md bg-pri2-bg text-pri2 px-3 py-2 text-[12px] font-semibold flex items-center justify-between gap-2">
      <span>{n} action{n === 1 ? '' : 's'} pending sync</span>
      <button
        type="button"
        className="underline min-h-[32px]"
        onClick={() => flushOffline(api).then(refresh).catch(refresh)}
      >
        Retry now
      </button>
    </div>
  );
}
