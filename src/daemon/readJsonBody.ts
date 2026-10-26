import type {IncomingMessage} from 'node:http';

export const MAX_BODY_BYTES = 64 * 1024;

export type JsonBodyResult =
  | {kind: 'json'; value: unknown}
  | {kind: 'empty'}
  | {kind: 'too-large'}
  | {kind: 'wrong-content-type'}
  | {kind: 'bad-json'};

function isJsonContentType(header: string | undefined): boolean {
  return header !== undefined && /^application\/json\s*(?:;|$)/i.test(header);
}

function readChunks(req: IncomingMessage, maxBytes: number): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.removeAllListeners('data');
        req.pause();
        resolve('too-large');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Reads a JSON request body of at most maxBytes. A request with no body is `empty`.
 * A body needs Content-Type application/json. A body over the cap is `too-large`; the caller must
 * answer with Connection: close, because the rest of the body is left unread.
 */
export async function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<JsonBodyResult> {
  const declaredBytes = Number(req.headers['content-length'] ?? 0);
  if (declaredBytes > maxBytes) return {kind: 'too-large'};
  const hasBody = declaredBytes > 0 || req.headers['transfer-encoding'] !== undefined;
  if (!hasBody) return {kind: 'empty'};
  if (!isJsonContentType(req.headers['content-type'])) return {kind: 'wrong-content-type'};

  const bytes = await readChunks(req, maxBytes);
  if (bytes === 'too-large') return {kind: 'too-large'};
  if (bytes.length === 0) return {kind: 'empty'};
  try {
    return {kind: 'json', value: JSON.parse(bytes.toString('utf8')) as unknown};
  } catch {
    return {kind: 'bad-json'};
  }
}
