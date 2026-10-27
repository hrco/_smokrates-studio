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
    labelDecision: 'label_off',
  });

  it('starts the caption with the title and a hook', () => {
    expect(sidecar.caption.split('\n')[0]).toBe('Golden Hour Groove - Warm golden-hour funky dub');
  });

  it('carries the fixed hashtags', () => {
    expect(sidecar.hashtags).toEqual(['#smokrates', '#chilldub', '#psydub', '#aimusic']);
    expect(sidecar.caption).toContain('#smokrates #chilldub #psydub #aimusic');
  });

  it('passes the label decision through instead of a fixed AI flag', () => {
    expect(sidecar.labelDecision).toBe('label_off');
    expect(sidecar).not.toHaveProperty('aiGenerated');
    const labelled = buildPublishSidecar({slug: 's', title: 'T', theme: 'x', labelDecision: 'label_on'});
    expect(labelled.labelDecision).toBe('label_on');
  });
});
