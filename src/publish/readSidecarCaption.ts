import {readFile} from 'node:fs/promises';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the caption from the publish sidecar that sits next to a rendered mp4.
 * A missing file, a non-object body, or a non-string caption means there is
 * nothing to paste. Invalid JSON still rejects: the caller should see the parse
 * error instead of treating a corrupt sidecar as "no caption".
 */
export async function readSidecarCaption(videoPath: string): Promise<string | undefined> {
  const sidecarPath = videoPath.replace(/\.mp4$/i, '.json');
  const sidecar: unknown = await readFile(sidecarPath, 'utf8').then(
    (text) => JSON.parse(text) as unknown,
    () => undefined,
  );
  if (!isRecord(sidecar) || typeof sidecar.caption !== 'string') return undefined;
  return sidecar.caption;
}
