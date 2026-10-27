import {describe, expect, it, vi} from 'vitest';
import {uploadVideoToInbox, waitForInboxDelivery} from '../src/tiktok/inboxUpload';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

const okInit = {
  data: {publish_id: 'v_inbox_file~v2.123', upload_url: 'https://upload.example/secret-path'},
  error: {code: 'ok', message: '', log_id: 'log-1'},
};

function statusBody(status: string, failReason?: string): unknown {
  return {data: {status, ...(failReason ? {fail_reason: failReason} : {})}, error: {code: 'ok', message: '', log_id: 'log-2'}};
}

describe('uploadVideoToInbox', () => {
  const videoBytes = new Uint8Array([1, 2, 3, 4, 5]);

  it('inits then uploads one chunk with exact headers and body', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(okInit))
      .mockResolvedValueOnce(new Response(null, {status: 201}));

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes}, fetchFn);

    expect(result).toEqual({ok: true, value: {publishId: 'v_inbox_file~v2.123'}});
    const [initUrl, initInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(initUrl).toBe('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/');
    expect(initInit.method).toBe('POST');
    expect(initInit.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json; charset=UTF-8',
    });
    expect(JSON.parse(initInit.body as string)).toEqual({
      source_info: {source: 'FILE_UPLOAD', video_size: 5, chunk_size: 5, total_chunk_count: 1},
    });

    const [putUrl, putInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(putUrl).toBe('https://upload.example/secret-path');
    expect(putInit.method).toBe('PUT');
    expect(putInit.headers).toEqual({
      'Content-Type': 'video/mp4',
      'Content-Length': '5',
      'Content-Range': 'bytes 0-4/5',
    });
    expect(putInit.body).toBe(videoBytes);
  });

  it('does not upload when init JSON has no error field', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({data: {publish_id: 'pub-1', upload_url: 'https://upload.example/secret-path'}}),
    );

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes}, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-response');
      expect(result.error.detail).toContain('without an error field');
      expect(JSON.stringify(result)).not.toContain('secret-path');
    }
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fails when the init error code is not ok, without uploading', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({error: {code: 'access_token_invalid', message: 'bad token', log_id: 'log-9'}}, 401),
    );

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes}, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('access_token_invalid');
      expect(result.error.detail).toContain('log-9');
    }
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects a video over 64 MB and says chunking is unsupported', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const tooLarge = new Uint8Array(64 * 1024 * 1024 + 1);

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes: tooLarge}, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('video-too-large');
      expect(result.error.detail).toContain('chunked upload is not supported');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('treats HTTP 200 as not complete, because TikTok signals a finished upload only with 201', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(okInit))
      .mockResolvedValueOnce(new Response(null, {status: 200}));

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes}, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('upload-not-complete');
      expect(result.error.detail).toContain('HTTP 200');
      expect(result.error.detail).toContain('v_inbox_file~v2.123');
    }
  });

  it('rejects an empty file before calling TikTok', async () => {
    const fetchFn = vi.fn<typeof fetch>();

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes: new Uint8Array()}, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('empty-video');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('accepts a video of exactly 64 MB', async () => {
    const exact = new Uint8Array(64 * 1024 * 1024);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(okInit))
      .mockResolvedValueOnce(new Response(null, {status: 201}));

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes: exact}, fetchFn);

    expect(result.ok).toBe(true);
    const [, initInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(initInit.body as string).source_info.video_size).toBe(exact.byteLength);
  });

  it('does not upload when init omits the upload url', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({data: {publish_id: 'pub-only'}, error: {code: 'ok', message: '', log_id: 'log-1'}}),
    );

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes}, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-response');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fails closed when init returns a non-JSON body', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream', {status: 502}));

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes}, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-response');
      expect(result.error.detail).toContain('HTTP 502');
    }
  });

  it('rejects other upload statuses and keeps the upload url out of the error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(okInit))
      .mockResolvedValueOnce(new Response(null, {status: 403}));

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes}, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('upload-rejected');
      expect(result.error.detail).toContain('HTTP 403');
      expect(result.error.detail).toContain('v_inbox_file~v2.123');
      expect(JSON.stringify(result)).not.toContain('secret-path');
    }
  });

  it('treats HTTP 206 as an error and does not leak the upload url', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(okInit))
      .mockResolvedValueOnce(new Response(null, {status: 206}));

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes}, fetchFn);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.detail).toContain('expected single chunk complete');
      expect(JSON.stringify(result)).not.toContain('secret-path');
    }
  });
});

