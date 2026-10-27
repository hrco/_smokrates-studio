export type AttachRenderArgs = {
  episodeId: string;
  filePath: string;
};

export type ParseAttachRenderArgsResult = {ok: true; args: AttachRenderArgs} | {ok: false; message: string};

export const ATTACH_RENDER_USAGE =
  'usage: studio-attach-render <episodeId> <file.mp4>\n' +
  'Temporary: records a finished render for an episode and marks it ready, until the episode.render operation lands.\n' +
  'The file must be an .mp4 inside the out/ folder.';

const EPISODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function fail(message: string): ParseAttachRenderArgsResult {
  return {ok: false, message: `${message}\n${ATTACH_RENDER_USAGE}`};
}

export function parseAttachRenderArgs(argv: readonly string[]): ParseAttachRenderArgsResult {
  const [episodeId, filePath, ...extra] = argv;
  if (episodeId === undefined || filePath === undefined) return fail('need an episode id and a file');
  if (extra.length > 0) return fail(`unexpected extra argument ${extra[0]}`);
  if (!EPISODE_ID_PATTERN.test(episodeId)) return fail(`invalid episode id "${episodeId}"`);
  if (!filePath.toLowerCase().endsWith('.mp4')) return fail(`"${filePath}" is not an .mp4 file`);
  return {ok: true, args: {episodeId, filePath}};
}
