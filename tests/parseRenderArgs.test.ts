import {describe, expect, it} from 'vitest';
import {parseRenderArgs} from '../src/cli/parseRenderArgs';

describe('parseRenderArgs', () => {
  it('parses slug with defaults', () => {
    expect(parseRenderArgs(['golden-hour-groove'])).toEqual({
      ok: true,
      args: {slug: 'golden-hour-groove', audioStartSeconds: 0, backgroundPath: undefined, shouldRenderStills: false},
    });
  });

  it('parses options', () => {
    const result = parseRenderArgs(['t', '--start', '12.5', '--background', '/x/a.mp4', '--stills']);
    expect(result).toEqual({
      ok: true,
      args: {slug: 't', audioStartSeconds: 12.5, backgroundPath: '/x/a.mp4', shouldRenderStills: true},
    });
  });

  it.each([
    [[]],
    [['Bad Slug']],
    [['a', '--start', '-1']],
    [['a', '--start']],
    [['a', '--background']],
    [['a', '--nope']],
    [['a', 'b']],
  ])('rejects %j', (argv) => {
    expect(parseRenderArgs(argv).ok).toBe(false);
  });
});
