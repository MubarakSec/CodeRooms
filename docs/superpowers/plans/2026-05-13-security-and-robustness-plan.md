# Security and Robustness Implementation Plan

**Goal:** Implement Zero-Knowledge secret hashing, State Vector sync, and UI flattening.

## Task 1: Security - Client-side Secret Hashing
- [ ] **Step 1: Implement Hashing Utility.** Add `deriveRoomAccessKey(secret: string, roomId: string): string` to `src/util/crypto.ts`. Use SHA-256.
- [ ] **Step 2: Update Client.** In `src/extension.ts`, hash the secret in `startRoom` and `joinRoom` before calling `webSocket.send`.
- [ ] **Step 3: Update Server.** Modify `server/server.ts` and `server/joinAccess.ts` to treat the incoming `secret` as already hashed. The server should still hash it one more time for DB storage (standard practice).
- [ ] **Step 4: Verify.** Ensure E2E encryption still works (it uses the raw secret which stays in memory).

## Task 2: Robustness - Yjs State Vector Sync
- [ ] **Step 1: Update Protocol.** Add `stateVector?: Uint8Array` to `joinRoom` message.
- [ ] **Step 2: Client Reconnect.** When reconnecting, send the state vector for each shared document.
- [ ] **Step 3: Server Response.** Update server to send only missing updates instead of the full document if a state vector is provided.

## Task 3: UI - Flattening
- [ ] **Step 1: Remove Backdrop Filters.** Remove all `backdrop-filter` and `-webkit-backdrop-filter` from `src/ui/ChatView.ts`.
- [ ] **Step 2: Solid Backgrounds.** Ensure all UI elements use solid colors from VS Code variables.

