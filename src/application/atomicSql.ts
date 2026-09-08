import type Database from '@tauri-apps/plugin-sql'

type Statement = { sql: string; params: unknown[]; expected?: unknown }

/** Stage writes, then execute them on one native connection. Reads are rechecked
 * inside that transaction so a concurrent change cannot invalidate validation. */
export async function stageSqlTransaction<T>(
  db: Database,
  filename: string,
  work: (transaction: Database) => Promise<T>,
  commit?: (filename: string, reads: Statement[], writes: Statement[]) => Promise<void>,
): Promise<T> {
  const reads: Statement[] = []
  const writes: Statement[] = []
  const transaction = {
    select: async <R>(sql: string, params: unknown[] = []): Promise<R> => {
      const result = await db.select<R>(sql, params)
      reads.push({ sql, params, expected: result })
      return result
    },
    execute: async (sql: string, params: unknown[] = []) => {
      writes.push({ sql, params })
      return { rowsAffected: 0, lastInsertId: 0 }
    },
  } as Database
  const result = await work(transaction)
  const commitBatch = commit ?? (async (filename, reads, writes) => {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('commit_sqlite_batch', { filename, reads, writes })
  })
  await commitBatch(filename, reads, writes)
  return result
}
