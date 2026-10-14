import {describe, expect, it, vi} from 'vitest';
import {
  checkUrlReachable,
  readStagingConfig,
  stageVideo,
  unstageVideo,
  type CommandOutcome,
  type CommandRunner,
  type StagingConfig,
} from '../src/instagram/staging';

const config: StagingConfig = {host: 'box.example', user: 'ubuntu', keyPath: '/keys/oracle.key'};
const remoteName = `${'ab12'.repeat(8)}.mp4`;
const connection = ['-i', '/keys/oracle.key', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];

function fakeRunner(...outcomes: CommandOutcome[]): CommandRunner & {calls: Array<{program: string; args: string[]}>} {
  const calls: Array<{program: string; args: string[]}> = [];
  return {
    calls,
    run: async (program, args) => {
      calls.push({program, args});
      return outcomes[calls.length - 1] ?? {exitCode: 0, stderr: ''};
    },
  };
}

describe('stageVideo', () => {
  it('runs mkdir, scp and chmod as argument arrays and returns the public url', async () => {
    const runner = fakeRunner();
    const result = await stageVideo({localPath: 'out/a.mp4', config}, runner, remoteName);
    expect(result).toEqual({
      ok: true,
      value: {
        remoteName,
        remotePath: `/srv/sites/nopanicpost/ig-staging/${remoteName}`,
        publicUrl: `https://nopanicpost.donotpanic.space/ig-staging/${remoteName}`,
      },
    });
    expect(runner.calls).toEqual([
      {program: 'ssh', args: [...connection, 'ubuntu@box.example', 'mkdir -p /srv/sites/nopanicpost/ig-staging']},
      {program: 'scp', args: [...connection, '--', 'out/a.mp4', `ubuntu@box.example:/srv/sites/nopanicpost/ig-staging/${remoteName}`]},
      {program: 'ssh', args: [...connection, 'ubuntu@box.example', `chmod a+r /srv/sites/nopanicpost/ig-staging/${remoteName}`]},
    ]);
  });

  it('generates a 32 hex character name by default', async () => {
    const result = await stageVideo({localPath: 'out/a.mp4', config}, fakeRunner());
    expect(result.ok && result.value.remoteName).toMatch(/^[0-9a-f]{32}\.mp4$/);
  });

  it('maps a scp failure to an error with the staged name and stops', async () => {
    const runner = fakeRunner({exitCode: 0, stderr: ''}, {exitCode: 255, stderr: 'Permission denied (publickey)'});
    const result = await stageVideo({localPath: 'out/a.mp4', config}, runner, remoteName);
    expect(result).toEqual({
      ok: false,
      error: {
        operation: 'stage-video',
        code: 'scp-failed',
        detail: `scp exited 255: Permission denied (publickey) (staged file ${remoteName})`,
      },
    });
    expect(runner.calls).toHaveLength(2);
  });

  it('rejects a bad name before running anything', async () => {
    const runner = fakeRunner();
    const result = await stageVideo({localPath: 'out/a.mp4', config}, runner, '../x.mp4');
    expect(!result.ok && result.error.code).toBe('bad-name');
    expect(runner.calls).toHaveLength(0);
  });
});

describe('unstageVideo', () => {
  it('removes exactly the staged path', async () => {
    const runner = fakeRunner();
    const result = await unstageVideo({remoteName, config}, runner);
    expect(result).toEqual({ok: true, value: null});
    expect(runner.calls).toEqual([
      {program: 'ssh', args: [...connection, 'ubuntu@box.example', `rm -f /srv/sites/nopanicpost/ig-staging/${remoteName}`]},
    ]);
  });

  it.each(['../../etc/passwd', 'a.mp4', `${'AB12'.repeat(8)}.mp4`, `${remoteName}; rm -rf /`, `${'ab12'.repeat(8)}.mov`, ''])(
    'rejects the name %j without running a command',
    async (badName) => {
      const runner = fakeRunner();
      const result = await unstageVideo({remoteName: badName, config}, runner);
      expect(!result.ok && result.error.code).toBe('bad-name');
      expect(runner.calls).toHaveLength(0);
    },
  );

  it('maps a runner failure', async () => {
    const result = await unstageVideo({remoteName, config}, fakeRunner({exitCode: 255, stderr: 'timed out'}));
    expect(result).toEqual({
      ok: false,
      error: {operation: 'unstage-video', code: 'ssh-failed', detail: `ssh exited 255: timed out (staged file ${remoteName})`},
    });
  });
});

describe('checkUrlReachable', () => {
  const input = {publicUrl: `https://nopanicpost.donotpanic.space/ig-staging/${remoteName}`, expectedSizeBytes: 1234};

  function headResponse(status: number, contentLength?: string): Response {
    return new Response(null, {status, headers: contentLength === undefined ? {} : {'Content-Length': contentLength}});
  }

  it('accepts 200 with the same content-length using HEAD', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(headResponse(200, '1234'));
    expect(await checkUrlReachable(input, fetchFn)).toEqual({ok: true, value: null});
    expect(fetchFn.mock.calls[0]?.[0]).toBe(input.publicUrl);
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('HEAD');
  });

  it('fails on 404', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(headResponse(404));
    const result = await checkUrlReachable(input, fetchFn);
    expect(!result.ok && result.error.code).toBe('bad-status');
  });

  it('fails on a size mismatch', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(headResponse(200, '99'));
    const result = await checkUrlReachable(input, fetchFn);
    expect(!result.ok && result.error.code).toBe('size-mismatch');
  });

  it('fails when content-length is missing', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(headResponse(200));
    const result = await checkUrlReachable(input, fetchFn);
    expect(!result.ok && result.error.code).toBe('size-mismatch');
  });

  it('maps a network error', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const result = await checkUrlReachable(input, fetchFn);
    expect(!result.ok && result.error.code).toBe('request-failed');
  });
});

describe('readStagingConfig', () => {
  it('requires VPS_HOST', () => {
    const result = readStagingConfig({});
    expect(!result.ok && result.error.code).toBe('missing-host');
  });

  it('applies the deploy-site defaults', () => {
    const result = readStagingConfig({VPS_HOST: '203.0.113.7'});
    expect(result.ok && result.value.user).toBe('ubuntu');
    expect(result.ok && result.value.keyPath).toMatch(/\/\.ssh\/oracle-vps\.key$/);
    expect(result.ok && result.value.keyPath.startsWith('~')).toBe(false);
  });

  it('rejects a host that could be read as an ssh option', () => {
    const result = readStagingConfig({VPS_HOST: '-oProxyCommand=x y'});
    expect(!result.ok && result.error.code).toBe('bad-host');
  });
});
