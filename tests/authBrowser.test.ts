import {describe, expect, it} from 'vitest';
import {browserOpenArgs} from '../src/tiktok/authBrowser';

const authorizeUrl = 'https://www.tiktok.com/v2/auth/authorize/?state=abc';

describe('browserOpenArgs', () => {
  it('passes a named app to open -a so the logged-in browser is used', () => {
    expect(browserOpenArgs('Safari', authorizeUrl)).toEqual(['-a', 'Safari', authorizeUrl]);
  });

  it('opens the URL alone when no browser app is set', () => {
    expect(browserOpenArgs(undefined, authorizeUrl)).toEqual([authorizeUrl]);
  });

  it('treats an empty env value like an unset browser', () => {
    expect(browserOpenArgs('', authorizeUrl)).toEqual([authorizeUrl]);
  });
});
