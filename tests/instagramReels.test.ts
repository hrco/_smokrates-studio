import {describe, expect, it, vi} from 'vitest';
import {
  createReelContainer,
  fetchAccount,
  fetchPermalink,
  publishContainer,
  uploadReelBytes,
  waitForContainer,
} from '../src/instagram/reels';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

const graphError = {error: {message: 'Invalid token', type: 'OAuthException', code: 190, fbtrace_id: 'trace-1'}};

function fetchReturning(...responses: Response[]): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchFn = vi.fn<typeof fetch>();
  for (const response of responses) fetchFn.mockResolvedValueOnce(response);
  return fetchFn;
}

function requestOf(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>, callIndex = 0): {url: string; init: RequestInit} {
  const [url, init] = fetchFn.mock.calls[callIndex] ?? [];
  return {url: String(url), init: init ?? {}};
}

describe('fetchAccount', () => {
  it('reads user id and username with a Bearer header', async () => {
    const fetchFn = fetchReturning(jsonResponse({user_id: '178', username: 'smokrates'}));
    const result = await fetchAccount({accessToken: 'tok'}, fetchFn);
    expect(result).toEqual({ok: true, value: {userId: '178', username: 'smokrates'}});
    const {url, init} = requestOf(fetchFn);
    expect(url).toBe('https://graph.instagram.com/v23.0/me?fields=user_id,username');
    expect(init.headers).toEqual({Authorization: 'Bearer tok'});
  });

  it('maps a Graph error to code, message and fbtrace_id', async () => {
    const result = await fetchAccount({accessToken: 'tok'}, fetchReturning(jsonResponse(graphError, 400)));
    expect(result).toEqual({
      ok: false,
      error: {operation: 'fetch-account', code: '190', detail: 'Invalid token (fbtrace_id trace-1)'},
    });
  });

  it('fails on a body without the fields', async () => {
    const result = await fetchAccount({accessToken: 'tok'}, fetchReturning(jsonResponse({username: 'x'})));
    expect(!result.ok && result.error.code).toBe('invalid-response');
  });

  it('never puts the token in an error', async () => {
    const result = await fetchAccount({accessToken: 'secret-tok'}, fetchReturning(new Response('<html>', {status: 502})));
    expect(JSON.stringify(result)).not.toContain('secret-tok');
    expect(!result.ok && result.error.code).toBe('invalid-response');
  });
});

describe('createReelContainer', () => {
  const input = {accessToken: 'tok', userId: '178', caption: 'hello #music'};

  // Regression: graph.instagram.com ignored a JSON body and answered "The parameter video_url is required".
  it('posts a form-encoded resumable REELS body and returns id and uri', async () => {
    const fetchFn = fetchReturning(jsonResponse({id: 'c1', uri: 'https://rupload.facebook.com/ig-api-upload/v23.0/c1'}));
    const result = await createReelContainer(input, fetchFn);
    expect(result).toEqual({ok: true, value: {containerId: 'c1', uploadUri: 'https://rupload.facebook.com/ig-api-upload/v23.0/c1'}});
    const {url, init} = requestOf(fetchFn);
    expect(url).toBe('https://graph.instagram.com/v23.0/178/media');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({Authorization: 'Bearer tok', 'Content-Type': 'application/x-www-form-urlencoded'});
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: 'hello #music',
      share_to_feed: 'true',
    });
  });

  it('maps a Graph error', async () => {
    const result = await createReelContainer(input, fetchReturning(jsonResponse(graphError, 400)));
    expect(!result.ok && result.error.code).toBe('190');
  });

  it('fails when uri is missing', async () => {
    const result = await createReelContainer(input, fetchReturning(jsonResponse({id: 'c1'})));
    expect(!result.ok && result.error.code).toBe('invalid-response');
  });
});

describe('uploadReelBytes', () => {
  const videoBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const input = {accessToken: 'tok', uploadUri: 'https://rupload.example/c1', videoBytes, containerId: 'c1'};

  it('sends OAuth, offset and file_size headers with the bytes', async () => {
    const fetchFn = fetchReturning(jsonResponse({success: true, message: 'Upload successful.'}));
    const result = await uploadReelBytes(input, fetchFn);
    expect(result).toEqual({ok: true, value: null});
    const {url, init} = requestOf(fetchFn);
    expect(url).toBe('https://rupload.example/c1');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({Authorization: 'OAuth tok', offset: '0', file_size: '5'});
    expect(init.body).toBe(videoBytes);
  });

  it('refuses an empty video without calling fetch', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const result = await uploadReelBytes({...input, videoBytes: new Uint8Array(0)}, fetchFn);
    expect(!result.ok && result.error.code).toBe('empty-video');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a Graph error and names the container', async () => {
    const result = await uploadReelBytes(input, fetchReturning(jsonResponse(graphError, 400)));
    expect(result).toEqual({
      ok: false,
      error: {operation: 'upload-reel-bytes', code: '190', detail: 'Invalid token (fbtrace_id trace-1) (container c1)'},
    });
  });

  it('fails when success is not true', async () => {
    const result = await uploadReelBytes(input, fetchReturning(jsonResponse({success: false}, 500)));
    expect(!result.ok && result.error.code).toBe('upload-rejected');
  });

  it('fails on a non-JSON body', async () => {
    const result = await uploadReelBytes(input, fetchReturning(new Response('oops', {status: 500})));
    expect(!result.ok && result.error.code).toBe('invalid-response');
  });
});

