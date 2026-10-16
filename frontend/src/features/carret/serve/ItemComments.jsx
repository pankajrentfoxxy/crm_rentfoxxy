import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, DateTime, Textarea } from '../../../components/carret';
import { addItemComment } from './serveApi';
import { errMsg } from './serveShared';

/**
 * Comments on one laptop of a ticket (support_ticket_item_comments). The lead
 * writes them on the ticket record, the technician on the job — both see the
 * same thread.
 */
export default function ItemComments({ item, canWrite = true, onAdded }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const comments = item?.comments || [];

  const post = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await addItemComment(item.id, body);
      setText('');
      toast.success('Comment added');
      onAdded?.();
    } catch (e) {
      toast.error(errMsg(e, 'Could not add the comment'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="c-stack" style={{ gap: '8px' }}>
      {comments.length === 0 ? <div className="text-ink-3">No comments yet.</div> : comments.map((c) => (
        <div key={c.id} style={{ padding: '8px 12px', borderRadius: '8px', background: 'var(--surface-2, #f1f5f9)' }}>
          <div className="text-ink-3" style={{ fontSize: '12px' }}>
            <strong style={{ color: 'var(--ink-1, inherit)' }}>{c.author_name || 'Someone'}</strong>
            {c.author_role ? ` · ${String(c.author_role).replace(/_/g, ' ')}` : ''} · <DateTime value={c.created_at} />
          </div>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: '2px' }}>{c.body}</div>
        </div>
      ))}
      {canWrite && (
        <div className="c-stack" style={{ gap: '6px' }}>
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment — the lead and the technician both see it" maxLength={2000} />
          <div className="flex justify-end">
            <Button variant="primary" disabled={busy || !text.trim()} onClick={post}>{busy ? 'Posting…' : 'Add comment'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
