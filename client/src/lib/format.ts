const DAY = 864e5;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** "today", "tomorrow", "in 3 days", "2 days late" — the way a person would say it. */
export function dueLabel(iso: string | null, done = false): string {
  if (!iso) return 'No due date';
  const due = new Date(iso);
  const days = Math.round((+startOfDay(due) - +startOfDay(new Date())) / DAY);
  if (done) return `Was due ${shortDate(iso)}`;
  if (due.getTime() < Date.now()) {
    if (days === 0) return 'Due earlier today';
    const late = Math.abs(days);
    return late === 1 ? '1 day late' : `${late} days late`;
  }
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 7) return `Due ${due.toLocaleDateString(undefined, { weekday: 'long' })}`;
  return `Due ${shortDate(iso)}`;
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return shortDate(iso);
}

/** <input type="date"> value ↔ ISO. A date-only due date means "end of that day, your time". */
export const toDateInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const fromDateInput = (v: string) => (v ? new Date(`${v}T23:59:00`).toISOString() : null);

export const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const firstName = (name?: string | null) => (name ?? '').split(' ')[0];

export const fileSize = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

export const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/** Positions are floats so a card can drop between two others without renumbering the column. */
export function positionBetween(before?: number, after?: number) {
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return after! - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}
