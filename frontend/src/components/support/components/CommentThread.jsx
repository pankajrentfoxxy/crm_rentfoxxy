import React from 'react';
import { formatRelative, initials, isLeadRole } from '../utils';

export default function CommentThread({ comments, draft, onDraftChange, onPost, posting }) {
  return (
    <section className="support-comments">
      <ul className="space-y-3">
        {(comments || []).map((c) => {
          const lead = isLeadRole(c.author_role);
          return (
            <li key={c.id} className="flex gap-2">
              <span className={`support-comment-avatar ${lead ? 'lead' : 'tech'}`}>{initials(c.author_name)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-800">{c.author_name}</span>
                  <span className="support-role-tag">{lead ? 'Team Lead' : 'Technician'}</span>
                  <span>{formatRelative(c.created_at)}</span>
                </div>
                <p className="support-comment-bubble">{c.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 space-y-2">
        <textarea
          className="w-full border border-slate-300 rounded-lg p-3 min-h-[72px] text-base"
          placeholder="Add comment"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
        />
        <button type="button" className="support-btn-primary" disabled={posting || !draft.trim()} onClick={onPost}>
          Post
        </button>
      </div>
    </section>
  );
}
