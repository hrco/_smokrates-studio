process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DAEMON_HOST, readDaemonConfig} from '../src/daemon/readDaemonConfig';
import {createStudioServer} from '../src/daemon/studioServer';
import {openStudioDb} from '../src/store/studioDb';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main(): void {
  const configResult = readDaemonConfig(process.env);
  if (!configResult.ok) {
    console.error(`studio-daemon: ${configResult.message}`);
    process.exit(1);
  }
  const {port, dbPath} = configResult.config;
  const {db} = openStudioDb({dbPath});
  const server = createStudioServer({
    db,
    nowMs: () => Date.now(),
    newId: () => randomUUID(),
    outDir: path.join(PROJECT_ROOT, 'out'),
    webDir: path.join(PROJECT_ROOT, 'web'),
  });

  server.on('error', (error) => {
    console.error(`studio-daemon: could not listen on ${DAEMON_HOST}:${port}: ${error.message}`);
    db.close();
    process.exit(1);
  });
  server.listen(port, DAEMON_HOST, () => {
    console.log(`studio daemon: http://${DAEMON_HOST}:${port} (database ${dbPath})`);
  });

  const shutDown = (): void => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeAllConnections();
  };
  process.on('SIGINT', shutDown);
  process.on('SIGTERM', shutDown);
}

main();
