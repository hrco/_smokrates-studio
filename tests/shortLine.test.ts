import {describe, expect, it} from 'vitest';
import {deriveShortLineFromTitle, pickShortLine} from '../src/cli/shortLine';

describe('deriveShortLineFromTitle', () => {
  it('uppercases and drops filler words', () => {
    expect(deriveShortLineFromTitle('Golden Hour Groove')).toBe('GOLDEN HOUR');
    expect(deriveShortLineFromTitle('100% Riddim')).toBe('100% RIDDIM');
  });

  it('keeps the title when only filler words are left', () => {
    expect(deriveShortLineFromTitle('Groove')).toBe('GROOVE');
  });
});

describe('pickShortLine', () => {
  const title = 'Golden Hour Groove';

  it('prefers an explicit shortLine in song.json', () => {
    expect(pickShortLine({shortLine: 'late sun', art: {cover: 'Short line: OTHER.'}}, title)).toBe('LATE SUN');
    expect(pickShortLine({short_line: 'Late sun'}, title)).toBe('LATE SUN');
  });

  it('reads the line printed on the cover from art.cover', () => {
    const cover = 'Square 1:1. He stands on the top step. Short line: GOLDEN HOUR.';
    expect(pickShortLine({art: {cover}}, 'Something Else')).toBe('GOLDEN HOUR');
  });

  it('falls back to the title when song.json has nothing', () => {
    expect(pickShortLine({}, title)).toBe('GOLDEN HOUR');
    expect(pickShortLine(null, title)).toBe('GOLDEN HOUR');
    expect(pickShortLine({art: {cover: 'no line here'}}, title)).toBe('GOLDEN HOUR');
  });
});
