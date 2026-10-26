import {describe, expect, it} from 'vitest';
import {
  addDays,
  findCurrentMonday,
  formatWeekLabel,
  readWeekFromQuery,
  toInputValue,
  toIsoWithOffset,
} from '../web/review/weekDates.js';

describe('review page week dates', () => {
  it('finds the Monday of the current week in Ljubljana, even just after midnight there', () => {
    expect(findCurrentMonday(new Date('2026-10-28T12:00:00Z'))).toBe('2026-10-26');
    expect(findCurrentMonday(new Date('2026-11-01T23:30:00Z'))).toBe('2026-11-02');
    expect(findCurrentMonday(new Date('2026-10-26T00:30:00+01:00'))).toBe('2026-10-26');
  });

  it('reads ?week= and snaps it to a Monday, ignoring junk', () => {
    expect(readWeekFromQuery('?week=2026-10-29')).toBe('2026-10-26');
    expect(readWeekFromQuery('?week=nope')).toBeUndefined();
    expect(readWeekFromQuery('')).toBeUndefined();
  });

  it('steps by weeks and labels them', () => {
    expect(addDays('2026-10-26', 7)).toBe('2026-11-02');
    expect(addDays('2026-10-26', -7)).toBe('2026-10-19');
    expect(formatWeekLabel('2026-10-26')).toBe('Week of 26 October 2026');
  });

  it('converts between the input value and an offset date-time', () => {
    expect(toInputValue('2026-10-28T18:00:00+01:00')).toBe('2026-10-28T18:00');
    expect(toIsoWithOffset('2026-10-28T18:00')).toBe('2026-10-28T18:00:00+01:00');
    expect(toIsoWithOffset('2026-08-01T18:00')).toBe('2026-08-01T18:00:00+02:00');
  });

  it('handles the clock changes: the skipped hour is refused, the repeated hour takes summer time', () => {
    expect(toIsoWithOffset('2027-03-28T02:30')).toBeNull();
    expect(toIsoWithOffset('2026-10-25T02:30')).toBe('2026-10-25T02:30:00+02:00');
  });
});
