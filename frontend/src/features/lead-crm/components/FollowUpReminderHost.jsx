import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Clock, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { ackFollowUpReminder, getFollowUpReminders } from '../leadCrmApi';

const POLL_MS = 30 * 1000;
const SNOOZE_MINUTES = 5;

function isSalesTeamUser(user) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'sales') return true;
  if (['admin', 'manager', 'super_admin'].includes(role)) return false;
  const perms = user?.permissions || user?.effective_permissions || [];
  return Array.isArray(perms) && perms.includes('sales_access');
}

function reminderKey(reminder) {
  return `${reminder.leadId}:${reminder.followUpAt}`;
}

function formatFollowUpDisplay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Sales-team-only follow-up reminders.
 * Polls every ~45s for follow-ups due in the next 2 minutes (assigned to me).
 * Does nothing for Admin / other module roles.
 */
export default function FollowUpReminderHost() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [queue, setQueue] = useState([]);
  const [active, setActive] = useState(null);
  const shownKeysRef = useRef(new Set());
  const busyRef = useRef(false);

  const salesOnly = isSalesTeamUser(user);

  const acknowledge = useCallback(async (reminder, action, snoozeMinutes) => {
    if (!reminder) return;
    try {
      await ackFollowUpReminder(reminder.leadId, {
        follow_up_at: reminder.followUpAt,
        action,
        snooze_minutes: snoozeMinutes,
      });
    } catch {
      /* keep UI responsive even if ack fails briefly */
    }
  }, []);

  const closeActive = useCallback(() => {
    setActive(null);
    setQueue((prev) => {
      if (!prev.length) return prev;
      const [, ...rest] = prev;
      return rest;
    });
  }, []);

  const poll = useCallback(async () => {
    if (!salesOnly || busyRef.current) return;
    busyRef.current = true;
    try {
      const { data } = await getFollowUpReminders();
      const list = Array.isArray(data?.reminders) ? data.reminders : [];
      const fresh = [];
      for (const rem of list) {
        const key = reminderKey(rem);
        if (shownKeysRef.current.has(key)) continue;
        shownKeysRef.current.add(key);
        fresh.push(rem);
        // Mark as shown immediately so other polls / tabs don't duplicate.
        acknowledge(rem, 'shown');
      }
      if (fresh.length) {
        setQueue((prev) => {
          const existing = new Set(prev.map(reminderKey));
          const merged = [...prev];
          for (const rem of fresh) {
            if (!existing.has(reminderKey(rem))) merged.push(rem);
          }
          return merged;
        });
      }
    } catch {
      /* ignore transient poll errors */
    } finally {
      busyRef.current = false;
    }
  }, [salesOnly, acknowledge]);

  useEffect(() => {
    if (!salesOnly) return undefined;
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [salesOnly, poll]);

  useEffect(() => {
    if (!active && queue.length) {
      setActive(queue[0]);
    }
  }, [queue, active]);

  // When follow-up is rescheduled, server won't return old key; clear stale client keys occasionally.
  useEffect(() => {
    if (!salesOnly) return undefined;
    const id = setInterval(() => {
      // Keep set bounded — drop keys older than a day is hard without timestamps;
      // reset if it grows large.
      if (shownKeysRef.current.size > 200) shownKeysRef.current.clear();
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [salesOnly]);

  if (!salesOnly || !active) return null;

  const minutesLabel = active.minutesUntil <= 0
    ? 'Due now'
    : `In ${active.minutesUntil} min`;

  const handleOpen = () => {
    const leadId = active.leadId;
    acknowledge(active, 'dismissed');
    closeActive();
    navigate(`/lead-crm/leads/${leadId}`, { state: { focusTab: 0, fromFollowUpReminder: true } });
  };

  const handleDismiss = () => {
    acknowledge(active, 'dismissed');
    closeActive();
  };

  const handleSnooze = () => {
    const key = reminderKey(active);
    shownKeysRef.current.delete(key); // allow re-show after snooze expires
    acknowledge(active, 'snooze', SNOOZE_MINUTES);
    closeActive();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div
        role="alertdialog"
        aria-labelledby="followup-reminder-title"
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-amber-200 overflow-hidden"
      >
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-white flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 shrink-0" />
            <div>
              <h3 id="followup-reminder-title" className="font-semibold text-sm">
                Follow-up reminder
              </h3>
              <p className="text-xs text-amber-50">{minutesLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1 rounded-lg hover:bg-white/20"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Lead</p>
            <p className="font-semibold text-gray-900">{active.leadName}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Customer</p>
            <p className="font-medium text-gray-800">{active.customerName}</p>
          </div>
          <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <Clock className="w-4 h-4 shrink-0" />
            <span className="font-medium">{formatFollowUpDisplay(active.followUpAt)} (IST)</span>
          </div>
        </div>

        <div className="px-4 pb-4 flex flex-wrap gap-2 justify-end border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={handleDismiss}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleSnooze}
            className="px-3 py-2 text-sm border border-amber-200 text-amber-800 rounded-lg hover:bg-amber-50"
          >
            Snooze {SNOOZE_MINUTES}m
          </button>
          <button
            type="button"
            onClick={handleOpen}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Open Lead
          </button>
        </div>
      </div>
    </div>
  );
}
