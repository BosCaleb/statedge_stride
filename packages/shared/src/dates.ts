/** A date for display as dd/MM/yyyy (as in Tournament Manager). Times are stored in UTC. */
export function formatDisplayDate(value: string | Date): string {
  const d =
    typeof value === 'string'
      ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
      : value;
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Today's date as YYYY-MM-DD in UTC. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
