# CodeRooms Roadmap (Stability & UX Polish)

## Goals
- Improve reliability on flaky connections and high-change workloads.
- Clarify collaborator state (direct/suggest, follow) and room ownership actions.
- Surface errors clearly for role changes and sync issues.
- Add minimal automated coverage for critical paths.

## Workstream A: Connection & Delivery
- [x] Pending queue with retries on reconnect; de-dup via `messageId`.
- [x] Lightweight ACK/confirmation path (reuse existing server replies where possible).
- [x] Batch resend after reconnect; guard against duplicate application.

## Workstream B: Document Sync Resilience
- [x] Auto retry failed patch once, then fallback to full sync without user action; warn user with retry option.
- [x] Toast when full sync is forced, with “Retry” action.
- [x] (Stretch) Micro-merge: if gap == 1 version, attempt chained patches before full sync.

## Workstream C: Collaborator Clarity
- [x] Status bar clarity: role + mode (direct/suggest) + follow ON/OFF.
- [x] Inline warning when editing non-shared file inside a room.
- [x] Explicit notice when toggling to direct/suggestion mode.

## Workstream D: Roles & Kicking UX
- [x] Show server error messages for role updates/kick; no silent failures.
- [x] Toast for success when owner changes roles or forces viewer; warn if not confirmed in 5s.
- [x] Keep contextual menu visible; disabled state explains owner-only actions.

## Workstream E: Chat & UI Performance
- [x] Limit in-memory chat to last 200 messages; chunk to webview.
- [x] Reduce refresh churn: raised debounce to 180ms; further coalescing TBD.
- [x] Keep People/Work/Suggestions hidden until in-room.

## Workstream F: Tests & Coverage
- [x] Unit tests for patch fallback to full sync (Vitest).
- [x] Unit tests for pending queue + resend on reconnect.
- [x] ChatManager retention test (memory/persist limits).
- [x] DocumentSync patch failure fallback to full sync (unit).
- [x] Integration-lite: simulate share/docChange offline queue with dedup on reconnect.
- [x] Micro-merge gap test for DocumentSync.

## Sequencing Proposal
1. A + B: pending queue with ACK/dup-guard; patch retry + auto full sync + toast.
2. C + D: status/follow clarity, direct/suggest notices, role error surfacing/toasts.
3. E + F: performance tweaks as needed; add core tests for queue/sync flows.

## Notes
- Keep changes backward compatible with current protocol; extend server only if ACK required.
- Prefer user-facing toasts for failures, not silent fallbacks.
- Avoid expanding feature surface; focus on polish and resilience.
