import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { getApiUrl } from '../utils/api';

export default function CsatPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${getApiUrl()}/support/v2/public/csat/${token}`)
      .then((r) => setInfo(r.data))
      .catch((e) => setError(e.response?.data?.message || 'This link is not valid.'));
  }, [token]);

  const submit = async (n) => {
    setScore(n);
    try {
      await axios.post(`${getApiUrl()}/support/v2/public/csat/${token}`, { score: n, comment });
      setDone(true);
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save your rating.');
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md bg-white rounded-2xl border p-6 text-center text-slate-600">{error}</div>
      </div>
    );
  }
  if (!info) return <div className="p-12 text-center text-slate-500">Loading…</div>;
  if (!info.ok || done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md bg-white rounded-2xl border p-6 text-center">
          <div className="text-lg font-semibold">Thank you</div>
          <p className="text-slate-600 mt-2">{done ? 'Your rating has been recorded.' : info.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border p-6 space-y-4">
        <div className="text-xs uppercase tracking-wide text-slate-400">Ticket {info.ticket_number}</div>
        <h1 className="text-xl font-bold">How did we do?</h1>
        <div className="flex gap-2 justify-center">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => submit(n)}
              className={`w-12 h-12 rounded-full border text-lg font-bold ${score === n ? 'bg-blue-600 text-white' : 'bg-white'}`}
            >
              {n}
            </button>
          ))}
        </div>
        <textarea
          className="w-full border rounded-lg p-2 text-sm min-h-[80px]"
          placeholder="Optional comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
    </div>
  );
}
