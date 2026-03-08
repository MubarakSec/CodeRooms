# CodeRooms Roadmap

## Purpose

This roadmap turns the current audit findings into an execution plan that moves CodeRooms from "promising prototype" to a reliable, secure, polished collaboration tool.

The priorities below focus on four outcomes:

- Make collaboration state correct and recoverable.
- Make the protocol secure and harder to misuse.
- Make the UI feel intentional, fast, and easier to understand.
- Make production failures observable and easier to debug.

## North Star

CodeRooms should feel production-ready for small teams and classrooms:

- Room state survives reconnects and restarts without corrupting ownership or collaboration state.
- Suggestion, chat, and document sync flows are deterministic and testable.
- The UI is visually cleaner, less noisy, and faster under load.
- Common failures are handled gracefully instead of leaving the system in a half-broken state.

## Guiding Principles

- Server-authoritative state for all critical collaboration flows.
- Idempotent and explicit protocol behavior.
- Fail closed for authz/security, fail safe for UX.
- No silent drops for tracked actions.
- Every major bug class must have automated coverage.
- UI changes should improve both clarity and performance.

## Current Risk Snapshot

The highest current risks are:

- Baseline CI, linting, coverage thresholds, and release guardrails from Milestone 0 are still not in place.
- Milestone 7 performance/scalability work is still ahead, especially tree refresh pressure, cursor repaint churn, and larger-room profiling.
- The code is materially safer now, but it still needs longer-duration soak testing and multi-client load validation before calling it production-hardened.

## Progress Snapshot

Current implementation status:

- Milestones 1 through 6 are complete and verified by the current automated suite.
- The latest verification pass is green for `npm run typecheck`, `npm test`, and `npm run server:build`.
- Milestone 0 and Milestone 7 remain the active roadmap tracks.

Next focus:

- Milestone 0 baseline guardrails.
- Milestone 7 performance and scalability.
- Additional soak/load testing once the remaining guardrails are in place.

## Milestone 0: Baseline and Guardrails

Goal: stop regressions while larger refactors are in flight.

- [ ] Add CI gates for `npm test`, `npm run typecheck`, and `npm run server:build`.
- [ ] Add a linting pass for client, shared, and server code.
- [ ] Add a small multi-client integration harness for protocol scenarios.
- [ ] Add coverage reporting and require minimum thresholds for core modules.
- [ ] Add a release checklist for restart, reconnect, suggestions, and multi-document sync.
- [ ] Add a dedicated "protocol invariants" test suite for authz and room lifecycle.

Success criteria:

- Every PR runs the core verification pipeline.
- Critical collaboration flows have reproducible tests, not just manual validation.

## Milestone 1: Room Lifecycle and Ownership Correctness

Goal: make rooms behave correctly across joins, leaves, reconnects, and restarts.

- [x] Fix restored-room ownership so the original owner can reclaim the room after restart.
- [x] Stop restoring stale live participant membership from disk.
- [x] Clean up previous room membership before a socket joins or creates a new room.
- [x] Add explicit room/session identity separate from transient connection `userId`.
- [x] Add server-side room membership invariants and assert them in tests.
- [x] Ensure root shutdown cleanly notifies clients and persists only valid recoverable state.
- [x] Add duplicate join/create request protection per connection and per room.
- [x] Make reconnect semantics explicit: reconnect to same session, or join as a new session.

Representative coverage:

- [x] Restart with an active room and reclaim owner identity after restore.
- [x] Reconnect the root while collaborators remain active and preserve session semantics.
- [x] Room-switch cleanup and duplicate join/create protection prevent ghost membership.
- [x] Owner-driven room closure clears live session state deterministically.

Success criteria:

- No ownerless rooms after restart.
- No stale participants after reconnect or room switch.

## Milestone 2: Document Sync Correctness

Goal: make document state consistent across multiple files, reconnects, and concurrent edits.

