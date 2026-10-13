import React from 'react';
import { Badge } from '../../../components/ui/primitives';
import { LOAN_STATUS, POLICY_DECISION } from '../loanConstants';

export default function LoanStatusBadge({ status }) {
  const s = LOAN_STATUS[status] || { label: status || '—', tone: 'gray' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function PolicyBadge({ decision }) {
  const d = POLICY_DECISION[decision] || { label: decision || '—', tone: 'gray' };
  return <Badge tone={d.tone}>{d.label}</Badge>;
}
