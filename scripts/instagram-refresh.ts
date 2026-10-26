process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {existsSync} from 'node:fs';
import {createFileTokenStore, refreshAndSaveToken} from '../src/instagram/token';

function exitWithError(message: string): never {
  console.error(`instagram-refresh: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const refreshed = await refreshAndSaveToken(
    {store: createFileTokenStore(), env: process.env, nowMs: Date.now()},
    fetch,
  );
  if (!refreshed.ok) {
    const {operation, code, detail} = refreshed.error;
    return exitWithError(`${operation}: ${code} ${detail}`);
  }
  console.log(`token refreshed and saved to .instagram/token.json; expires ${refreshed.value.expiresAt}`);
}

await main();
