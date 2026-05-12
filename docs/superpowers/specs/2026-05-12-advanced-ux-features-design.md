# Design Spec: Advanced UX Features (Focus, Active Cursors, Voice Polish)

**Date:** 2026-05-12
**Topic:** Advanced UX & Real-time Feedback
**Status:** Approved

## 1. Objective
Enhance the CodeRooms experience with immersive features that provide better feedback on collaborator activity and a more focused environment for pairing.

## 2. Focus Mode
- **Requirement:** Provide a single command to enter a distraction-free state.
- **Implementation:**
  - Register command `coderooms.toggleFocusMode`.
  - Execute `workbench.action.toggleZenMode`.
  - Map this command to the View Title menu of the CodeRooms sidebar for easy access.

## 3. Active Cursors (Typing Highlights)
- **Requirement:** Visually indicate when a remote user is actively typing.
- **Visuals:**
  - Introduce an `activityGlow` decoration type in `CursorManager`.
  - Style: `backgroundColor: color + '40'` (25% opacity) with a `borderRadius: '4px'`.
- **Logic:**
  - Update `CursorManager.updateCursor` to accept an `isTyping` flag.
  - When `isTyping` is true, apply the glow decoration at the current cursor position.
  - Implement a 2000ms timeout that clears the glow if no new typing activity is received.
  - Ensure the glow follows the cursor as it moves during a typing burst.

## 4. Voice UI Polish (Animated Waves)
- **Requirement:** Show real-time talking indicators in the participant list.
- **Protocol Changes:**
  - Add `type: "voiceActivity", roomId: string, userId: string, talking: boolean` to `ClientToServerMessage` and `ServerToClientMessage`.
- **Voice Bridge (Browser):**
  - Use `AudioContext` and `AnalyserNode` to monitor microphone volume levels.
  - Send a `voiceActivity` message when volume crosses a threshold (e.g., -50dB) for more than 100ms.
  - Send `talking: false` after 500ms of silence.
- **Extension UI:**
  - Update `RoomState` to track `talkingParticipants: Set<string>`.
  - Update `viewState.ts` and `ParticipantsView.ts` to show the `$(pulse)` animated icon next to talking users.
  - Ensure the UI refreshes immediately when a voice activity message arrives.

## 5. Testing & Validation
- **Focus Mode:** Verify toggle works as expected and returns to previous state.
- **Active Cursors:** Stress test with multiple users typing simultaneously. Ensure memory cleanup of decorations.
- **Voice Polish:** Simulate `voiceActivity` messages to verify the Sidebar icon animates correctly.
