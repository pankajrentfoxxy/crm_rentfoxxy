import React from 'react';
import { Lock } from 'lucide-react';
import { getItemStepper, getItemStepperV3Complaint, getItemStepperV3Pickup } from '../utils';

const BRAND_ORANGE = '#fb923c';
const BRAND_ORANGE_DARK = '#f97316';

/** Scalloped stamp edge (outer bumps, inner valleys) */
function buildScallopedPath(cx, cy, outerR, innerR, lobes = 12) {
  const parts = [];
  for (let i = 0; i < lobes * 2; i += 1) {
    const angle = (Math.PI * 2 * i) / (lobes * 2) - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${parts.join(' ')} Z`;
}

/** Completed step: outer ring + scalloped seal + check (Rentfoxxy light orange) */
function VerifiedBadgeIcon() {
  const seal = buildScallopedPath(14, 14, 8.6, 7.1, 12);

  return (
    <svg
      className="support-stepper-verified-svg"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="14" cy="14" r="12.25" stroke={BRAND_ORANGE} strokeWidth="1.35" fill="none" />
      <path d={seal} fill={BRAND_ORANGE} stroke={BRAND_ORANGE_DARK} strokeWidth="0.4" />
      <path
        d="M9.8 14.1 L12.6 16.9 L18.4 11.1"
        stroke="#fff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ItemStepper({ item, replacementOrder }) {
  let config;
  if (item.item_type === 'complaint' && item.effective_current_step) {
    config = getItemStepperV3Complaint(item);
  } else if (item.item_type === 'pickup' && item.effective_current_step) {
    config = getItemStepperV3Pickup(item);
  } else {
    config = getItemStepper(item, replacementOrder);
  }
  const { steps, currentIndex, completedThrough } = config;
  const terminal = ['resolved', 'closed', 'inventory_updated'].includes(item.status);

  return (
    <div className="support-stepper" role="list" aria-label="Item progress">
      {steps.map((step, index) => {
        const done =
          index <= completedThrough || (index === currentIndex && terminal);
        const active = index === currentIndex && !done;
        const state = done ? 'done' : active ? 'active' : 'locked';

        return (
          <div key={step.key} className={`support-stepper-step support-stepper-step--${state}`} role="listitem">
            {index > 0 && (
              <span
                className={`support-stepper-line${index <= completedThrough ? ' done' : ''}`}
                aria-hidden
              />
            )}
            <span className={`support-stepper-dot ${state}`} title={step.label}>
              {done ? <VerifiedBadgeIcon /> : <Lock className="support-stepper-lock-icon" strokeWidth={2.25} />}
            </span>
            <span className={`support-stepper-label ${state}`}>{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}
