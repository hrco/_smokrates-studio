import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {failure, REQUEST_TIMEOUT_MS, type FetchFn, type InstagramResult} from './types';

export const STAGING_REMOTE_DIR = '/srv/sites/nopanicpost/ig-staging';
export const STAGING_PUBLIC_BASE_URL = 'https://nopanicpost.donotpanic.space/ig-staging';

const DEFAULT_SSH_USER = 'ubuntu';
const DEFAULT_SSH_KEY_PATH = '~/.ssh/oracle-vps.key';
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const STAGED_NAME_PATTERN = /^[0-9a-f]{32}\.mp4$/;

export type StagingConfig = {host: string; user: string; keyPath: string};

export type CommandOutcome = {exitCode: number; stderr: string};

/** Runs a program with an argument array. Never builds a shell string. */
export interface CommandRunner {
  run(program: string, args: string[]): Promise<CommandOutcome>;
}

export type StagedVideo = {remoteName: string; remotePath: string; publicUrl: string};

/** Reads VPS_HOST (required), VPS_SSH_USER and VPS_SSH_KEY with the same defaults as scripts/deploy-site.sh. */
export function readStagingConfig(env: NodeJS.ProcessEnv): InstagramResult<StagingConfig> {
  const operation = 'read-staging-config';
  const host = env.VPS_HOST;
  if (!host) return failure(operation, 'missing-host', 'set VPS_HOST to the Oracle box address');
  if (!/^[A-Za-z0-9.:-]+$/.test(host)) return failure(operation, 'bad-host', 'VPS_HOST has characters outside letters, digits, dot, colon and dash');
  const user = env.VPS_SSH_USER || DEFAULT_SSH_USER;
  if (!/^[a-z_][a-z0-9_-]*$/.test(user)) return failure(operation, 'bad-user', 'VPS_SSH_USER is not a plain user name');
  const rawKeyPath = env.VPS_SSH_KEY || DEFAULT_SSH_KEY_PATH;
  const keyPath = rawKeyPath.startsWith('~') ? homedir() + rawKeyPath.slice(1) : rawKeyPath;
  return {ok: true, value: {host, user, keyPath}};
}

export function createStagedName(): string {
  return `${randomBytes(16).toString('hex')}.mp4`;
}

export function isStagedName(name: string): boolean {
  return STAGED_NAME_PATTERN.test(name);
}

export function createExecFileRunner(): CommandRunner {
  return {
    run: (program, args) =>
      new Promise((resolve) => {
        execFile(program, args, {timeout: COMMAND_TIMEOUT_MS}, (error, _stdout, stderr) => {
          if (!error) return resolve({exitCode: 0, stderr});
          const exitCode = typeof error.code === 'number' ? error.code : 1;
          resolve({exitCode, stderr: stderr || error.message});
        });
      }),
  };
}

function connectionOptions(config: StagingConfig): string[] {
  return ['-i', config.keyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
}

/** The remote command is built only from constants and a validated staged name. */
export function buildSshArgs(config: StagingConfig, remoteCommand: string): string[] {
  return [...connectionOptions(config), `${config.user}@${config.host}`, remoteCommand];
}

export function buildScpArgs(config: StagingConfig, input: {localPath: string; remoteName: string}): string[] {
  return [
    ...connectionOptions(config),
    '--',
    input.localPath,
    `${config.user}@${config.host}:${STAGING_REMOTE_DIR}/${input.remoteName}`,
  ];
}

export function toRemotePath(remoteName: string): string {
  return `${STAGING_REMOTE_DIR}/${remoteName}`;
}

export function toPublicUrl(remoteName: string): string {
  return `${STAGING_PUBLIC_BASE_URL}/${remoteName}`;
}

function describeFailure(program: string, outcome: CommandOutcome): string {
  const stderr = outcome.stderr.trim().slice(0, 300);
  return `${program} exited ${outcome.exitCode}${stderr ? `: ${stderr}` : ''}`;
}

async function runStep(input: {
  runner: CommandRunner;
  operation: string;
  program: string;
  args: string[];
  remoteName: string;
}): Promise<InstagramResult<null>> {
  const outcome = await input.runner.run(input.program, input.args);
  if (outcome.exitCode === 0) return {ok: true, value: null};
  return failure(input.operation, `${input.program}-failed`, `${describeFailure(input.program, outcome)} (staged file ${input.remoteName})`);
}

/** Copies a local mp4 into the public staging folder under a random name. The caller must call unstageVideo afterwards. */
export async function stageVideo(
  input: {localPath: string; config: StagingConfig},
  runner: CommandRunner,
  remoteName: string = createStagedName(),
): Promise<InstagramResult<StagedVideo>> {
  const operation = 'stage-video';
  if (!isStagedName(remoteName)) return failure(operation, 'bad-name', 'staged name is not 32 hex characters plus .mp4');
  const {config, localPath} = input;
  const steps = [
    {program: 'ssh', args: buildSshArgs(config, `mkdir -p ${STAGING_REMOTE_DIR}`)},
    {program: 'scp', args: buildScpArgs(config, {localPath, remoteName})},
    {program: 'ssh', args: buildSshArgs(config, `chmod a+r ${toRemotePath(remoteName)}`)},
  ];
  for (const step of steps) {
    const result = await runStep({runner, operation, remoteName, ...step});
    if (!result.ok) return result;
  }
  return {ok: true, value: {remoteName, remotePath: toRemotePath(remoteName), publicUrl: toPublicUrl(remoteName)}};
}

/** Removes exactly one staged file. Rejects any name that is not 32 hex characters plus .mp4 before building a command. */
export async function unstageVideo(
  input: {remoteName: string; config: StagingConfig},
  runner: CommandRunner,
): Promise<InstagramResult<null>> {
  const operation = 'unstage-video';
  if (!isStagedName(input.remoteName)) return failure(operation, 'bad-name', 'refusing to remove a name that is not 32 hex characters plus .mp4');
  return runStep({
    runner,
    operation,
    remoteName: input.remoteName,
    program: 'ssh',
    args: buildSshArgs(input.config, `rm -f ${toRemotePath(input.remoteName)}`),
  });
}

/** Confirms the public URL answers 200 with the same size as the local file, as Meta will see it. */
export async function checkUrlReachable(
  input: {publicUrl: string; expectedSizeBytes: number},
  fetchFn: FetchFn,
): Promise<InstagramResult<null>> {
  const operation = 'check-url-reachable';
  const response = await fetchFn(input.publicUrl, {method: 'HEAD', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)}).catch(
    (error: unknown) => (error instanceof Error ? error : new Error('request failed')),
  );
  if (response instanceof Error) return failure(operation, 'request-failed', `${response.message} (${input.publicUrl})`);
  if (response.status !== 200) return failure(operation, 'bad-status', `HTTP ${response.status} (${input.publicUrl})`);
  const reportedSize = response.headers.get('content-length');
  if (reportedSize !== String(input.expectedSizeBytes)) {
    return failure(operation, 'size-mismatch', `content-length ${reportedSize ?? 'missing'}, expected ${input.expectedSizeBytes} (${input.publicUrl})`);
  }
  return {ok: true, value: null};
}
