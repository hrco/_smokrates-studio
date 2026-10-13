import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const siteDir = resolve(__dirname, '../site');
const legalDir = resolve(__dirname, '../docs/legal');

const readSite = (relativePath: string): string => readFileSync(join(siteDir, relativePath), 'utf8');

const listHtmlFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return listHtmlFiles(fullPath);
    return fullPath.endsWith('.html') ? [fullPath] : [];
  });

const readMarkdownHeadings = (fileName: string): string[] =>
  readFileSync(join(legalDir, fileName), 'utf8')
    .split('\n')
    .filter((line) => /^#{1,2} /.test(line))
    .map((line) => line.replace(/^#+ /, '').trim());

const readHtmlHeadings = (html: string): string[] =>
  [...html.matchAll(/<h[12]>(.*?)<\/h[12]>/g)].map((match) => (match[1] ?? '').trim());

describe('public site pages', () => {
  const pages = ['index.html', 'terms/index.html', 'privacy/index.html'];

  it.each(pages)('%s exists and has a title', (page) => {
    expect(existsSync(join(siteDir, page))).toBe(true);
    expect(readSite(page)).toMatch(/<title>[^<]+<\/title>/);
  });

  it('terms page has the same headings as the markdown source', () => {
    expect(readHtmlHeadings(readSite('terms/index.html'))).toEqual(readMarkdownHeadings('terms-of-service.md'));
  });

  it('privacy page has the same headings as the markdown source', () => {
    expect(readHtmlHeadings(readSite('privacy/index.html'))).toEqual(readMarkdownHeadings('privacy-policy.md'));
  });

  it('legal pages keep the last updated date', () => {
    expect(readSite('terms/index.html')).toContain('Last updated: 14 October 2026');
    expect(readSite('privacy/index.html')).toContain('Last updated: 14 October 2026');
  });
});

describe('site links and assets', () => {
  const htmlFiles = listHtmlFiles(siteDir);

  const resolveInternalTarget = (href: string): string => {
    const path = (href.split('#')[0] ?? '').split('?')[0] ?? '';
    const target = join(siteDir, path);
    return path.endsWith('/') ? join(target, 'index.html') : target;
  };

  it('every internal href and src resolves to a file in site/', () => {
    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf8');
      const references = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((match) => match[1] ?? '');
      const internal = references.filter((ref) => ref.startsWith('/'));
      for (const ref of internal) {
        expect(existsSync(resolveInternalTarget(ref)), `${file} -> ${ref}`).toBe(true);
      }
    }
  });

  it('loads nothing from another origin', () => {
    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf8');
      expect(html).not.toMatch(/<script[^>]+src="http/);
      expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="https?:/);
    }
  });

  it('serves a robots.txt that allows all', () => {
    expect(readSite('robots.txt')).toContain('Allow: /');
  });
});
