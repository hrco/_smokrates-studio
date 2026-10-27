import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const plistPath = path.resolve(__dirname, '../ops/launchd/space.donotpanic.smokrates-tick.plist');

describe('launchd tick template', () => {
  const plist = readFileSync(plistPath, 'utf8');

  it('posts to the local tick every 15 minutes and logs as airbook', () => {
    expect(plist).toContain('<key>Label</key>');
    expect(plist).toContain('<string>space.donotpanic.smokrates-tick</string>');
    expect(plist).toContain('<key>UserName</key>');
    expect(plist).toContain('<string>airbook</string>');
    expect(plist).toContain('<string>/usr/bin/curl</string>');
    expect(plist).toContain('<string>-fsS</string>');
    expect(plist).toContain('<string>POST</string>');
    expect(plist).toContain('<string>Origin: http://127.0.0.1:8724</string>');
    expect(plist).toContain('<string>http://127.0.0.1:8724/api/tick</string>');
    expect(plist).toContain('<key>StartInterval</key>');
    expect(plist).toContain('<integer>900</integer>');
    expect(plist).toContain('<string>/Users/airbook/Library/Logs/smokrates-tick.log</string>');
    expect(plist).not.toContain('launchctl');
  });
});
