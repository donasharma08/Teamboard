/** Pure unit tests: small functions with no database or network. */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { dueLabel, fromDateInput, pct, positionBetween, timeAgo, toDateInput, fileSize } from '../client/src/lib/format.js';
import { describe as describeActivity } from '../client/src/lib/activity.js';
import { parse, HttpError, idParam } from '../server/lib/http.js';
import { z } from 'zod';

afterEach(() => vi.useRealTimers());
const at = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };

describe('positionBetween (card ordering)', () => {
  it('puts a card between two neighbours without renumbering', () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
  });
  it('handles the top, the bottom and an empty column', () => {
    expect(positionBetween(undefined, 1024)).toBe(0);
    expect(positionBetween(2048, undefined)).toBe(3072);
    expect(positionBetween(undefined, undefined)).toBe(1024);
  });
  it('keeps order after many inserts at the same spot', () => {
    let lo = 1024, hi = 2048;
    for (let i = 0; i < 40; i++) { const mid = positionBetween(lo, hi); expect(mid).toBeGreaterThan(lo); expect(mid).toBeLessThan(hi); hi = mid; }
  });
});

describe('dueLabel (dates as people say them)', () => {
  it('says today, tomorrow, and days late', () => {
    at('2026-11-16T10:00:00');
    expect(dueLabel(new Date('2026-11-16T23:59:00').toISOString())).toBe('Due today');
    expect(dueLabel(new Date('2026-11-17T23:59:00').toISOString())).toBe('Due tomorrow');
    expect(dueLabel(new Date('2026-11-14T23:59:00').toISOString())).toBe('2 days late');
    expect(dueLabel(new Date('2026-11-15T23:59:00').toISOString())).toBe('1 day late');
    expect(dueLabel(null)).toBe('No due date');
  });
  it('does not call finished work late', () => {
    at('2026-11-16T10:00:00');
    expect(dueLabel(new Date('2026-11-10T23:59:00').toISOString(), true)).toMatch(/^Was due/);
  });
});

describe('date input round trip', () => {
  it('a picked date means the end of that day, local time', () => {
    const iso = fromDateInput('2026-12-03')!;
    expect(new Date(iso).getHours()).toBe(23);
    expect(toDateInput(iso)).toBe('2026-12-03');
    expect(fromDateInput('')).toBeNull();
  });
});

describe('small formatters', () => {
  it('formats percentages and empty values', () => {
    expect(pct(0.4)).toBe('40%');
    expect(pct(null)).toBe('—');
  });
  it('formats file sizes', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(2048)).toBe('2 KB');
    expect(fileSize(3.5 * 1048576)).toBe('3.5 MB');
  });
  it('says "just now" and "yesterday"', () => {
    at('2026-11-16T10:00:00Z');
    expect(timeAgo('2026-11-16T09:59:50Z')).toBe('just now');
    expect(timeAgo('2026-11-15T10:00:00Z')).toBe('yesterday');
  });
});

describe('activity sentences', () => {
  const base = { id: 1, created_at: '', actor_name: 'Meera' };
  it('turns events into plain sentences', () => {
    expect(describeActivity({ ...base, type: 'task.status', data: { title: 'Copy', to: 'done' } })).toBe('Meera finished "Copy"');
    expect(describeActivity({ ...base, type: 'task.status', data: { title: 'Copy', to: 'review' } })).toBe('Meera moved "Copy" to In review');
    expect(describeActivity({ ...base, type: 'task.assigned', data: { title: 'Copy', to: null } })).toBe('Meera unassigned "Copy"');
    expect(describeActivity({ ...base, type: 'something.new', data: {} })).toBe('Meera made a change');
  });
});

describe('server input helpers', () => {
  it('parse() returns clean data or a 400 that names each bad field', () => {
    const schema = z.object({ name: z.string().min(2), age: z.number() });
    expect(parse(schema, { name: 'Al', age: 3 })).toEqual({ name: 'Al', age: 3 });
    try {
      parse(schema, { name: 'A', age: 'x' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
      expect(Object.keys((e as HttpError).details as object).sort()).toEqual(['age', 'name']);
    }
  });
  it('idParam() turns anything that is not a positive whole number into 404', () => {
    expect(idParam('12')).toBe(12);
    for (const bad of ['0', '-1', '1.5', 'abc', '1; DROP TABLE']) expect(() => idParam(bad)).toThrow(HttpError);
  });
});
