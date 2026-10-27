import {describe, expect, it} from 'vitest';
import {parseRenderArgs} from '../src/cli/parseRenderArgs';

describe('parseRenderArgs', () => {
  it('parses slug with defaults', () => {
    expect(parseRenderArgs(['golden-hour-groove'])).toEqual({
      ok: true,
      args: {
        slug: 'golden-hour-groove',
        format: 'reel',
        audioStartSeconds: 0,
        shouldRenderStills: false,
        shouldSkipVideo: false,
        shouldDrawSafeZone: false,
      },
    });
  });

  it('parses options', () => {
    const result = parseRenderArgs(['t', '--format', 'card', '--start', '12.5', '--background', '/x/a.mp4', '--stills']);
    expect(result).toEqual({
      ok: true,
      args: {
        slug: 't',
        format: 'card',
        audioStartSeconds: 12.5,
        backgroundPath: '/x/a.mp4',
        shouldRenderStills: true,
        shouldSkipVideo: false,
        shouldDrawSafeZone: false,
      },
    });
  });

  it('parses the reel options', () => {
    const result = parseRenderArgs([
      't', '--intro', '/x/i.mp4', '--loop', '/x/l.mp4', '--still', '/x/s.png',
      '--duration', '12', '--stills-only', '--safe-zone',
    ]);
    expect(result).toEqual({
      ok: true,
      args: {
        slug: 't',
        format: 'reel',
        audioStartSeconds: 0,
        durationSeconds: 12,
        introPath: '/x/i.mp4',
        loopPath: '/x/l.mp4',
        stillPath: '/x/s.png',
        shouldRenderStills: true,
        shouldSkipVideo: true,
        shouldDrawSafeZone: true,
      },
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
    [['a', '--format', 'square']],
    [['a', '--format']],
    [['a', '--intro']],
    [['a', '--loop', '--stills']],
    [['a', '--duration', '0']],
    [['a', '--background', '/x/a.mp4']],
    [['a', '--format', 'card', '--loop', '/x/a.mp4']],
    [['a', '--format', 'card', '--duration', '10']],
    [['a', '--safe-zone']],
  ])('rejects %j', (argv) => {
    expect(parseRenderArgs(argv).ok).toBe(false);
  });
});
