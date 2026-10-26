import {describe, expect, it} from 'vitest';
import {buildPublishSidecar, toShortLine} from '../src/publish/buildCaption';

describe('toShortLine', () => {
  it('keeps only the first sentence', () => {
    expect(toShortLine('Warm dub. Late and unhurried.')).toBe('Warm dub');
  });

  it('cuts long sentences at the last clause boundary that fits', () => {
    const line = toShortLine('Warm golden-hour funky dub that flows without drops, late and unhurried.');
    expect(line).toBe('Warm golden-hour funky dub that flows without drops');
  });

  it('cuts at a semicolon when that is the clause boundary that fits', () => {
    expect(toShortLine('Warm golden-hour dub; late and unhurried under a wide quiet sky tonight please')).toBe(
      'Warm golden-hour dub',
    );
  });

  it('falls back to a word boundary when no clause boundary fits', () => {
    const line = toShortLine('Deep slow bass meditation for long night drives under a quiet sky over the lake');
    expect(line.length).toBeLessThanOrEqual(60);
    expect(line).toBe('Deep slow bass meditation for long night drives under a');
  });
});

describe('buildPublishSidecar', () => {
  const sidecar = buildPublishSidecar({
    slug: 'golden-hour-groove',
    title: 'Golden Hour Groove',
    theme: 'Warm golden-hour funky dub. Late.',
  });

  it('starts the caption with the title and a hook', () => {
    expect(sidecar.caption.split('\n')[0]).toBe('Golden Hour Groove - Warm golden-hour funky dub');
  });

  it('carries the fixed hashtags and the AI label', () => {
    expect(sidecar.hashtags).toEqual(['#smokrates', '#chilldub', '#psydub', '#aimusic']);
    expect(sidecar.aiGenerated).toBe(true);
    expect(sidecar.caption).toContain('#smokrates #chilldub #psydub #aimusic');
  });
});
