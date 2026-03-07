export function log(event: string, data?: Record<string, unknown>): void {
  const payload = { ts: Date.now(), event, ...(data ?? {}) };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
