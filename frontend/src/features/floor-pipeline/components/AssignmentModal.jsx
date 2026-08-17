import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Star, User, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { assignTicket, getTeamMembers } from '../floorPipelineApi';
import { configSummary, priorityBadge, resolveTicketTtspl } from '../floorPipelineUi';
import { requiresSerialIdentity } from '../../../constants/laptopConditions';

function getRelevantTeams(stageName) {
  if (stageName === 'Floor Manager') {
    return [
      { key: 'hw', label: 'Hardware & Software', teamName: 'Hardware & Software' },
      { key: 'qc1', label: 'QC1 Team', teamName: 'QC1 Team' },
    ];
  }
  if (['Diagnosis', 'Assembly & Software', 'Final Testing', 'Chip Level Repair', 'Body & Paint'].includes(stageName)) {
    return [{ key: 'hw', label: 'Hardware & Software', teamName: 'Hardware & Software' }];
  }
  if (stageName === 'QC1') {
    return [{ key: 'qc1', label: 'QC1 Team', teamName: 'QC1 Team' }];
  }
  if (stageName === 'QC2') {
    return [{ key: 'qc2', label: 'QC2 Team', teamName: 'QC2 Team' }];
  }
  if (stageName === 'Dispatch QC') {
    return [
      { key: 'dqc', label: 'Dispatch QC', teamName: 'Dispatch QC Team' },
      { key: 'fm', label: 'Floor Manager', teamName: 'Floor Manager' },
    ];
  }
  return [
    { key: 'hw', label: 'Hardware & Software', teamName: 'Hardware & Software' },
    { key: 'qc1', label: 'QC1 Team', teamName: 'QC1 Team' },
    { key: 'qc2', label: 'QC2 Team', teamName: 'QC2 Team' },
  ];
}

