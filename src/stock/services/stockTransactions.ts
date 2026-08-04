export type TransactionalDatabase = {
  execute: (statement: string, params?: unknown[]) => Promise<unknown>;
};

type StockTransactionOptions = {
  queueKey?: string;
};

const transactionQueues = new Map<object | string, Promise<void>>();
const wait = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

function errorText(error: unknown) {
  return String(error instanceof Error ? error.message : error).toLowerCase();
}

function isDatabaseLockedError(error: unknown) {
  const text = errorText(error);
  return text.includes("database is locked") || text.includes("database locked") || text.includes("code: 5");
}

function isOpenTransactionError(error: unknown) {
  return errorText(error).includes("cannot start a transaction within a transaction");
}

async function beginImmediateTransaction(db: TransactionalDatabase) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await db.execute("BEGIN IMMEDIATE TRANSACTION");
      return;
    } catch (error) {
      const canRetry = isDatabaseLockedError(error) || isOpenTransactionError(error);
      if (!canRetry || attempt === 11) {
        throw error;
      }

      if (isOpenTransactionError(error)) {
        await db.execute("ROLLBACK").catch(() => undefined);
      }

      await wait(Math.min(2500, 200 * (attempt + 1)));
    }
  }
}

export async function runStockDbTransaction<T>(
  db: TransactionalDatabase,
  work: () => Promise<T>,
  options: StockTransactionOptions = {},
) {
  const queueKey = options.queueKey ?? db as object;
  const previousTransaction = transactionQueues.get(queueKey) ?? Promise.resolve();
  let releaseCurrentTransaction: () => void = () => undefined;
  const currentTransaction = previousTransaction
    .catch(() => undefined)
    .then(() => new Promise<void>((resolve) => {
      releaseCurrentTransaction = resolve;
    }));

  transactionQueues.set(queueKey, currentTransaction);
  await previousTransaction.catch(() => undefined);

  let transactionStarted = false;
  try {
    await beginImmediateTransaction(db);
    transactionStarted = true;
    const result = await work();
    await db.execute("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      await db.execute("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    releaseCurrentTransaction();
    if (transactionQueues.get(queueKey) === currentTransaction) {
      transactionQueues.delete(queueKey);
    }
  }
}
