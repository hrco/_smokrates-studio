import type {DatabaseSync} from 'node:sqlite';

/** The Health of docs/openapi.yaml. */
export type StudioHealth = {
  isUp: true;
  schemaVersion: number;
  isWorkerBusy: boolean;
};

export function readStudioHealth(db: DatabaseSync): StudioHealth {
  const versionRow = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  const busyRow = db
    .prepare("SELECT 1 AS found FROM jobs WHERE status = 'running' AND kind IN ('render', 'asset') LIMIT 1")
    .get();
  return {isUp: true, schemaVersion: Number(versionRow?.version ?? 0), isWorkerBusy: busyRow !== undefined};
}
