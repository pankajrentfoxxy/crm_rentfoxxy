import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { snoozeDispatchQcAlert } from '../../utils/dispatchWorkflowApi';
import { useDispatchRealtime } from '../../features/dispatch/DispatchRealtimeProvider';
import DispatchQcReminderModal, { isDispatchQcTicketAssignee } from './DispatchQcReminderModal';

export default function DispatchQcReminderAlert() {
  const location = useLocation();
  const { user } = useAuth();
  const {
    qcAlertOrders,
    applyLocalQcSnooze,
  } = useDispatchRealtime();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [remark, setRemark] = useState('');
  const [snoozeMinutes, setSnoozeMinutes] = useState(5);
  const [snoozing, setSnoozing] = useState(false);

  const safeIndex = qcAlertOrders.length
    ? Math.min(currentIndex, qcAlertOrders.length - 1)
    : 0;
  const alert = qcAlertOrders[safeIndex] || null;
  const isAssignee = isDispatchQcTicketAssignee(user, alert);
  const onSameTicket = alert?.ticket_id
    && location.pathname === `/floor-pipeline/tickets/${alert.ticket_id}`;
  const showModal = !!alert && isAssignee && !onSameTicket;

  const handleSnooze = async () => {
    if (!alert || snoozing) return;
    const trimmed = String(remark || '').trim();
    if (!trimmed) {
      toast.error('Remark is required to snooze');
      return;
    }
    setSnoozing(true);
    try {
      const { data } = await snoozeDispatchQcAlert(alert.sales_order_number, {
        remark: trimmed,
        snoozeMinutes,
      });
      applyLocalQcSnooze(alert.sales_order_number, data.snoozed_until, trimmed);
      toast.success(`QC reminder snoozed for ${data.snooze_minutes || snoozeMinutes} min`);
      setRemark('');
      if (qcAlertOrders.length <= 1) return;
      setCurrentIndex((i) => Math.min(i, qcAlertOrders.length - 2));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not snooze alert');
    } finally {
      setSnoozing(false);
    }
  };

  return (
    <DispatchQcReminderModal
      open={showModal}
      alert={alert}
      queueLabel={qcAlertOrders.length > 1 ? `Alert ${safeIndex + 1} of ${qcAlertOrders.length} pending QC` : null}
      remark={remark}
      snoozeMinutes={snoozeMinutes}
      snoozing={snoozing}
      onRemarkChange={setRemark}
      onSnoozeMinutesChange={setSnoozeMinutes}
      onSnooze={handleSnooze}
    />
  );
}