- [x] Fix active document tracking so manual editor switches do not disable sync.
- [x] Separate "focused editor" from "active shared document" state.
- [x] Add idempotency guards for `shareDocument`, `unshareDocument`, and repeated reconnect replays.
- [x] Ensure every tracked outbound document action receives a terminal `ack` or `error`.
- [x] Review OT fallback logic for no-op transforms and define explicit outcomes.
- [x] Add bounds and validation for patch shapes, ranges, and selection payload sizes.
- [x] Reduce silent returns in server message handlers; prefer typed errors for invalid state.
- [x] Add document state reconciliation flow for reconnects and partial desyncs.

Representative coverage:

- [x] Multiple shared documents keep syncing across manual tab switches.
- [x] Reconnect during pending offline edits does not duplicate tracked replay.
- [x] Invalid patch ranges fail with deterministic validation/error behavior.
- [x] Concurrent edit shapes remain consistent through patch/OT coverage.

Success criteria:

- Multi-document collaboration works without manual command intervention.
- Reconnect does not duplicate or drop tracked edits.

## Milestone 3: Suggestion Workflow Hardening

Goal: make suggestions reliable, replayable, and server-authoritative.

- [x] Keep suggestions visible if the owner dismisses the prompt without deciding.
- [x] Replace local-only "Clear all suggestions" with a server-backed action.
- [x] Replay pending suggestions to the owner on rejoin and restart recovery.
- [x] Add deduplication/idempotency for repeated `acceptSuggestion` and `rejectSuggestion`.
- [x] Persist suggestion status transitions explicitly.
- [x] Make the server the only source of truth for suggestion lifecycle state.
- [x] Add bulk reject and bulk review APIs/messages with audit-safe behavior.
- [x] Reduce intrusive modal-like prompt behavior in favor of a persistent review queue.

Representative coverage:

- [x] Queue-driven review leaves suggestions pending until an explicit review action.
- [x] Bulk review actions clear both client and server state through server-backed APIs.
- [x] Restart and rejoin paths replay pending suggestions to the owner.
- [x] Repeated review decisions are idempotent or return deterministic conflicts.

Success criteria:

- Suggestion review survives reconnects and restarts.
- No local/server divergence in pending suggestion state.

## Milestone 4: Security and Abuse Resistance

Goal: close obvious misuse paths and tighten protocol validation.

- [x] Replace loose runtime validation with strict per-message schema validation.
- [x] Validate enum values for role, mode, activity, and all discriminated unions.
- [x] Add authz checks to every privileged action and return explicit errors.
- [x] Add throttling for `cursorUpdate` and `participantActivity`.
- [x] Add payload caps for selections arrays, file labels, and invite labels.
- [x] Review storage and filesystem writes for path safety and unexpected overwrite paths.
- [x] Harden room join logic against brute force and room enumeration.
- [x] Review token generation, expiration, and invalidation behavior.
- [x] Add structured security tests for forged identities and broken access control.
- [x] Document deployment expectations for TLS/reverse proxy and local-only defaults.

Security checklist:

- [x] Broken access control review complete.
- [x] Input validation review complete.
- [x] Replay/duplicate request review complete.
- [x] Sensitive data/logging review complete.
- [x] Abuse-rate limiting review complete.

Success criteria:

- No client-controlled privilege or identity fields are trusted without server validation.
- High-frequency protocol spam is bounded.

## Milestone 5: Persistence, Recovery, and Operational Safety

Goal: make disk persistence and restart behavior reliable under failure.

- [x] Add a save mutex/queue so autosave operations cannot overlap.
- [x] Catch and log autosave failures explicitly.
- [x] Add corruption handling for backup and metadata files.
- [x] Version persisted room state for future migrations.
- [x] Decide and document exactly what is recoverable after restart.
- [x] Add cleanup/TTL policy for old room storage and event logs.
- [x] Add recovery telemetry/logging for load/save/migration paths.
- [x] Validate room/accounting rebuild on startup.

Representative coverage:

- [x] Simulate concurrent autosaves through the serialized save runner.
- [x] Simulate rename/write failure for backup files.
- [x] Start with corrupted backup JSON.
- [x] Verify accounting rebuild for restored documents and rooms.

Success criteria:

