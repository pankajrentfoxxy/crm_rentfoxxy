/** Local calendar date as YYYY-MM-DD (matches HTML date inputs). */
export function formatLocalDateInput(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayDateInput() {
  return formatLocalDateInput(new Date());
}

export function yesterdayDateInput() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatLocalDateInput(d);
}

/** @returns {'all'|'today'|'yesterday'|'custom'} */
export function detectDatePreset(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return 'all';
  const today = todayDateInput();
  const yesterday = yesterdayDateInput();
  if (dateFrom === today && dateTo === today) return 'today';
  if (dateFrom === yesterday && dateTo === yesterday) return 'yesterday';
  return 'custom';
}

export function dateRangeApiParams(dateFrom, dateTo) {
  const params = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  return params;
}
