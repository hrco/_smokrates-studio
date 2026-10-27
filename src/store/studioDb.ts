import {mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MIGRATIONS, type Migration} from './migrations';

export const DEFAULT_STUDIO_DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../studio-data/studio.db',
);

const IN_MEMORY_DB_PATH = ':memory:';
const BUSY_TIMEOUT_MS = 5000;

export type OpenStudioDbOptions = {
  dbPath: string;
  migrations?: readonly Migration[];
};

export type OpenedStudioDb = {
  db: DatabaseSync;
  appliedVersions: number[];
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertMigrationsIncrease(migrations: readonly Migration[]): void {
  let previousVersion = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= previousVersion) {
      throw new Error(
        `migration list is not strictly increasing: version ${migration.version} (${migration.name}) follows ${previousVersion}`,
      );
    }
    previousVersion = migration.version;
  }
}

function readAppliedVersions(db: DatabaseSync): number[] {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  return rows.map((row) => Number(row.version));
}

function assertDatabaseIsNotNewer(appliedVersions: readonly number[], migrations: readonly Migration[]): void {
  const knownVersions = new Set(migrations.map((migration) => migration.version));
  const unknownVersion = appliedVersions.find((version) => !knownVersions.has(version));
  if (unknownVersion !== undefined) {
    throw new Error(`database has migration version ${unknownVersion} that this code does not know: upgrade the code`);
  }
}

function applyMigration(db: DatabaseSync, migration: Migration, nowMs: number): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)').run(
      migration.version,
      migration.name,
      nowMs,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw new Error(`migration ${migration.version} (${migration.name}) failed: ${describeError(error)}`, {
      cause: error,
    });
  }
}

/**
 * Applies every migration the database has not recorded, in order, each in its own transaction.
 * Returns the versions applied; an up-to-date database returns an empty list.
 * Throws when the list is not strictly increasing, when the database holds a version the list lacks,
 * or when a migration fails (that migration is rolled back).
 */
export function applyPendingMigrations(db: DatabaseSync, migrations: readonly Migration[]): number[] {
  assertMigrationsIncrease(migrations);
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at_ms INTEGER NOT NULL)',
  );
  const appliedVersions = readAppliedVersions(db);
  assertDatabaseIsNotNewer(appliedVersions, migrations);

  const pendingMigrations = migrations.filter((migration) => !appliedVersions.includes(migration.version));
  for (const migration of pendingMigrations) applyMigration(db, migration, Date.now());
  return pendingMigrations.map((migration) => migration.version);
}

/**
 * Opens the studio database, creating its folder (mode 0700), and brings the schema up to date.
 * Only the daemon should call this against the default path.
 */
export function openStudioDb(options: OpenStudioDbOptions): OpenedStudioDb {
  const isInMemory = options.dbPath === IN_MEMORY_DB_PATH;
  if (!isInMemory) mkdirSync(path.dirname(options.dbPath), {recursive: true, mode: 0o700});

  const db = new DatabaseSync(options.dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    if (!isInMemory) db.exec('PRAGMA journal_mode = WAL');
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const appliedVersions = applyPendingMigrations(db, options.migrations ?? MIGRATIONS);
    return {db, appliedVersions};
  } catch (error) {
    db.close();
    throw error;
  }
}
