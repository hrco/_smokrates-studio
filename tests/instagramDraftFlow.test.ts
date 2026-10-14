import {describe, expect, it, vi} from 'vitest';
import {runDraftFlow, type DraftFlowDeps} from '../src/instagram/draftFlow';

const remoteName = `${'cd34'.repeat(8)}.mp4`;
const publicUrl = `https://nopanicpost.donotpanic.space/ig-staging/${remoteName}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function createDeps(overrides: Partial<DraftFlowDeps> & {graphResponses: Response[]}): DraftFlowDeps & {
  messages: string[];
  warnings: string[];
} {
  const messages: string[] = [];
  const warnings: string[] = [];
  const fetchFn = vi.fn<typeof fetch>();
  for (const response of overrides.graphResponses) fetchFn.mockResolvedValueOnce(response);
  return {
    fetchFn,
    stageVideo: vi.fn(async () => ({ok: true as const, value: {remoteName, remotePath: `/srv/sites/nopanicpost/ig-staging/${remoteName}`, publicUrl}})),
    unstageVideo: vi.fn(async () => ({ok: true as const, value: null})),
    checkUrlReachable: vi.fn(async () => ({ok: true as const, value: null})),
    readFileSizeBytes: vi.fn(async () => 1234),
    writeDraftRecord: vi.fn(async () => undefined),
    nowMs: () => Date.parse('2026-10-14T10:00:00.000Z'),
    log: (message) => messages.push(message),
    warn: (message) => warnings.push(message),
    waitOptions: {pollIntervalMs: 1, maxWaitMs: 100, sleepFn: async () => undefined, nowFn: () => 0},
    ...overrides,
    messages,
    warnings,
  };
}

const input = {accessToken: 'tok', videoPath: 'out/a.mp4', caption: 'hello', recordPath: 'out/a.instagram.json'};
const accountResponse = () => jsonResponse({user_id: '178', username: 'smokrates'});

describe('runDraftFlow', () => {
  it('stages, creates the container with video_url, waits, writes the record and unstages', async () => {
    const deps = createDeps({graphResponses: [accountResponse(), jsonResponse({id: 'c1'}), jsonResponse({status_code: 'FINISHED'})]});
    const result = await runDraftFlow(input, deps);
    expect(result.ok && result.value.record.containerId).toBe('c1');
    expect(deps.checkUrlReachable).toHaveBeenCalledWith({publicUrl, expectedSizeBytes: 1234});
    const createCall = vi.mocked(deps.fetchFn).mock.calls[1];
    expect(new URLSearchParams(String(createCall?.[1]?.body)).get('video_url')).toBe(publicUrl);
    expect(deps.writeDraftRecord).toHaveBeenCalledTimes(1);
    expect(deps.unstageVideo).toHaveBeenCalledWith({remoteName});
    expect(deps.messages.some((message) => message.includes(publicUrl))).toBe(true);
    expect(deps.warnings).toEqual([]);
  });

  it('unstages when the container ends in ERROR and writes no record', async () => {
    const deps = createDeps({
      graphResponses: [accountResponse(), jsonResponse({id: 'c1'}), jsonResponse({status_code: 'ERROR', status: 'bad codec'})],
    });
    const result = await runDraftFlow(input, deps);
    expect(!result.ok && result.error.code).toBe('container-error');
    expect(deps.unstageVideo).toHaveBeenCalledWith({remoteName});
    expect(deps.writeDraftRecord).not.toHaveBeenCalled();
  });

  it('unstages when the wait times out', async () => {
    const deps = createDeps({
      graphResponses: [accountResponse(), jsonResponse({id: 'c1'}), jsonResponse({status_code: 'IN_PROGRESS'})],
      waitOptions: {pollIntervalMs: 200, maxWaitMs: 100, sleepFn: async () => undefined, nowFn: () => 0},
    });
    const result = await runDraftFlow(input, deps);
    expect(!result.ok && result.error.code).toBe('timeout');
    expect(deps.unstageVideo).toHaveBeenCalledTimes(1);
  });

  it('unstages when the url is not reachable and never creates a container', async () => {
    const deps = createDeps({
      graphResponses: [accountResponse()],
      checkUrlReachable: vi.fn(async () => ({ok: false as const, error: {operation: 'check-url-reachable', code: 'bad-status', detail: 'HTTP 404'}})),
    });
    const result = await runDraftFlow(input, deps);
    expect(!result.ok && result.error.code).toBe('bad-status');
    expect(deps.fetchFn).toHaveBeenCalledTimes(1);
    expect(deps.unstageVideo).toHaveBeenCalledTimes(1);
  });

  it('warns with the remote path when unstage fails and keeps the original error', async () => {
    const deps = createDeps({
      graphResponses: [accountResponse(), jsonResponse({id: 'c1'}), jsonResponse({status_code: 'ERROR', status: 'bad codec'})],
      unstageVideo: vi.fn(async () => ({ok: false as const, error: {operation: 'unstage-video', code: 'ssh-failed', detail: 'timed out'}})),
    });
    const result = await runDraftFlow(input, deps);
    expect(!result.ok && result.error.code).toBe('container-error');
    expect(deps.warnings).toHaveLength(1);
    expect(deps.warnings[0]).toContain(`/srv/sites/nopanicpost/ig-staging/${remoteName}`);
  });

  it('warns and still returns success when unstage fails after a good draft', async () => {
    const deps = createDeps({
      graphResponses: [accountResponse(), jsonResponse({id: 'c1'}), jsonResponse({status_code: 'FINISHED'})],
      unstageVideo: vi.fn(async () => {
        throw new Error('spawn failed');
      }),
    });
    const result = await runDraftFlow(input, deps);
    expect(result.ok).toBe(true);
    expect(deps.warnings[0]).toContain(remoteName);
  });

  it('does not stage or unstage when fetchAccount fails', async () => {
    const deps = createDeps({graphResponses: [jsonResponse({error: {message: 'Invalid token', code: 190, fbtrace_id: 't'}}, 400)]});
    const result = await runDraftFlow(input, deps);
    expect(!result.ok && result.error.code).toBe('190');
    expect(deps.stageVideo).not.toHaveBeenCalled();
    expect(deps.unstageVideo).not.toHaveBeenCalled();
  });

  it('unstages when creating the container fails and writes no record', async () => {
    const deps = createDeps({
      graphResponses: [accountResponse(), jsonResponse({error: {message: 'The parameter video_url is required', code: 100, fbtrace_id: 't'}}, 400)],
    });
    const result = await runDraftFlow(input, deps);
    expect(!result.ok && result.error.code).toBe('100');
    expect(deps.unstageVideo).toHaveBeenCalledWith({remoteName});
    expect(deps.writeDraftRecord).not.toHaveBeenCalled();
  });

  it('unstages when writing the record throws', async () => {
    const deps = createDeps({
      graphResponses: [accountResponse(), jsonResponse({id: 'c1'}), jsonResponse({status_code: 'FINISHED'})],
      writeDraftRecord: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    await expect(runDraftFlow(input, deps)).rejects.toThrow('disk full');
    expect(deps.unstageVideo).toHaveBeenCalledWith({remoteName});
  });

  it('does not unstage when staging itself fails', async () => {
    const deps = createDeps({
      graphResponses: [accountResponse()],
      stageVideo: vi.fn(async () => ({ok: false as const, error: {operation: 'stage-video', code: 'scp-failed', detail: 'x'}})),
    });
    const result = await runDraftFlow(input, deps);
    expect(!result.ok && result.error.code).toBe('scp-failed');
    expect(deps.unstageVideo).not.toHaveBeenCalled();
  });
});