export default function AssignmentModal({ ticket, open, onClose, onAssigned }) {
  const stageName = ticket?.stage_name;
  const teams = useMemo(() => getRelevantTeams(stageName), [stageName]);
  const [tab, setTab] = useState(teams[0]?.key || 'hw');
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const askPowerState = stageName === 'Floor Manager' && tab === 'hw';
  const [laptopCondition, setLaptopCondition] = useState(
    ticket?.received_condition === 'not_on' ? 'not_on' : (ticket?.received_condition === 'on' ? 'on' : '')
  );
  const [ttsplId, setTtsplId] = useState(ticket?.ttspl_id || '');
  const [serialNumber, setSerialNumber] = useState(ticket?.serial_number || '');

  const team = teams.find((t) => t.key === tab) || teams[0];
  const isSalesQc = ticket?.ticket_type === 'sales_order_qc' || ticket?.priority === 'sales_order';
  const isQcStage = ['QC1', 'QC2'].includes(stageName);
  const isDispatchQcStage = stageName === 'Dispatch QC';
  const needSerial = askPowerState && requiresSerialIdentity(laptopCondition || 'on');

  useEffect(() => {
    if (!open || !ticket) return;
    setLaptopCondition(
      ticket.received_condition === 'not_on' ? 'not_on'
        : ticket.received_condition === 'on' ? 'on'
          : ''
    );
    setTtsplId(ticket.ttspl_id || '');
    setSerialNumber(
      ticket.serial_number && ticket.serial_number !== 'NOT_ON' ? ticket.serial_number : ''
    );
  }, [open, ticket]);

  useEffect(() => {
    if (!open || !ticket || !teams.length) return;
    let defaultTab = teams[0].key;
    if (isDispatchQcStage) {
      defaultTab = teams.find((t) => t.key === 'dqc')?.key || teams[0].key;
    } else if (isSalesQc) {
      defaultTab = teams.find((t) => t.key.startsWith('qc'))?.key || teams[0].key;
    }
    setTab(defaultTab);
  }, [open, ticket, teams, isSalesQc, isDispatchQcStage]);

  useEffect(() => {
    if (!open || !ticket || !team) return;
    setLoading(true);
    getTeamMembers(team.teamName)
      .then(({ data }) => setMembers(data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [open, ticket, team?.teamName]);

  if (!open || !ticket) return null;

  const pri = priorityBadge(ticket.priority);
  const recommendedId = members.length
    ? members.reduce((best, m) => ((m.active_tickets ?? 0) < (best.active_tickets ?? 0) ? m : best)).user_id
    : null;

  const handleAssign = async (userId) => {
    if (askPowerState) {
      if (laptopCondition !== 'on' && laptopCondition !== 'not_on') {
        toast.error('Select whether the laptop is ON or NOT ON');
        return;
      }
      if (!ttsplId.trim()) {
        toast.error('TTSPL Number is required');
        return;
      }
      if (needSerial && !serialNumber.trim()) {
        toast.error('Serial Number is required when the laptop is ON');
        return;
      }
    }
    setAssigning(userId);
    try {
      const body = { user_id: userId };
      if (askPowerState) {
        body.laptop_condition = laptopCondition;
        body.ttspl_id = ttsplId.trim();
        if (needSerial || serialNumber.trim()) {
          body.serial_number = serialNumber.trim();
        }
      }
      const { data } = await assignTicket(ticket.ticket_id, body);
      if (data.success) {
        toast.success(`Assigned to ${members.find((m) => m.user_id === userId)?.name || 'technician'}`);
        onAssigned?.();
        onClose();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Assignment failed');
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-semibold text-slate-900">
              {stageName === 'Floor Manager' ? 'Assign Ticket' : 'Reassign Technician'}
            </h2>
            <p className="font-mono text-sm text-blue-700">{resolveTicketTtspl(ticket) || `#${ticket.ticket_id}`}</p>
            <p className="text-xs text-slate-500 mt-0.5">{configSummary(ticket)}</p>
            <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs font-semibold ${pri.className}`}>
              {pri.label}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {askPowerState ? (
          <div className="px-4 py-3 border-b space-y-3 bg-slate-50">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-600 mb-2">Is the laptop ON or NOT ON?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLaptopCondition('on')}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                    laptopCondition === 'on'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  ON
                </button>
                <button
                  type="button"
                  onClick={() => setLaptopCondition('not_on')}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                    laptopCondition === 'not_on'
                      ? 'border-rose-500 bg-rose-50 text-rose-800'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  NOT ON
                </button>
              </div>
            </div>
            {laptopCondition ? (
              <div className="space-y-2">
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="TTSPL Number *"
                  value={ttsplId}
                  onChange={(e) => setTtsplId(e.target.value)}
                  autoComplete="off"
                />
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder={needSerial ? 'Serial Number *' : 'Serial Number (optional)'}
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  autoComplete="off"
                />
                {laptopCondition === 'not_on' ? (
                  <p className="text-[11px] text-slate-500">
                    Serial is optional while NOT ON. If the laptop powers on later, serial will be required before diagnosis can be completed.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {teams.length > 1 ? (
          <div className="flex border-b text-sm">
            {teams.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex-1 py-2.5 font-medium ${tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-500'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4 py-2 border-b text-sm font-medium text-slate-700 bg-slate-50">
            {team?.label}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isQcStage ? (
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              Auto-assignment active — ticket will be assigned via round-robin when moved to this stage.
              Use manual assignment to override.
            </p>
          ) : null}
          {isDispatchQcStage ? (
            <p className="text-xs text-slate-600 bg-orange-50 border border-orange-200 rounded-lg p-3">
              Assign to a Dispatch QC inspector or a Floor Manager. Sales Order pre-dispatch tickets
              should not go to Hardware &amp; Software or QC1/QC2 teams.
            </p>
          ) : null}
          {isSalesQc && !isDispatchQcStage && tab === 'hw' ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Sales Order QC tickets are usually assigned directly to the QC team.
            </p>
          ) : null}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
          ) : !members.length ? (
            <p className="text-sm text-slate-500 text-center py-6">No team members found</p>
          ) : (
            members.map((m) => {
              const isRec = m.user_id === recommendedId;
              return (
                <div
                  key={m.user_id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${isRec ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200'}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <p className="font-medium text-sm truncate">{m.name}</p>
                      <p className="text-xs text-slate-500">
                        {m.active_tickets || 0} active ticket{(m.active_tickets || 0) !== 1 ? 's' : ''}
                        {isRec ? (
                          <span className="ml-1 text-blue-600 inline-flex items-center gap-0.5">
                            <Star className="w-3 h-3" /> recommended
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={assigning === m.user_id}
                    onClick={() => handleAssign(m.user_id)}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {assigning === m.user_id ? '…' : 'Assign'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t p-3">
          <button type="button" onClick={onClose} className="w-full py-2 rounded-lg border text-sm font-medium text-slate-600">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
