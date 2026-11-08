export function commandExitStatus(result: {status: number | null; signal?: string | null; error?: unknown}): number {
  if (result.error || result.signal) return result.status || 1;
  return result.status ?? 1;
}
