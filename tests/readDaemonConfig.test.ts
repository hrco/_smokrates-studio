import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {readDaemonConfig} from '../src/daemon/readDaemonConfig';
import {DEFAULT_STUDIO_DB_PATH} from '../src/store/studioDb';

describe('readDaemonConfig', () => {
  it('defaults to port 8724 and the studio database', () => {
    expect(readDaemonConfig({})).toEqual({ok: true, config: {port: 8724, dbPath: DEFAULT_STUDIO_DB_PATH}});
  });

  it('reads the port and database path from the environment', () => {
    const result = readDaemonConfig({STUDIO_PORT: '9000', STUDIO_DB_PATH: 'tmp/test.db'});
    expect(result).toEqual({ok: true, config: {port: 9000, dbPath: path.resolve('tmp/test.db')}});
  });

  it('treats an empty port or database path as the default', () => {
    expect(readDaemonConfig({STUDIO_PORT: '', STUDIO_DB_PATH: ''})).toEqual({
      ok: true,
      config: {port: 8724, dbPath: DEFAULT_STUDIO_DB_PATH},
    });
  });

  it.each([1, 65535])('accepts port %s', (port) => {
    expect(readDaemonConfig({STUDIO_PORT: String(port)})).toEqual({
      ok: true,
      config: {port, dbPath: DEFAULT_STUDIO_DB_PATH},
    });
  });

  it.each(['abc', '0', '65536', '70000', '12.5', '-1'])('refuses the port %s and names it', (port) => {
    const result = readDaemonConfig({STUDIO_PORT: port});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(`"${port}"`);
  });
});
