import {describe, expect, it} from 'vitest';
import {parseRenderArgs} from '../src/cli/parseRenderArgs';

describe('parseRenderArgs', () => {
  it('parses slug with defaults', () => {
    expect(parseRenderArgs(['golden-hour-groove', '--label', 'label_on'])).toEqual({
      ok: true,
      args: {slug: 'golden-hour-groove', audioStartSeconds: 0, backgroundPath: undefined, shouldRenderStills: false, labelDecision: 'label_on'},
    });
  });

  it('parses options', () => {
    const result = parseRenderArgs(['t', '--label', 'label_off', '--start', '12.5', '--background', '/x/a.mp4', '--stills']);
    expect(result).toEqual({
      ok: true,
      args: {slug: 't', audioStartSeconds: 12.5, backgroundPath: '/x/a.mp4', shouldRenderStills: true, labelDecision: 'label_off'},
    });
  });

  it('requires a label decision and says so', () => {
    const result = parseRenderArgs(['golden-hour-groove']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('missing --label');
  });

  it.each([
    [['a', '--label']],
    [['a', '--label', 'maybe']],
    [['a', '--label', 'ai']],
    [[]],
    [['Bad Slug', '--label', 'label_on']],
    [['a', '--label', 'label_on', '--start', '-1']],
    [['a', '--label', 'label_on', '--start']],
    [['a', '--label', 'label_on', '--background']],
    [['a', '--label', 'label_on', '--nope']],
    [['a', 'b', '--label', 'label_on']],
  ])('rejects %j', (argv) => {
    expect(parseRenderArgs(argv).ok).toBe(false);
  });
});
