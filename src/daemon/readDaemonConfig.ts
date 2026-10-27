import path from 'node:path';
import {DEFAULT_STUDIO_DB_PATH} from '../store/studioDb';

export const DEFAULT_DAEMON_PORT = 8724;
export const DAEMON_HOST = '127.0.0.1';

export type DaemonConfig = {port: number; dbPath: string};

export type ReadDaemonConfigResult = {ok: true; config: DaemonConfig} | {ok: false; message: string};

/**
 * Reads STUDIO_PORT (default 8724) and STUDIO_DB_PATH (default studio-data/studio.db) from the environment.
 * The host is not configurable: the daemon binds to 127.0.0.1 only.
 */
export function readDaemonConfig(env: Readonly<Record<string, string | undefined>>): ReadDaemonConfigResult {
  const rawPort = env.STUDIO_PORT;
  const port = rawPort === undefined || rawPort === '' ? DEFAULT_DAEMON_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {ok: false, message: `STUDIO_PORT must be a whole number from 1 to 65535, got "${rawPort}"`};
  }
  const rawDbPath = env.STUDIO_DB_PATH;
  const dbPath = rawDbPath === undefined || rawDbPath === '' ? DEFAULT_STUDIO_DB_PATH : path.resolve(rawDbPath);
  return {ok: true, config: {port, dbPath}};
}
