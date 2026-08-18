import React from 'react';

export default function Placeholder({ screen, title }) {
  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold">Screen {screen}</div>
      <h1 className="text-[19px] font-bold tracking-tight text-sup-ink">{title}</h1>
      <div className="mt-6 border border-dashed border-sup-line rounded-[10px] p-10 text-center text-sup-muted text-[12px]">
        Not built yet — see <code className="font-mono">docs/support-revamp/support-ui-mockup.html</code>
      </div>
    </div>
  );
}
