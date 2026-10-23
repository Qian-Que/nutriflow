import { AsyncLocalStorage } from 'node:async_hooks';

const budget = new AsyncLocalStorage<{ signal: AbortSignal }>();
export const recognitionTimeoutMs = Math.max(1000, Math.min(180000, Number(process.env.RECOGNITION_TIMEOUT_MS) || 150000));
export function withAIBudget<T>(run: () => Promise<T>): Promise<T> {
  return budget.run({ signal: AbortSignal.timeout(recognitionTimeoutMs) }, run);
}
export function aiSignal(local: AbortSignal): AbortSignal {
  const parent = budget.getStore()?.signal;
  parent?.throwIfAborted();
  return parent ? AbortSignal.any([local, parent]) : local;
}
