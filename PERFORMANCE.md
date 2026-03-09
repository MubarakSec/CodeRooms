# Performance Budgets

This file defines the repeatable Milestone 7 performance harness for CodeRooms.

Run it with:

```bash
npm run perf:profile
```

The harness lives in [tests/performanceProfile.test.ts](tests/performanceProfile.test.ts) and profiles three UI-critical paths across 10, 25, and 50 participant room shapes:

- Participants panel refresh plus tree materialization
- Cursor decoration refresh
- Chat sliding-window diffing

It also measures a synthetic recovery cycle that rebuilds the panel, cursor decorations, and chat render plan together. This is the local proxy for reconnect UI responsiveness. Live reconnect-storm and restart-recovery coverage now lives in [tests/serverStress.test.ts](tests/serverStress.test.ts); packaged-extension soak validation remains part of Milestone 8.

## Scenario Shapes

| Scenario | Participants | Documents | Suggestions | Patches / Suggestion | Chat Window |
|----------|--------------|-----------|-------------|----------------------|-------------|
| `room-10` | 10 | 3 | 12 | 2 | 80 |
| `room-25` | 25 | 4 | 30 | 3 | 160 |
| `room-50` | 50 | 6 | 75 | 3 | 200 |

## P95 Budgets

| Scenario | Panel Render | Cursor Refresh | Chat Diff | Recovery Cycle |
|----------|--------------|----------------|-----------|----------------|
| `room-10` | 35 ms | 20 ms | 5 ms | 45 ms |
| `room-25` | 65 ms | 30 ms | 6 ms | 80 ms |
| `room-50` | 100 ms | 50 ms | 8 ms | 120 ms |

These budgets are defined in [src/perf/performanceBudgets.ts](src/perf/performanceBudgets.ts).

## Current Baseline

Measured locally on 2026-03-08 with `npm run perf:profile`.

| Scenario | Panel P95 | Cursor P95 | Chat P95 | Recovery P95 |
|----------|-----------|------------|----------|--------------|
| `room-10` | 2.43 ms | 0.38 ms | 0.004 ms | 2.07 ms |
| `room-25` | 5.24 ms | 0.51 ms | 0.006 ms | 6.98 ms |
| `room-50` | 14.90 ms | 0.98 ms | 0.008 ms | 12.92 ms |

## How To Use It

- Run `npm run perf:profile` before shipping UI-heavy changes.
- If the harness fails, inspect the changed hot path before relaxing a budget.
- If a budget truly needs to move, update [src/perf/performanceBudgets.ts](src/perf/performanceBudgets.ts) and record the reason in the PR or release notes.
