import {mkdtemp, rm, stat} from 'node:fs/promises';
import {mkdtempSync, rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {type Migration, MIGRATIONS} from '../src/store/migrations';
import {applyPendingMigrations, openStudioDb} from '../src/store/studioDb';

const EXPECTED_TABLES = [
  'assets',
  'canon',
  'episodes',
  'jobs',
  'plans',
  'publishes',
  'renders',
  'schema_migrations',
];

function listTableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  return rows.map((row) => String(row.name));
}

function openMemoryDb(): DatabaseSync {
  return openStudioDb({dbPath: ':memory:'}).db;
}

function insertPlan(db: DatabaseSync, weekStart = '2026-10-19'): void {
  db.prepare("INSERT INTO plans (week_start, status, created_at_ms) VALUES (?, 'draft', 1)").run(weekStart);
}

function insertEpisode(db: DatabaseSync, options: {id: string; weekStart?: string; night?: number; status?: string}): void {
  db.prepare(
    `INSERT INTO episodes (id, week_start, night, format, track_slug, start_second, duration_seconds,
       claim, caption, publish_at_ms, label_decision, status)
     VALUES (?, ?, ?, 'track_card', 'slug', 0, 15, 'claim', 'caption', 1, 'label_on', ?)`,
  ).run(options.id, options.weekStart ?? '2026-10-19', options.night ?? 1, options.status ?? 'planned');
}

function insertPublish(db: DatabaseSync, options: {id: string; episodeId: string; platform: string}): void {
  db.prepare(
    `INSERT INTO publishes (id, episode_id, platform, status, created_at_ms)
     VALUES (?, ?, ?, 'processing', 1)`,
  ).run(options.id, options.episodeId, options.platform);
}

function insertJob(db: DatabaseSync, options: {id: string; kind: string; status: string}): void {
  db.prepare(
    'INSERT INTO jobs (id, kind, status, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 1, 1)',
  ).run(options.id, options.kind, options.status);
}

describe('openStudioDb', () => {
  it('applies the initial migration to a fresh database', () => {
    const {db, appliedVersions} = openStudioDb({dbPath: ':memory:'});

    expect(appliedVersions).toEqual(MIGRATIONS.map((migration) => migration.version));
    expect(listTableNames(db)).toEqual(EXPECTED_TABLES);
    expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({foreign_keys: 1});
  });

  it('applies nothing the second time', () => {
    const {db} = openStudioDb({dbPath: ':memory:'});

    expect(applyPendingMigrations(db, MIGRATIONS)).toEqual([]);
  });

  describe('with a file database', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(path.join(os.tmpdir(), 'studio-db-'));
    });

    afterEach(async () => {
      await rm(tempDir, {recursive: true, force: true});
    });

    it('creates the parent directory, keeps data on reopen and applies nothing', async () => {
      const dbPath = path.join(tempDir, 'studio-data', 'studio.db');
      const first = openStudioDb({dbPath});
      insertPlan(first.db);
      first.db.close();

      const second = openStudioDb({dbPath});

      expect(second.appliedVersions).toEqual([]);
      expect(second.db.prepare('SELECT week_start FROM plans').all()).toEqual([
        expect.objectContaining({week_start: '2026-10-19'}),
      ]);
      expect((await stat(path.dirname(dbPath))).mode & 0o777).toBe(0o700);
      expect(second.db.prepare('PRAGMA journal_mode').get()).toMatchObject({journal_mode: 'wal'});
      second.db.close();
    });
  });
});