describe('waitForContainer', () => {
  const input = {accessToken: 'tok', containerId: 'c1'};

  function fakeClock(): {nowFn: () => number; sleepFn: (ms: number) => Promise<void>; sleeps: number[]} {
    let nowMs = 0;
    const sleeps: number[] = [];
    return {
      nowFn: () => nowMs,
      sleepFn: async (ms) => {
        sleeps.push(ms);
        nowMs += ms;
      },
      sleeps,
    };
  }

  it('polls until FINISHED', async () => {
    const fetchFn = fetchReturning(
      jsonResponse({status_code: 'IN_PROGRESS', id: 'c1'}),
      jsonResponse({status_code: 'FINISHED', id: 'c1'}),
    );
    const clock = fakeClock();
    const result = await waitForContainer(input, fetchFn, {pollIntervalMs: 10, maxWaitMs: 100, ...clock});
    expect(result).toEqual({ok: true, value: {statusCode: 'FINISHED'}});
    expect(clock.sleeps).toEqual([10]);
    expect(requestOf(fetchFn).url).toBe('https://graph.instagram.com/v23.0/c1?fields=status_code,status');
  });

  it('fails on ERROR with the status text', async () => {
    const fetchFn = fetchReturning(jsonResponse({status_code: 'ERROR', status: 'Error: bad codec'}));
    const result = await waitForContainer(input, fetchFn, fakeClock());
    expect(result).toEqual({
      ok: false,
      error: {operation: 'wait-for-container', code: 'container-error', detail: 'Error: bad codec (container c1)'},
    });
  });

  it('fails on EXPIRED', async () => {
    const result = await waitForContainer(input, fetchReturning(jsonResponse({status_code: 'EXPIRED'})), fakeClock());
    expect(!result.ok && result.error.code).toBe('container-expired');
  });

  it('times out when the container stays IN_PROGRESS', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({status_code: 'IN_PROGRESS'}));
    const result = await waitForContainer(input, fetchFn, {pollIntervalMs: 10, maxWaitMs: 30, ...fakeClock()});
    expect(!result.ok && result.error.code).toBe('timeout');
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('maps a Graph error while polling', async () => {
    const result = await waitForContainer(input, fetchReturning(jsonResponse(graphError, 400)), fakeClock());
    expect(!result.ok && result.error.code).toBe('190');
  });

  it('fails on a body without status_code', async () => {
    const result = await waitForContainer(input, fetchReturning(jsonResponse({id: 'c1'})), fakeClock());
    expect(!result.ok && result.error.code).toBe('invalid-response');
  });
});

describe('publishContainer', () => {
  const input = {accessToken: 'tok', userId: '178', containerId: 'c1'};

  it('posts creation_id and returns the media id', async () => {
    const fetchFn = fetchReturning(jsonResponse({id: 'm1'}));
    const result = await publishContainer(input, fetchFn);
    expect(result).toEqual({ok: true, value: {mediaId: 'm1'}});
    const {url, init} = requestOf(fetchFn);
    expect(url).toBe('https://graph.instagram.com/v23.0/178/media_publish');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({creation_id: 'c1'});
  });

  it('maps a Graph error', async () => {
    const result = await publishContainer(input, fetchReturning(jsonResponse(graphError, 400)));
    expect(!result.ok && result.error.detail).toContain('trace-1');
  });

  it('fails without an id', async () => {
    const result = await publishContainer(input, fetchReturning(jsonResponse({})));
    expect(!result.ok && result.error.code).toBe('invalid-response');
  });
});

describe('fetchPermalink', () => {
  const input = {accessToken: 'tok', mediaId: 'm1'};

  it('reads the permalink', async () => {
    const fetchFn = fetchReturning(jsonResponse({permalink: 'https://www.instagram.com/reel/abc/', id: 'm1'}));
    const result = await fetchPermalink(input, fetchFn);
    expect(result).toEqual({ok: true, value: {permalink: 'https://www.instagram.com/reel/abc/'}});
    expect(requestOf(fetchFn).url).toBe('https://graph.instagram.com/v23.0/m1?fields=permalink');
  });

  it('maps a Graph error', async () => {
    const result = await fetchPermalink(input, fetchReturning(jsonResponse(graphError, 400)));
    expect(!result.ok && result.error.code).toBe('190');
  });

  it('fails without a permalink', async () => {
    const result = await fetchPermalink(input, fetchReturning(jsonResponse({id: 'm1'})));
    expect(!result.ok && result.error.code).toBe('invalid-response');
  });
});
