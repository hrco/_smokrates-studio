import {describe, expect, it} from 'vitest';
import {hasHealthClaim} from '../src/api/healthClaims';
import {parseEpisodeUpdate} from '../src/api/parseEpisodeInput';
import {parsePlanImport, parseWeekStart} from '../src/api/parsePlanImport';

function buildEpisode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    night: 1,
    format: 'track_card',
    trackSlug: 'golden-hour-groove',
    startSecond: 12,
    durationSeconds: 15,
    caption: 'Golden Hour Groove',
    claim: 'New dub every night',
    publishAt: '2026-10-27T18:00:00+01:00',
    labelDecision: 'label_off',
    ...overrides,
  };
}

function buildImport(episodes: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {weekStart: '2026-10-26', episodes, ...extra};
}

function expectFailure(result: {ok: boolean}, expected: {field: string; message?: string}): void {
  expect(result).toMatchObject({ok: false, field: expected.field});
  if (expected.message !== undefined) expect(result).toMatchObject({message: expected.message});
}

describe('parsePlanImport', () => {
  it('parses a valid week into typed episodes', () => {
    const result = parsePlanImport(buildImport([buildEpisode(), buildEpisode({night: 2, groksPrompt: undefined})]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.shouldReplace).toBe(false);
    expect(result.value.episodes[0]).toMatchObject({
      night: 1,
      publishAtMs: Date.parse('2026-10-27T18:00:00+01:00'),
      labelDecision: 'label_off',
    });
  });

  it('reads replace and a scene prompt', () => {
    const scene = buildEpisode({format: 'scene', groksPrompt: 'A man walks a night road, rain, neon blue'});
    const result = parsePlanImport(buildImport([scene], {replace: true}));
    expect(result.ok && result.value.shouldReplace).toBe(true);
    expect(result.ok && result.value.episodes[0]?.groksPrompt).toBe('A man walks a night road, rain, neon blue');
  });

  it.each([
    ['night', {night: undefined}, 'episodes[0].night'],
    ['trackSlug', {trackSlug: undefined}, 'episodes[0].trackSlug'],
    ['labelDecision', {labelDecision: undefined}, 'episodes[0].labelDecision'],
    ['publishAt', {publishAt: undefined}, 'episodes[0].publishAt'],
  ])('refuses a missing %s and names the field', (_name, overrides, field) => {
    expectFailure(parsePlanImport(buildImport([buildEpisode(overrides)])), {field});
  });

  it.each([
    ['format', {format: 'reel'}, 'episodes[0].format'],
    ['labelDecision', {labelDecision: 'maybe'}, 'episodes[0].labelDecision'],
    ['night 8', {night: 8}, 'episodes[0].night'],
    ['night 0', {night: 0}, 'episodes[0].night'],
    ['duration 0', {durationSeconds: 0}, 'episodes[0].durationSeconds'],
    ['duration 61', {durationSeconds: 61}, 'episodes[0].durationSeconds'],
    ['negative start', {startSecond: -1}, 'episodes[0].startSecond'],
    ['publishAt without offset', {publishAt: '2026-10-27T18:00:00'}, 'episodes[0].publishAt'],
    ['publishAt garbage', {publishAt: 'tomorrow'}, 'episodes[0].publishAt'],
    ['slug with spaces', {trackSlug: 'Golden Hour'}, 'episodes[0].trackSlug'],
    ['unknown key', {extra: 1}, 'episodes[0].extra'],
  ])('refuses a bad %s', (_name, overrides, field) => {
    expectFailure(parsePlanImport(buildImport([buildEpisode(overrides)])), {field});
  });

  it('refuses more than 7 nights', () => {
    const episodes = Array.from({length: 8}, (_, index) => buildEpisode({night: (index % 7) + 1}));
    expectFailure(parsePlanImport(buildImport(episodes)), {field: 'episodes'});
  });

  it('refuses a night that appears twice', () => {
    expectFailure(parsePlanImport(buildImport([buildEpisode(), buildEpisode()])), {field: 'episodes[1].night'});
  });

  it('accepts a duration on either bound', () => {
    expect(parsePlanImport(buildImport([buildEpisode({durationSeconds: 1})])).ok).toBe(true);
    expect(parsePlanImport(buildImport([buildEpisode({durationSeconds: 60})])).ok).toBe(true);
  });

  it('refuses a weekStart that is not a Monday', () => {
    expectFailure(parsePlanImport({weekStart: '2026-10-27', episodes: []}), {field: 'weekStart'});
  });

  it('refuses a body that is not an object', () => {
    expectFailure(parsePlanImport('hello'), {field: 'body'});
  });

  it.each(['SMOKRATES', 'smokrates', 'SmOkRaTeS'])('refuses a Grok prompt that names %s', (name) => {
    const scene = buildEpisode({format: 'scene', groksPrompt: `A poster that says ${name}`});
    expectFailure(parsePlanImport(buildImport([scene])), {
      field: 'episodes[0].groksPrompt',
      message: 'The Grok prompt names SMOKRATES.',
    });
  });

  it.each(['#1f4e8c', '#FFF', '#ff00ffaa'])('refuses a Grok prompt with the hex code %s', (code) => {
    const scene = buildEpisode({format: 'scene', groksPrompt: `A wall painted ${code}`});
    expectFailure(parsePlanImport(buildImport([scene])), {field: 'episodes[0].groksPrompt'});
  });

  it('trims a caption and refuses one that is blank or past 2200 characters', () => {
    const trimmed = parsePlanImport(buildImport([buildEpisode({caption: '  Golden Hour Groove  '})]));
    expect(trimmed.ok && trimmed.value.episodes[0]?.caption).toBe('Golden Hour Groove');

    expectFailure(parsePlanImport(buildImport([buildEpisode({caption: '   '})])), {field: 'episodes[0].caption'});
    expectFailure(parsePlanImport(buildImport([buildEpisode({caption: 'a'.repeat(2201)})])), {
      field: 'episodes[0].caption',
      message: 'episodes[0].caption is longer than 2200 characters.',
    });
    expect(parsePlanImport(buildImport([buildEpisode({caption: 'a'.repeat(2200)})])).ok).toBe(true);
  });

  it('refuses a Grok prompt on a format that is not scene', () => {
    expectFailure(parsePlanImport(buildImport([buildEpisode({groksPrompt: 'A road'})])), {
      field: 'episodes[0].groksPrompt',
    });
  });

  it.each([
    ['caption', 'Music to help you sleep', 'The caption makes a health claim.'],
    ['claim', 'Reduces anxiety', 'The claim makes a health claim.'],
    ['groksPrompt', 'A man in therapy', 'The Grok prompt makes a health claim.'],
  ])('refuses a health claim in the %s', (key, text, message) => {
    const episode = buildEpisode({format: 'scene', groksPrompt: 'A road', [key]: text});
    expectFailure(parsePlanImport(buildImport([episode])), {field: `episodes[0].${key}`, message});
  });
});

describe('parseEpisodeUpdate', () => {
  it('parses the fields that are present', () => {
    const result = parseEpisodeUpdate({caption: 'New words', publishAt: '2026-10-28T19:00:00+01:00', startSecond: 4});
    expect(result).toEqual({
      ok: true,
      value: {caption: 'New words', publishAtMs: Date.parse('2026-10-28T19:00:00+01:00'), startSecond: 4},
    });
  });

  it('refuses an empty update', () => {
    expectFailure(parseEpisodeUpdate({}), {field: 'body', message: 'Send at least one field to change.'});
  });

  it('refuses a field the contract does not have', () => {
    expectFailure(parseEpisodeUpdate({claim: 'x'}), {field: 'claim'});
  });

  it('refuses a health claim in the caption with the update wording', () => {
    expectFailure(parseEpisodeUpdate({caption: 'A cure for stress'}), {
      field: 'caption',
      message: 'That caption makes a health claim.',
    });
  });

  it('refuses a bad label decision', () => {
    expectFailure(parseEpisodeUpdate({labelDecision: 'on'}), {field: 'labelDecision'});
  });
});

describe('parseWeekStart', () => {
  it('accepts a Monday and refuses other days and impossible dates', () => {
    expect(parseWeekStart('2026-10-26').ok).toBe(true);
    expect(parseWeekStart('2026-10-25').ok).toBe(false);
    expect(parseWeekStart('2026-02-30').ok).toBe(false);
    expect(parseWeekStart('nope').ok).toBe(false);
  });
});

describe('hasHealthClaim', () => {
  it.each(['health', 'Sleep well', 'less ANXIETY', 'focus mode', 'a cure', 'healing sounds', 'therapy', 'stress   relief'])(
    'flags %s',
    (text) => expect(hasHealthClaim(text)).toBe(true),
  );

  it.each(['secure the night', 'Golden Hour Groove', 'stress test', 'a dub for late drives'])('passes %s', (text) =>
    expect(hasHealthClaim(text)).toBe(false),
  );
});
