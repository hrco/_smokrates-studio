import type {DatabaseSync} from 'node:sqlite';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the work inside one write transaction. Commits when the work returns, rolls back when it throws.
 * A thrown error keeps the operation name and the original cause. Transactions do not nest.
 */
export function runInTransaction<Result>(db: DatabaseSync, operation: string, work: () => Result): Result {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw new Error(`${operation} failed: ${describeError(error)}`, {cause: error});
  }
}
