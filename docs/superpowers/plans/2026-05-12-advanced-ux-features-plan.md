# Advanced UX Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Focus Mode, Active Cursors with typing highlights, and Voice UI Polish with animated talking indicators.

**Architecture:** Native command pass-through for Focus Mode; decoration-based highlights for cursors; protocol-driven voice activity signaling.

**Tech Stack:** TypeScript, VS Code API, WebAudio API (in voice bridge).

---

### Task 1: Focus Mode Command

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`

- [ ] **Step 1: Register Command in package.json**
Add `coderooms.toggleFocusMode` to `contributes.commands` and `view/title` menu for the `coderoomsParticipants` and `coderoomsPanel` views.
```json
{
  "command": "coderooms.toggleFocusMode",
  "title": "CodeRooms: Toggle Focus Mode",
  "icon": "$(screen-full)"
}
```

- [ ] **Step 2: Implement Command in extension.ts**
Register the command handler.
```typescript
vscode.commands.registerCommand('coderooms.toggleFocusMode', () => {
  void vscode.commands.executeCommand('workbench.action.toggleZenMode');
});
```

- [ ] **Step 3: Commit**
```bash
git add package.json src/extension.ts
git commit -m "feat(ux): add toggle focus mode command"
```

---

### Task 2: Active Cursors (Typing Highlights)

**Files:**
- Modify: `src/core/CursorManager.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Update CursorManager for Activity Glow**
Add `activityGlow` decoration type and logic to apply/clear it based on a timeout.
```typescript
// In CursorManager
private activityTimers = new Map<string, NodeJS.Timeout>();
// ...
public setActivity(userId: string, active: boolean) {
  if (active) {
    // apply highlight
  } else {
    // remove highlight
  }
}
```

- [ ] **Step 2: Trigger Activity from extension.ts**
When a `participantActivity` message with `activity: "typing"` is received, call `cursorManager.setActivity`.

- [ ] **Step 3: Commit**
```bash
git add src/core/CursorManager.ts src/extension.ts
git commit -m "feat(ux): add typing highlights to remote cursors"
```

---

### Task 3: Voice Activity Protocol & Server

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `server/server.ts`

- [ ] **Step 1: Update Protocol**
Add `voiceActivity` message type.
```typescript
| { type: "voiceActivity"; roomId: string; userId: string; talking: boolean }
```

- [ ] **Step 2: Update Server Broadcast**
Handle `voiceActivity` in `server.ts` and broadcast it to the room.

- [ ] **Step 3: Commit**
```bash
git add shared/protocol.ts server/server.ts
git commit -m "feat(protocol): add voice activity signaling"
```

---

### Task 4: Voice Bridge Activity Detection

**Files:**
- Modify: `server/server.ts` (renderVoiceBridgeHtml)

- [ ] **Step 1: Implement Volume Detection**
Add WebAudio API logic to the voice bridge HTML template.
```javascript
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioContext.createAnalyser();
// Detect volume spikes and send message back to server
```

- [ ] **Step 2: Commit**
```bash
git add server/server.ts
git commit -m "feat(voice): implement volume detection in voice bridge"
```

---

### Task 5: Extension Voice UI

**Files:**
- Modify: `src/core/RoomState.ts`
- Modify: `src/ui/viewState.ts`
- Modify: `src/ui/ParticipantsView.ts`

- [ ] **Step 1: Track Talking State**
Update `RoomState` to store which participants are currently talking.

- [ ] **Step 2: Update View Models**
Update `buildParticipantViewModel` to include a `isTalking` flag and set the icon to `$(pulse)` if talking.

- [ ] **Step 3: Commit**
```bash
git add src/core/RoomState.ts src/ui/viewState.ts src/ui/ParticipantsView.ts
git commit -m "feat(ux): add talking indicators to participant list"
```
