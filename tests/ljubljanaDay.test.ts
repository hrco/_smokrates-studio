import {describe, expect, it} from 'vitest';
import {ljubljanaDayStartMs, nextLjubljanaDayStartMs} from '../src/time/ljubljanaTime';

describe('Ljubljana day bounds', () => {
  it('uses midnight CET on a normal October day', () => {
    const noon = Date.parse('2026-10-26T20:00:00+01:00');
    expect(ljubljanaDayStartMs(noon)).toBe(Date.parse('2026-10-26T00:00:00+01:00'));
    expect(nextLjubljanaDayStartMs(noon)).toBe(Date.parse('2026-10-27T00:00:00+01:00'));
  });

  it('keeps midnight on the autumn clock change, which is a 25 hour day', () => {
    const afternoon = Date.parse('2026-10-25T12:00:00+01:00');
    expect(ljubljanaDayStartMs(afternoon)).toBe(Date.parse('2026-10-25T00:00:00+02:00'));
    expect(nextLjubljanaDayStartMs(afternoon)).toBe(Date.parse('2026-10-26T00:00:00+01:00'));
  });

  it('keeps midnight on the spring clock change, which is a 23 hour day', () => {
    const afternoon = Date.parse('2026-03-29T12:00:00+02:00');
    expect(ljubljanaDayStartMs(afternoon)).toBe(Date.parse('2026-03-29T00:00:00+01:00'));
    expect(nextLjubljanaDayStartMs(afternoon)).toBe(Date.parse('2026-03-30T00:00:00+02:00'));
  });
});
