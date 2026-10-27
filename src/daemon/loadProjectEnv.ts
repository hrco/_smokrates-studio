import {existsSync} from 'node:fs';
import path from 'node:path';

/**
 * Loads the repo env file from the project root.
 * launchd and a shell can start the daemon with some other working directory.
 */
export function loadProjectEnv(projectRoot: string): void {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  process.loadEnvFile(envPath);
}
