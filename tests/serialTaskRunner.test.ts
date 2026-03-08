import { describe, expect, it } from 'vitest';
import { createSerialTaskRunner } from '../server/serialTaskRunner';

describe('serial task runner', () => {
  it('runs overlapping tasks sequentially', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;

    const run = createSerialTaskRunner(
      async () => {
        const index = events.filter(event => event.startsWith('start')).length + 1;
        events.push(`start-${index}`);
        if (index === 1) {
          await new Promise<void>(resolve => {
            releaseFirst = resolve;
          });
        }
        events.push(`end-${index}`);
      },
      () => {}
    );

    const first = run();
    const second = run();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(events).toEqual(['start-1']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('logs errors and continues processing later tasks', async () => {
    const errors: string[] = [];
    let runs = 0;

    const run = createSerialTaskRunner(
      async () => {
        runs += 1;
        if (runs === 1) {
          throw new Error('boom');
        }
      },
      error => {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    );

    await run();
    await run();

    expect(errors).toEqual(['boom']);
    expect(runs).toBe(2);
  });
});
