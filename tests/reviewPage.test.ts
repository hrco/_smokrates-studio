import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const REVIEW_DIR = path.resolve(__dirname, '../web/review');
const REVIEW_ENTRY = path.resolve(__dirname, '../web/review.js');

describe('review page files', () => {
  const html = readFileSync(path.join(REVIEW_DIR, 'index.html'), 'utf8');

  it('sets the language, puts the skip link first and has the landmarks and one h1', () => {
    expect(html).toContain('<html lang="en">');
    expect(html.indexOf('class="skip-link"')).toBeLessThan(html.indexOf('<header'));
    for (const landmark of ['<header', '<nav', '<main']) expect(html).toContain(landmark);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('aria-live="polite"');
  });

  it('loads only local assets', () => {
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
  });

  it('never writes user data as HTML', () => {
    const scripts = [REVIEW_ENTRY, ...readdirSync(REVIEW_DIR).filter((name) => name.endsWith('.js')).map((name) => path.join(REVIEW_DIR, name))];
    for (const script of scripts) {
      expect(readFileSync(script, 'utf8'), script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    }
  });
});
