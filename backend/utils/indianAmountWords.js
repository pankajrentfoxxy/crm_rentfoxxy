'use strict';

const BELOW_20 = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function twoDigits(n) {
  if (n < 20) return BELOW_20[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u ? `${TENS[t]} ${BELOW_20[u]}` : TENS[t];
}

function threeDigits(n) {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h && rest) return `${BELOW_20[h]} hundred ${twoDigits(rest)}`;
  if (h) return `${BELOW_20[h]} hundred`;
  return twoDigits(rest);
}

function sectionToWords(n, label) {
  if (!n) return '';
  return `${threeDigits(n)} ${label}`.trim();
}

/** Convert INR amount to Indian English words (lakhs/crores). */
function amountInIndianWords(amount) {
  const n = Math.abs(Number(amount || 0));
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'Rupees zero only';

  const parts = [];
  let rem = rupees;
  const crore = Math.floor(rem / 10000000);
  rem %= 10000000;
  const lakh = Math.floor(rem / 100000);
  rem %= 100000;
  const thousand = Math.floor(rem / 1000);
  rem %= 1000;
  const hundred = rem;

  if (crore) parts.push(sectionToWords(crore, crore === 1 ? 'crore' : 'crore'));
  if (lakh) parts.push(sectionToWords(lakh, lakh === 1 ? 'lakh' : 'lakh'));
  if (thousand) parts.push(sectionToWords(thousand, thousand === 1 ? 'thousand' : 'thousand'));
  if (hundred) parts.push(threeDigits(hundred));

  let words = parts.join(' ').replace(/\s+/g, ' ').trim();
  words = words.charAt(0).toUpperCase() + words.slice(1);
  let out = `Rupees ${words}`;
  if (paise) out += ` and ${twoDigits(paise)} paise`;
  return `${out} only`;
}

module.exports = { amountInIndianWords };
