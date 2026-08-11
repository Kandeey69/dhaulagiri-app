export type TransactionalDatabase = {
  execute: (statement: string, params?: unknown[]) => Promise<unknown>;
};

type StockTransactionOptions = {
  queueKey?: string;
};

const transactionQueues = new Map<object | string, Promise<void>>();
const wait = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
const TRANSACTION_QUEUE_TIMEOUT_MS = 15000;

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

async function waitForQueuedTransaction(previousTransaction: Promise<void>) {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    await Promise.race([
      previousTransaction.catch(() => undefined),
      new Promise<never>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
          reject(new Error("Timed out waiting for previous stock transaction to finish."));
        }, TRANSACTION_QUEUE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

async function beginTransaction(db: TransactionalDatabase) {
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
  let releaseCurrentTransaction!: () => void;
  const currentTransactionToken = new Promise<void>((resolve) => {
    releaseCurrentTransaction = resolve;
  });
  const currentTransaction = previousTransaction.catch(() => undefined).then(() => currentTransactionToken);

  transactionQueues.set(queueKey, currentTransaction);
  await waitForQueuedTransaction(previousTransaction);

  let transactionStarted = false;
  try {
    await beginTransaction(db);
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
