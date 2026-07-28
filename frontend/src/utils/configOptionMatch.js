/**
 * Fuzzy-match a raw asset-config value (as stored on a ticket / production asset,
 * e.g. "I5", "16", "512 SSD", "10th") to the canonical option string used by the
 * cascade catalog dropdowns (e.g. "Intel Core i5", "16 GB", "512 GB SSD",
 * "10th Gen"). Returns the matching option, or null when no confident match.
 *
 * Only used to pre-select dropdowns when editing an existing configuration — it
 * never invents a value, it only snaps to an option that actually exists.
 */

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const firstNumber = (s) => {
  const m = String(s ?? '').match(/\d+(?:\.\d+)?/);
  return m ? m[0] : null;
};

const storageType = (s) => {
  const t = norm(s);
  if (/\bssd\b/.test(t) || /\bnvme\b/.test(t)) return 'ssd';
  if (/\bhdd\b/.test(t) || /\bsata\b/.test(t)) return 'hdd';
  if (/\bemmc\b/.test(t)) return 'emmc';
  return null;
};

const processorToken = (s) => {
  const t = norm(s);
  const i = t.match(/\bi[3579]\b/);
  if (i) return i[0];
  const ryzen = t.match(/ryzen\s*[3579]/);
  if (ryzen) return ryzen[0].replace(/\s+/g, ' ');
  if (/celeron/.test(t)) return 'celeron';
  if (/pentium/.test(t)) return 'pentium';
  const apple = t.match(/\bm[123]\b/);
  if (apple) return apple[0];
  return null;
};

export function matchConfigOption(raw, options, field) {
  const value = String(raw ?? '').trim();
  if (!value || !Array.isArray(options) || !options.length) return null;

  const nv = norm(value);

  // 1) Exact (case/format-insensitive) match.
  const exact = options.find((o) => norm(o) === nv);
  if (exact) return exact;

  // 2) RAM / storage — match on the numeric capacity (+ media type for storage).
  if (field === 'ram' || field === 'storage') {
    const rn = firstNumber(value);
    if (rn) {
      const sameNum = options.filter((o) => firstNumber(o) === rn);
      if (sameNum.length === 1) return sameNum[0];
      if (sameNum.length > 1 && field === 'storage') {
        const vt = storageType(value);
        if (vt) {
          const typed = sameNum.find((o) => storageType(o) === vt);
          if (typed) return typed;
        }
      }
      if (sameNum.length) return sameNum[0];
    }
  }

  // 3) Generation — match on the generation number ("10th" -> "10th Gen").
  if (field === 'generation') {
    const rn = firstNumber(value);
    if (rn) {
      const hit = options.find((o) => firstNumber(o) === rn);
      if (hit) return hit;
    }
  }

  // 4) Processor — match on the family token ("i5" -> "Intel Core i5").
  if (field === 'processor') {
    const vt = processorToken(value);
    if (vt) {
      const byToken = options.find((o) => processorToken(o) === vt)
        || options.find((o) => norm(o).includes(vt));
      if (byToken) return byToken;
    }
  }

  // 5) Substring containment either direction.
  const contained = options.find((o) => {
    const no = norm(o);
    return no.includes(nv) || nv.includes(no);
  });
  if (contained) return contained;

  // 6) Token-overlap fallback (mostly for brand / model where wording varies).
  if (field === 'model_name' || field === 'brand') {
    const vtokens = new Set(nv.split(' ').filter(Boolean));
    let best = null;
    let bestScore = 0;
    options.forEach((o) => {
      const score = norm(o).split(' ').filter(Boolean)
        .reduce((acc, tok) => acc + (vtokens.has(tok) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    });
    if (best && bestScore > 0) return best;
  }

  return null;
}

export default matchConfigOption;