- No unhandled persistence failures.
- Restart behavior is deterministic and documented.

## Milestone 6: UI/UX Refactor

Goal: give CodeRooms a noticeably better visual hierarchy and a smoother collaboration experience.

### UX Goals

- Reduce prompt fatigue.
- Make room state easier to parse at a glance.
- Make suggestions and collaboration modes obvious.
- Improve discoverability of key actions without clutter.

### Visual Refactor Checklist

- [x] Redesign the participants panel into clearer sections: session, work, people, review.
- [x] Replace overly verbose text with stronger labels, spacing, and icon grouping.
- [x] Turn suggestions into a persistent review workflow instead of prompt-driven interruptions.
- [x] Improve chat layout density, timestamps, grouping, and empty/loading states.
- [x] Make status bar states clearer and more consistent across offline/connecting/reconnecting/error states.
- [x] Improve command naming and in-panel action wording for less ambiguity.
- [x] Add clearer ownership and edit-mode indicators.
- [x] Review typography, spacing, and color contrast across views.
- [x] Add keyboard-friendly actions for common flows.
- [x] Add accessibility review for screen reader text, focus handling, and contrast.

### UX Architecture Refactor

- [x] Move ad-hoc UI text generation into dedicated helpers/view models.
- [x] Separate presentation state from protocol state.
- [x] Replace one-off prompt decisions with panel-driven review queues where possible.
- [x] Standardize empty states, warning states, and recovery actions.
- [x] Add view-state tests for role-specific panel behavior.

Success criteria:

- A new user can understand room state, role, active file, and pending actions within a few seconds.
- Suggestion review no longer depends on transient prompts.

## Milestone 7: Performance and Scalability

Goal: keep the extension responsive with larger rooms, more suggestions, and more document activity.

- [ ] Measure tree refresh frequency and eliminate unnecessary full refreshes.
- [ ] Diff cursor decorations instead of repainting everything on every update.
- [ ] Batch participant/activity UI updates.
- [ ] Throttle expensive `showWarningMessage` and prompt paths more aggressively.
- [ ] Reduce redundant `openTextDocument` / `showTextDocument` churn.
- [ ] Add virtualization or chunking where the chat/review lists can grow large.
- [ ] Cap expensive markdown/tooltip generation for large suggestion sets.
- [ ] Add targeted profiling for 10, 25, 50+ participant rooms.
- [ ] Define and measure extension responsiveness budgets.

Performance targets:

- [ ] Panel refresh under 100 ms for normal rooms.
- [ ] No noticeable typing lag with 25 participants.
- [ ] Reconnect recovery completes without UI lockups.

## Milestone 8: Release Readiness

Goal: ship a confident, testable, supportable version.

- [ ] Finalize the supported deployment model and document it.
- [ ] Add production logging guidance and troubleshooting docs.
- [ ] Add migration notes for persisted room state changes.
- [ ] Create a manual QA checklist for VS Code extension behavior.
- [ ] Run stress tests for reconnect storms and restart recovery.
- [ ] Run a security review focused on protocol misuse.
- [ ] Package a release candidate and validate it in a clean environment.

Release gates:

- [ ] No critical or high open issues in room lifecycle, document sync, or suggestions.
- [ ] Restart and reconnect suites pass.
- [ ] UI review pass complete.
- [ ] Security review pass complete.

## Suggested Delivery Order

### Phase 1

- Milestone 0
- Milestone 1
- Milestone 2

### Phase 2

- Milestone 3
- Milestone 4
- Milestone 5

### Phase 3

- Milestone 6
- Milestone 7
- Milestone 8

## Definition of Done for the "Big Leap"

CodeRooms has made a major jump when all of the following are true:

- [ ] Room restart/recovery is trustworthy.
- [ ] Multi-document collaboration is stable.
- [ ] Suggestion workflow is persistent and server-authoritative.
- [ ] Security validation is strict and abuse-resistant.
- [ ] The extension UI is cleaner, more intentional, and less interruptive.
- [ ] Performance remains acceptable under realistic collaborative load.
- [ ] The release pipeline can catch regressions before shipping.
