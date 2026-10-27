process.on('unhandledRejection', (reason) => {
  console.error(reason);
  process.exit(1);
});

import {MIGRATIONS} from '../src/store/migrations';
import {DEFAULT_STUDIO_DB_PATH, openStudioDb} from '../src/store/studioDb';

function main(): void {
  const {db, appliedVersions} = openStudioDb({dbPath: DEFAULT_STUDIO_DB_PATH});
  db.close();

  if (appliedVersions.length > 0) {
    console.log(`applied migrations: ${appliedVersions.join(', ')}`);
    return;
  }
  const latestVersion = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
  console.log(`schema up to date (version ${latestVersion})`);
}

main();
