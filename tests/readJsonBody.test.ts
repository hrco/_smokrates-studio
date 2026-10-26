import type {IncomingMessage} from 'node:http';
import {Readable} from 'node:stream';
import {describe, expect, it} from 'vitest';
import {readJsonBody} from '../src/daemon/readJsonBody';

function fakeRequest(options: {chunks: Buffer[]; headers: Record<string, string>}): IncomingMessage {
  const req = Readable.from(options.chunks) as IncomingMessage;
  req.headers = options.headers;
  return req;
}

describe('readJsonBody', () => {
  it('parses application/json with a charset', async () => {
    const body = Buffer.from('{"ok":true}');
    const req = fakeRequest({
      chunks: [body],
      headers: {'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length)},
    });

    await expect(readJsonBody(req, 64)).resolves.toEqual({kind: 'json', value: {ok: true}});
  });

  it('accepts a body of exactly the cap and refuses one byte over it', async () => {
    const exact = Buffer.from(`{"p":"${'x'.repeat(8)}"}`);
    expect(exact.length).toBe(16);
    const understated = fakeRequest({
      chunks: [exact],
      headers: {'content-type': 'application/json', 'content-length': '1'},
    });
    await expect(readJsonBody(understated, exact.length)).resolves.toMatchObject({kind: 'json'});

    const over = Buffer.concat([exact, Buffer.from(' ')]);
    const tooBig = fakeRequest({
      chunks: [exact.subarray(0, 10), over.subarray(10)],
      headers: {'content-type': 'application/json', 'content-length': '1'},
    });
    await expect(readJsonBody(tooBig, exact.length)).resolves.toEqual({kind: 'too-large'});
  });

  it('caps a chunked body that declares no content-length', async () => {
    const req = fakeRequest({
      chunks: [Buffer.from('{"a":'), Buffer.from(`${'1'.repeat(40)}}`)],
      headers: {'content-type': 'application/json', 'transfer-encoding': 'chunked'},
    });

    await expect(readJsonBody(req, 20)).resolves.toEqual({kind: 'too-large'});
  });
});
