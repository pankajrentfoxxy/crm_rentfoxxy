import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { getBackendOrigin } from '../../utils/api';
import { getAuthToken } from '../../utils/authToken';
import { fetchDispatchPendingOrders, fetchDispatchPendingQcAlerts } from '../../utils/dispatchWorkflowApi';
import {
  filterActivePopupAlerts,
  filterActiveQcPopupAlerts,
  isPopupAlertReady,
  isSnoozeActive,
} from './dispatchAlertUtils';
import {
  mapApiOrderToRow,
  mapApiQcAlertToRow,
  mapSocketOrderToRow,
  mapSocketQcAlertToRow,
  mergeOrderRow,
  mergeQcAlertRow,
  sortPendingOrders,
  sortQcAlerts,
} from './dispatchOrderMapper';

const DispatchRealtimeContext = createContext(null);

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 180);
  } catch {
    /* optional */
  }
}

export function DispatchRealtimeProvider({ children }) {
  const { user, hasPermission } = useAuth();
  const enabled = !!user
    && (user.role === 'dispatch' || user.role === 'super_admin')
    && hasPermission('dispatch_pending_orders', 'view');
  const qcEnabled = !!user;

  const [orders, setOrders] = useState([]);
  const [qcAlerts, setQcAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [snoozeTick, setSnoozeTick] = useState(0);
  const snoozeSuppressRef = useRef(new Map());
  const qcSnoozeSuppressRef = useRef(new Map());
  const qcOverdueNotifiedRef = useRef(new Set());
  const socketRef = useRef(null);
  const initialLoadedRef = useRef(false);

  const notifyQcOverdueIfNeeded = useCallback((soNumber) => {
    const so = String(soNumber || '').trim();
    if (!so || qcOverdueNotifiedRef.current.has(so)) return;
    qcOverdueNotifiedRef.current.add(so);
    playAlertSound();
  }, []);

  const canReceiveOrder = useCallback((payload) => {
    if (!payload) return false;
    if (user?.role === 'super_admin') return true;
    return payload.assignedTo === user?.user_id;
  }, [user?.role, user?.user_id]);

  const isAssignedToMe = useCallback((assignedUserId) => (
    assignedUserId != null && Number(assignedUserId) === Number(user?.user_id)
  ), [user?.user_id]);

  const canReceiveQcAlert = useCallback((payload) => {
    if (!payload) return false;
    const assignee = payload.ticketAssigneeUserId ?? payload.assignedTo;
    return assignee != null && Number(assignee) === Number(user?.user_id);
  }, [user?.user_id]);

  const upsertOrder = useCallback((payload) => {
    const row = mapSocketOrderToRow(payload);
    if (!row?.id) return;
    setOrders((prev) => {
      const idx = prev.findIndex((o) => o.id === row.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = mergeOrderRow(next[idx], row);
        return sortPendingOrders(next);
      }
      return sortPendingOrders([...prev, row]);
    });
  }, []);

  const removeOrder = useCallback((orderId, soNumber) => {
    setOrders((prev) => prev.filter((o) => {
      if (orderId && o.id === orderId) return false;
      if (soNumber && o.sales_order_number === soNumber) return false;
      return true;
    }));
  }, []);

  const upsertQcAlert = useCallback((payload) => {
    const row = mapSocketQcAlertToRow(payload);
    if (!row?.sales_order_number && !row?.id) return;
    setQcAlerts((prev) => {
      const idx = prev.findIndex((o) => o.id === row.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = mergeQcAlertRow(next[idx], row);
        return sortQcAlerts(next);
      }
      return sortQcAlerts([...prev, row]);
    });
  }, []);

  const removeQcAlert = useCallback((orderId, soNumber) => {
    setQcAlerts((prev) => prev.filter((o) => {
      if (orderId && o.id === orderId) return false;
      if (soNumber && o.sales_order_number === soNumber) return false;
      return true;
    }));
  }, []);

  /** Keep QC SLA in realtime state when viewing a floor ticket (popup at zero without refresh). */
  const upsertQcAlertFromTicket = useCallback((payload) => {
    if (!payload?.qc_due_at || !payload.sales_order_number) return;
    const row = mapApiQcAlertToRow({
      id: payload.workflow_id || payload.id || payload.sales_order_number,
      sales_order_number: payload.sales_order_number,
      ticket_assignee_user_id: payload.ticket_assignee_user_id,
      qc_started_at: payload.qc_started_at,
      qc_due_at: payload.qc_due_at,
      qc_overdue: payload.qc_overdue,
      qc_alert_snoozed_until: payload.qc_alert_snoozed_until,
      ticket_id: payload.ticket_id,
    });
    if (!row?.sales_order_number) return;
    setQcAlerts((prev) => {
      const idx = prev.findIndex((o) => o.id === row.id || o.sales_order_number === row.sales_order_number);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = mergeQcAlertRow(next[idx], row);
        return sortQcAlerts(next);
      }
      return sortQcAlerts([...prev, row]);
    });
  }, []);

  const loadInitial = useCallback(async () => {
    if (!enabled && !qcEnabled) {
      setOrders([]);
      setQcAlerts([]);
      return;
    }
    setLoading(true);
    try {
      const ordersPromise = enabled
        ? fetchDispatchPendingOrders().then((r) => r.data?.orders || [])
        : Promise.resolve([]);
      const qcPromise = qcEnabled
        ? fetchDispatchPendingQcAlerts().then((r) => r.data?.alerts || [])
        : Promise.resolve([]);
      const [orderRows, qcRowsRaw] = await Promise.all([
        ordersPromise.catch(() => []),
        qcPromise.catch(() => []),
      ]);
      setOrders(sortPendingOrders(orderRows.map(mapApiOrderToRow)));
      setQcAlerts(sortQcAlerts(qcRowsRaw.map(mapApiQcAlertToRow)));
      initialLoadedRef.current = true;
    } catch {
      if (!enabled) setOrders([]);
      if (!qcEnabled) setQcAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, qcEnabled]);

  useEffect(() => {
    initialLoadedRef.current = false;
    loadInitial();
  }, [loadInitial, user?.user_id]);

  useEffect(() => {
    if (!qcEnabled) return undefined;
    const id = setInterval(() => {
      fetchDispatchPendingQcAlerts()
        .then(({ data }) => {
          const qcRows = (data?.alerts || []).map(mapApiQcAlertToRow);
          setQcAlerts((prev) => {
            const merged = new Map();
            [...prev, ...qcRows].forEach((row) => {
              const key = row.sales_order_number || row.id;
              if (!key) return;
              const existing = merged.get(key);
              merged.set(key, existing ? mergeQcAlertRow(existing, row) : row);
            });
            return sortQcAlerts([...merged.values()]);
          });
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [qcEnabled, user?.user_id]);

  useEffect(() => {
    if (!enabled && !qcEnabled) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setConnected(false);
      return undefined;
    }

    const token = getAuthToken();
    if (!token) return undefined;

    const socket = io(getBackendOrigin(), {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('dispatch:new-order', (payload) => {
      if (!canReceiveOrder(payload)) return;
      upsertOrder(payload);
      // Center popup waits until acceptance SLA — no sound on new assignment.
    });

    socket.on('dispatch:accepted', (payload) => {
      removeOrder(payload.orderId, payload.soNumber);
      if (isAssignedToMe(payload.assignedTo)) {
        toast.success(`Order ${payload.soNumber || ''} accepted`);
      }
    });

    socket.on('dispatch:sla-breach', (payload) => {
      if (!canReceiveOrder(payload)) return;
      upsertOrder({ ...payload, slaBreached: true, priority: 'critical' });
      if (isAssignedToMe(payload.assignedTo) && !isSnoozeActive(payload.alertSnoozedUntil)) {
        playAlertSound();
        toast.error(`SLA breached: ${payload.soNumber}`, { duration: 8000 });
      }
    });

    socket.on('dispatch:cancelled', (payload) => {
      removeOrder(payload.orderId, payload.soNumber);
    });

    socket.on('dispatch:snoozed', (payload) => {
      if (!canReceiveOrder(payload)) return;
      if (payload.alertSnoozedUntil) {
        snoozeSuppressRef.current.set(
          payload.soNumber,
          new Date(payload.alertSnoozedUntil).getTime()
        );
      }
      upsertOrder(payload);
    });

    socket.on('dispatch:qc-started', (payload) => {
      if (!canReceiveQcAlert(payload)) return;
      upsertQcAlert(payload);
    });

    socket.on('dispatch:qc-sla-breach', (payload) => {
      if (!canReceiveQcAlert(payload)) return;
      upsertQcAlert({ ...payload, qcSlaBreached: true, priority: 'critical' });
      if (canReceiveQcAlert(payload) && !isSnoozeActive(payload.qcAlertSnoozedUntil)) {
        notifyQcOverdueIfNeeded(payload.soNumber);
      }
    });

    socket.on('dispatch:qc-snoozed', (payload) => {
      if (!canReceiveQcAlert(payload)) return;
      if (payload.qcAlertSnoozedUntil) {
        qcSnoozeSuppressRef.current.set(
          payload.soNumber,
          new Date(payload.qcAlertSnoozedUntil).getTime()
        );
      }
      upsertQcAlert(payload);
    });

    socket.on('dispatch:qc-complete', (payload) => {
      removeQcAlert(payload.orderId, payload.soNumber);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [enabled, qcEnabled, canReceiveOrder, canReceiveQcAlert, isAssignedToMe, upsertOrder, removeOrder, upsertQcAlert, removeQcAlert, notifyQcOverdueIfNeeded]);

  useEffect(() => {
    if (!enabled && !qcEnabled) return undefined;
    const id = setInterval(() => setSnoozeTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [enabled, qcEnabled]);

  const applyLocalSnooze = useCallback((soNumber, snoozedUntil, remark) => {
    if (snoozedUntil) {
      snoozeSuppressRef.current.set(soNumber, new Date(snoozedUntil).getTime());
    }
    setOrders((prev) => prev.map((o) => (
      o.sales_order_number === soNumber
        ? {
          ...o,
          alert_snoozed_until: snoozedUntil,
          last_decline_remark: remark ?? o.last_decline_remark,
        }
        : o
    )));
  }, []);

  const applyLocalQcSnooze = useCallback((soNumber, snoozedUntil, remark) => {
    if (snoozedUntil) {
      qcSnoozeSuppressRef.current.set(soNumber, new Date(snoozedUntil).getTime());
      qcOverdueNotifiedRef.current.delete(soNumber);
    }
    setQcAlerts((prev) => prev.map((o) => (
      o.sales_order_number === soNumber
        ? {
          ...o,
          qc_alert_snoozed_until: snoozedUntil,
          qc_alert_snooze_remark: remark ?? o.qc_alert_snooze_remark,
        }
        : o
    )));
  }, []);

  const alertOrders = useMemo(() => {
    const mine = orders.filter((o) => isAssignedToMe(o.assigned_user_id));
    return filterActivePopupAlerts(mine, snoozeSuppressRef.current);
  }, [orders, isAssignedToMe, snoozeTick]);

  const isMyQcAlert = useCallback((row) => {
    if (!row) return false;
    return Number(user?.user_id) === Number(row.ticket_assignee_user_id);
  }, [user?.user_id]);

  const qcAlertOrders = useMemo(() => {
    const mine = qcAlerts.filter((o) => isMyQcAlert(o));
    return filterActiveQcPopupAlerts(mine, qcSnoozeSuppressRef.current);
  }, [qcAlerts, isMyQcAlert, snoozeTick]);

  const prevAlertCountRef = useRef(0);
  useEffect(() => {
    if (alertOrders.length > prevAlertCountRef.current) {
      playAlertSound();
    }
    prevAlertCountRef.current = alertOrders.length;
  }, [alertOrders.length]);

  /** Toast + sound when QC SLA is overdue (initial load, poll, or realtime). */
  useEffect(() => {
    qcAlertOrders.forEach((row) => {
      if (isMyQcAlert(row) && row.sales_order_number) {
        notifyQcOverdueIfNeeded(row.sales_order_number);
      }
    });
  }, [qcAlertOrders, isMyQcAlert, notifyQcOverdueIfNeeded]);

  const value = useMemo(() => ({
    enabled,
    qcEnabled,
    connected,
    loading,
    orders,
    alertOrders,
    qcAlerts,
    qcAlertOrders,
    count: orders.length,
    loadInitial,
    removeOrder,
    applyLocalSnooze,
    snoozeSuppressRef,
    removeQcAlert,
    applyLocalQcSnooze,
    qcSnoozeSuppressRef,
    upsertQcAlertFromTicket,
    notifyQcOverdueIfNeeded,
  }), [
    enabled,
    qcEnabled,
    connected,
    loading,
    orders,
    alertOrders,
    qcAlerts,
    qcAlertOrders,
    loadInitial,
    removeOrder,
    applyLocalSnooze,
    removeQcAlert,
    applyLocalQcSnooze,
    upsertQcAlertFromTicket,
    notifyQcOverdueIfNeeded,
  ]);

  return (
    <DispatchRealtimeContext.Provider value={value}>
      {children}
    </DispatchRealtimeContext.Provider>
  );
}

export function useDispatchRealtime() {
  const ctx = useContext(DispatchRealtimeContext);
  return ctx || {
    enabled: false,
    qcEnabled: false,
    connected: false,
    loading: false,
    orders: [],
    alertOrders: [],
    qcAlerts: [],
    qcAlertOrders: [],
    count: 0,
    loadInitial: () => {},
    removeOrder: () => {},
    applyLocalSnooze: () => {},
    snoozeSuppressRef: { current: new Map() },
    removeQcAlert: () => {},
    applyLocalQcSnooze: () => {},
    qcSnoozeSuppressRef: { current: new Map() },
    upsertQcAlertFromTicket: () => {},
    notifyQcOverdueIfNeeded: () => {},
  };
}

export default DispatchRealtimeProvider;
