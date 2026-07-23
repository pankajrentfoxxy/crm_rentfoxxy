import React, { useState } from 'react';
import { Search } from 'lucide-react';
import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';
import { normalizeTtsplSearchInput } from '../../../utils/ttspl';

export default function TtsplHistorySearchPage() {
  const [input, setInput] = useState('');
  const [ttsplId, setTtsplId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const onSubmit = (e) => {
    e.preventDefault();
    const q = normalizeTtsplSearchInput(input);
    if (!q) return;
    setTtsplId(q);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-900">TTSPL History</h2>
      <p className="text-sm text-slate-600 max-w-2xl">
        Search by TTSPL ID to view lifecycle timeline, config changes, parts installed, and cost summary.
        You can enter the number only (e.g. <span className="font-mono">3424</span>) or the full code (e.g. <span className="font-mono">TTSPL3424</span>).
      </p>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <form onSubmit={onSubmit} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-sm font-medium text-slate-700 mb-1">TTSPL ID</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono uppercase"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="3424 or TTSPL3424"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-sky-700 text-white px-4 py-2 text-sm"
          >
            <Search className="w-4 h-4" />
            View history
          </button>
        </form>
      </div>

      <TtsplHistoryDrawer
        ttsplId={ttsplId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
