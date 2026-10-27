import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {loadProjectEnv} from '../src/daemon/loadProjectEnv';

const PROBE = 'SMOK_DAEMON_ENV_PROBE';

describe('loadProjectEnv', () => {
  const originalCwd = process.cwd();
  let root: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    delete process.env[PROBE];
    if (root !== undefined) rmSync(root, {recursive: true, force: true});
    root = undefined;
  });

  it('loads the env file from the project root when the process was started elsewhere', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'smok-daemon-env-'));
    const projectRoot = path.join(root, 'project');
    const elsewhere = path.join(root, 'elsewhere');
    mkdirSync(projectRoot);
    mkdirSync(elsewhere);
    writeFileSync(path.join(projectRoot, '.env'), `${PROBE}=from-root\n`);
    writeFileSync(path.join(elsewhere, '.env'), `${PROBE}=from-cwd\n`);
    process.chdir(elsewhere);
    delete process.env[PROBE];

    loadProjectEnv(projectRoot);

    expect(process.env[PROBE]).toBe('from-root');
  });

  it('does nothing when the project root has no env file', () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'smok-daemon-env-'));
    root = projectRoot;
    delete process.env[PROBE];

    expect(() => loadProjectEnv(projectRoot)).not.toThrow();
    expect(process.env[PROBE]).toBeUndefined();
  });
});

describe('studio daemon env wiring', () => {
  it('loads the env file from the project root the daemon already uses for out and the database', () => {
    const source = readFileSync(path.resolve(__dirname, '../scripts/studio-daemon.ts'), 'utf8');

    expect(source).toContain('loadProjectEnv(PROJECT_ROOT)');
    expect(source).not.toContain("loadEnvFile('.env')");
    expect(source).not.toContain("existsSync('.env')");
  });
});
