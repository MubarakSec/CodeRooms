# Final Polish Implementation Plan

This plan covers the final set of robustness, UX, and feature enhancements for CodeRooms.

## Task 2: Server Rate Limiting & Abuse Prevention
**Goal:** Protect the WebSocket server from spam and large payload abuse.
- [ ] Check existing `server/rateLimiter.ts`.
- [ ] Implement maximum payload size checks on incoming WebSocket messages before unpacking.
- [ ] Implement message frequency limits per IP/connection (e.g., max N messages per second, burst capacity).
- [ ] Drop connections that consistently violate rate limits.

## Task 3: Smooth Remote Cursors
**Goal:** Animate cursor movements for a native, Figma-like feel.
- [ ] Investigate `src/core/CursorManager.ts`.
- [ ] VS Code decorators don't support native CSS transitions directly on the cursor position easily, but we can inject custom CSS using the `after` property or SVG icons.
- [ ] Implement interpolation or smooth movement logic if possible, or enhance the CSS injected via `createTextEditorDecorationType` to include `transition: all 0.1s ease-out`. (Note: VS Code editor decorators might not animate CSS properties reliably, we need to test what's possible, perhaps adding a CSS transition to the `before`/`after` pseudo-elements used for cursors).

## Task 4: Push-to-Talk & Voice Polish
**Goal:** Add a global PTT hotkey and visualize voice activity.
- [ ] Add a configuration setting or command for Push-to-Talk.
- [ ] Register a keyboard shortcut context or command for PTT (e.g., hold to unmute, release to mute).
- [ ] Update `src/ui/ParticipantsView.ts` and `src/ui/ChatView.ts` to show audio wave animations or active speaking indicators (partially done with `activityGlow`, need to enhance).

## Task 5: Offline Resilience & Reconnection UX
**Goal:** Hide error popups during transient network drops and show a Status Bar reconnecting state.
- [ ] Update `src/connection/WebSocketClient.ts` to manage reconnection states (e.g., `reconnecting`).
- [ ] Update `src/ui/StatusBarManager.ts` to show a spinning icon `$(sync~spin) Reconnecting...` instead of throwing error notifications immediately.
- [ ] Buffer local edits while offline and flush them upon successful reconnection (Yjs handles merging, but we need to ensure the messages are queued or resynced quietly).
- [ ] Ensure `DocumentSync` suppresses the "Document Desynced" warning if we are actively reconnecting.
