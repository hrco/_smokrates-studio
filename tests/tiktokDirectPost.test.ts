import {describe, expect, it, vi} from 'vitest';
import {directPostVideo} from '../src/tiktok/directPost';
import {readScopes} from '../src/tiktok/oauth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

const ok = {code: 'ok', message: '', log_id: 'log'};
const creatorInfo = (options: string[]) => jsonResponse({data: {privacy_level_options: options}, error: ok});
const initOk = () => jsonResponse({data: {publish_id: 'v_pub_file~v2.1', upload_url: 'https://upload.example/secret'}, error: ok});
const videoBytes = new Uint8Array([1, 2, 3]);

describe('directPostVideo', () => {
  it('refuses a privacy level missing from privacy_level_options and never calls init', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(creatorInfo(['SELF_ONLY']));

    const result = await directPostVideo({accessToken: 'tok', videoBytes, caption: 'hi', privacyLevel: 'PUBLIC_TO_EVERYONE'}, fetchFn);

    expect(result).toMatchObject({ok: false, error: {code: 'privacy-not-allowed'}});
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe('https://open.tiktokapis.com/v2/post/publish/creator_info/query/');
  });

  it('inits with title, is_aigc and privacy, then uploads one chunk', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(creatorInfo(['SELF_ONLY', 'PUBLIC_TO_EVERYONE']))
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, {status: 201}));

    const result = await directPostVideo({accessToken: 'tok', videoBytes, caption: 'my caption', privacyLevel: 'PUBLIC_TO_EVERYONE'}, fetchFn);

    expect(result).toEqual({ok: true, value: {publishId: 'v_pub_file~v2.1'}});
    const [initUrl, initInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(initUrl).toBe('https://open.tiktokapis.com/v2/post/publish/video/init/');
    expect(initInit.headers).toMatchObject({Authorization: 'Bearer tok'});
    expect(JSON.parse(initInit.body as string)).toEqual({
      post_info: {
        title: 'my caption',
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
        is_aigc: true,
      },
      source_info: {source: 'FILE_UPLOAD', video_size: 3, chunk_size: 3, total_chunk_count: 1},
    });
    expect((fetchFn.mock.calls[2] as [string, RequestInit])[1].method).toBe('PUT');
  });

  it('defaults to SELF_ONLY', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(creatorInfo(['SELF_ONLY']))
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, {status: 201}));

    const result = await directPostVideo({accessToken: 'tok', videoBytes, caption: 'hi'}, fetchFn);

    expect(result.ok).toBe(true);
    const body = JSON.parse((fetchFn.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body.post_info.privacy_level).toBe('SELF_ONLY');
  });
});

describe('readScopes', () => {
  it('defaults to video.upload', () => {
    expect(readScopes({})).toEqual(['video.upload']);
    expect(readScopes({TIKTOK_SCOPES: ' '})).toEqual(['video.upload']);
  });

  it('reads a comma list', () => {
    expect(readScopes({TIKTOK_SCOPES: 'video.upload, video.publish'})).toEqual(['video.upload', 'video.publish']);
  });
});
