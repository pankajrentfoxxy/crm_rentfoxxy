import React, { useRef } from 'react';

export default function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const digits = String(value || '').padEnd(6, ' ').slice(0, 6).split('');

  const setDigit = (index, char) => {
    const clean = char.replace(/\D/g, '').slice(-1);
    const next = digits.map((d, i) => (i === index ? clean : d.trim())).join('').slice(0, 6);
    onChange(next.replace(/\s/g, ''));
    if (clean && index < 5) refs.current[index + 1]?.focus();
  };

  return (
    <div className="flex gap-2" role="group" aria-label="OTP">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="tel"
          inputMode="numeric"
          maxLength={1}
          value={digit.trim()}
          disabled={disabled}
          onChange={(e) => setDigit(index, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digit.trim() && index > 0) refs.current[index - 1]?.focus();
          }}
          className="w-11 h-12 text-center text-lg border border-slate-300 rounded-lg min-h-[44px] min-w-[44px]"
        />
      ))}
    </div>
  );
}