describe('uploadVideoToInbox onInitialized', () => {
  const videoBytes = new Uint8Array([1, 2, 3]);

  it('hands over the publish id before the PUT request', async () => {
    const events: string[] = [];
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      events.push(init?.method ?? 'none');
      return init?.method === 'PUT' ? new Response(null, {status: 201}) : jsonResponse(okInit);
    });
    const onInitialized = vi.fn().mockImplementation(async (publishId: string) => {
      events.push(`callback:${publishId}`);
    });

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes, onInitialized}, fetchFn);

    expect(result.ok).toBe(true);
    expect(events).toEqual(['POST', 'callback:v_inbox_file~v2.123', 'PUT']);
  });

  it('stops before the PUT when the callback fails', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(okInit));
    const onInitialized = vi.fn().mockRejectedValue(new Error('disk full'));

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes, onInitialized}, fetchFn);

    expect(result).toEqual({
      ok: false,
      error: {
        operation: 'upload-video-to-inbox',
        code: 'record-publish-id-failed',
        detail: 'disk full (publish_id v_inbox_file~v2.123)',
      },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps the current behaviour when no callback is given', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(okInit))
      .mockResolvedValueOnce(new Response(null, {status: 201}));

    const result = await uploadVideoToInbox({accessToken: 'tok', videoBytes}, fetchFn);

    expect(result).toEqual({ok: true, value: {publishId: 'v_inbox_file~v2.123'}});
  });
});

describe('waitForInboxDelivery', () => {
  const input = {accessToken: 'tok', publishId: 'pub-1'};

  it('polls until SEND_TO_USER_INBOX', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(statusBody('PROCESSING_UPLOAD')))
      .mockResolvedValueOnce(jsonResponse(statusBody('SEND_TO_USER_INBOX')));
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const result = await waitForInboxDelivery(input, fetchFn, {sleepFn});

    expect(result).toEqual({ok: true, value: {status: 'SEND_TO_USER_INBOX'}});
    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledWith(5000);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://open.tiktokapis.com/v2/post/publish/status/fetch/');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json; charset=UTF-8',
    });
    expect(JSON.parse(init.body as string)).toEqual({publish_id: 'pub-1'});
  });

  it('stops when the status call fails instead of polling until timeout', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({error: {code: 'access_token_invalid', message: 'bad token', log_id: 'log-9'}}, 401),
    );
    const sleepFn = vi.fn();

    const result = await waitForInboxDelivery(input, fetchFn, {sleepFn});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.operation).toBe('fetch-publish-status');
      expect(result.error.code).toBe('access_token_invalid');
    }
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('stops on PUBLISH_COMPLETE without another poll', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusBody('PUBLISH_COMPLETE')));
    const sleepFn = vi.fn();

    const result = await waitForInboxDelivery(input, fetchFn, {sleepFn});

    expect(result).toEqual({ok: true, value: {status: 'PUBLISH_COMPLETE'}});
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('polls once and times out when the budget is shorter than one interval', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusBody('PROCESSING_UPLOAD')));
    const sleepFn = vi.fn();

    const result = await waitForInboxDelivery(input, fetchFn, {pollIntervalMs: 5000, timeoutMs: 1000, sleepFn});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('timeout');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('returns an error carrying fail_reason on FAILED', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusBody('FAILED', 'file_format_check_failed')));

    const result = await waitForInboxDelivery(input, fetchFn, {sleepFn: async () => undefined});

    expect(result).toEqual({
      ok: false,
      error: {operation: 'wait-for-inbox-delivery', code: 'publish-failed', detail: 'file_format_check_failed'},
    });
  });

  it('uses a fallback detail when FAILED has no fail_reason', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusBody('FAILED')));

    const result = await waitForInboxDelivery(input, fetchFn, {sleepFn: async () => undefined});

    expect(result).toEqual({
      ok: false,
      error: {operation: 'wait-for-inbox-delivery', code: 'publish-failed', detail: 'no fail_reason given'},
    });
  });

  it('rejects an unknown publish status instead of treating it as delivered', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusBody('PROCESSING_SOMETHING_NEW')));

    const result = await waitForInboxDelivery(input, fetchFn, {sleepFn: async () => undefined});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-response');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('times out after the poll budget is spent', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(statusBody('PROCESSING_DOWNLOAD')));
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const result = await waitForInboxDelivery(input, fetchFn, {pollIntervalMs: 1000, timeoutMs: 3000, sleepFn});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('timeout');
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(sleepFn).toHaveBeenCalledTimes(3);
  });
});