describe('applyPendingMigrations', () => {
  it('rejects a duplicate version and names it', () => {
    const migrations = [
      {version: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER)'},
      {version: 1, name: 'again', sql: 'CREATE TABLE again (id INTEGER)'},
    ];

    expect(() => openStudioDb({dbPath: ':memory:', migrations})).toThrow(/version 1/);
  });

  it('rejects a version that goes backwards and names it', () => {
    const migrations = [
      {version: 2, name: 'two', sql: 'CREATE TABLE two (id INTEGER)'},
      {version: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER)'},
    ];

    expect(() => openStudioDb({dbPath: ':memory:', migrations})).toThrow(/version 1/);
  });

  it('rolls back a failing migration and names its version', () => {
    const migrations = [
      {version: 1, name: 'good', sql: 'CREATE TABLE good (id INTEGER)'},
      {version: 2, name: 'broken', sql: 'CREATE TABLE half (id INTEGER); CREATE TABLE half (id INTEGER)'},
    ];
    const db = new DatabaseSync(':memory:');

    expect(() => applyPendingMigrations(db, migrations)).toThrow(/migration 2 \(broken\)/);

    expect(listTableNames(db)).toEqual(['good', 'schema_migrations']);
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([
      expect.objectContaining({version: 1}),
    ]);
  });

  it('refuses a database that is newer than the code', () => {
    const db = new DatabaseSync(':memory:');
    applyPendingMigrations(db, [
      {version: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER)'},
      {version: 2, name: 'two', sql: 'CREATE TABLE two (id INTEGER)'},
    ]);

    expect(() =>
      applyPendingMigrations(db, [{version: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER)'}]),
    ).toThrow(/version 2/);
  });
});

describe('initial schema constraints', () => {
  it('allows one publish per episode and platform', () => {
    const db = openMemoryDb();
    insertPlan(db);
    insertEpisode(db, {id: 'ep-1'});
    insertPublish(db, {id: 'pub-1', episodeId: 'ep-1', platform: 'tiktok'});

    expect(() => insertPublish(db, {id: 'pub-2', episodeId: 'ep-1', platform: 'tiktok'})).toThrow();
    expect(() => insertPublish(db, {id: 'pub-3', episodeId: 'ep-1', platform: 'youtube'})).not.toThrow();
  });

  it('rejects an unknown episode status', () => {
    const db = openMemoryDb();
    insertPlan(db);

    expect(() => insertEpisode(db, {id: 'ep-1', status: 'published'})).toThrow();
  });

  it('rejects a week start that is not a date', () => {
    const db = openMemoryDb();

    expect(() => insertPlan(db, 'next week')).toThrow();
  });

  it('rejects two episodes on the same night of a week', () => {
    const db = openMemoryDb();
    insertPlan(db);
    insertEpisode(db, {id: 'ep-1', night: 3});

    expect(() => insertEpisode(db, {id: 'ep-2', night: 3})).toThrow();
  });

  it('enforces foreign keys', () => {
    const db = openMemoryDb();

    expect(() => insertEpisode(db, {id: 'ep-1', weekStart: '2030-01-01'})).toThrow();
  });

  it('deletes episodes with their plan', () => {
    const db = openMemoryDb();
    insertPlan(db);
    insertEpisode(db, {id: 'ep-1'});

    db.prepare('DELETE FROM plans').run();

    expect(db.prepare('SELECT id FROM episodes').all()).toEqual([]);
  });

  it('requires a parent still for a clip asset', () => {
    const db = openMemoryDb();
    const insertAsset = db.prepare(
      `INSERT INTO assets (id, kind, parent_asset_id, grok_tool, prompt, file_path, created_at_ms)
       VALUES (?, ?, ?, 'image_edit', 'p', 'f', 1)`,
    );

    expect(() => insertAsset.run('clip-1', 'clip', null)).toThrow();
    insertAsset.run('still-1', 'still', null);
    expect(() => insertAsset.run('clip-2', 'clip', 'still-1')).not.toThrow();
  });

  it('allows one running render or asset job at a time', () => {
    const db = openMemoryDb();
    insertJob(db, {id: 'job-1', kind: 'render', status: 'running'});

    expect(() => insertJob(db, {id: 'job-2', kind: 'asset', status: 'running'})).toThrow();
    expect(() => insertJob(db, {id: 'job-3', kind: 'render', status: 'running'})).toThrow();
  });

  it('allows a running send job next to a running render', () => {
    const db = openMemoryDb();
    insertJob(db, {id: 'job-1', kind: 'render', status: 'running'});

    expect(() => insertJob(db, {id: 'job-2', kind: 'send', status: 'running'})).not.toThrow();
  });

  it('allows a second render once the first has succeeded', () => {
    const db = openMemoryDb();
    insertJob(db, {id: 'job-1', kind: 'render', status: 'running'});
    db.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = 'job-1'").run();

    expect(() => insertJob(db, {id: 'job-2', kind: 'render', status: 'running'})).not.toThrow();
  });
});

describe('applyPendingMigrations – stale pre-read (concurrent connections)', () => {
  const v1: Migration = {version: 1, name: 'init', sql: 'CREATE TABLE one (id INTEGER)'};
  const v2: Migration = {version: 2, name: 'second', sql: 'CREATE TABLE two (id INTEGER)'};

  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'studio-db-concurrent-'));
  });

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true});
  });

  it('skips a version already applied by another connection and does not throw', () => {
    const dbPath = path.join(tempDir, 'race.db');

    // Connection A applies v1 and commits.
    const dbA = new DatabaseSync(dbPath);
    dbA.exec('PRAGMA journal_mode = WAL');
    applyPendingMigrations(dbA, [v1]);
    dbA.close();

    // Connection B has a stale pre-read: it read schema_migrations before A committed
    // and saw an empty list. Simulate that by passing [] as the pre-read list.
    const dbB = new DatabaseSync(dbPath);
    dbB.exec('PRAGMA journal_mode = WAL');
    // Must not throw even though B thinks v1 is pending.
    const applied = applyPendingMigrations(dbB, [v1], []);

    expect(applied).toEqual([]);
    // v1 is in the table exactly once.
    expect(dbB.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toMatchObject({n: 1});
    dbB.close();
  });

  it('applies a genuinely pending version and records it once when pre-read is stale', () => {
    const dbPath = path.join(tempDir, 'partial.db');

    // Connection A applies v1 only.
    const dbA = new DatabaseSync(dbPath);
    dbA.exec('PRAGMA journal_mode = WAL');
    applyPendingMigrations(dbA, [v1]);
    dbA.close();

    // Connection B has a stale pre-read (saw nothing applied) but v2 is genuinely new.
    const dbB = new DatabaseSync(dbPath);
    dbB.exec('PRAGMA journal_mode = WAL');
    const applied = applyPendingMigrations(dbB, [v1, v2], []);

    // v1 skipped (already applied), v2 applied.
    expect(applied).toEqual([2]);
    expect(dbB.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toMatchObject({n: 2});
    dbB.close();
  });
});
