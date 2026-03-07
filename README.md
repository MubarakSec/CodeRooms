# CodeRooms

CodeRooms is a VSCode extension plus a lightweight Node.js WebSocket server for role-based, real-time collaboration. It keeps the workflow inside the editor: no screen sharing, just shared buffers, roles, and quick actions.

## Features
- Create/join rooms with roles (`root`, `collaborator`, `viewer`) and optional room secrets (hashed on the server).
- Root owners manage roles, toggle collaborator direct/suggestion modes, and share/unshare multiple documents per room.
- Live document sync with incremental patches and per-document versions; collaborators can follow the root cursor.
- Suggestion mode captures collaborator edits as patches the root can accept/reject; suggestions are also highlighted in the editor for the root.
- Participants tree + status bar shortcuts for room IDs, document switching, follow mode, and room admin actions.

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Build the extension**
   ```bash
   npm run compile
   ```
3. **Run tests (patch logic)**
   ```bash
   npm test
   ```
4. **Launch in VSCode**
   - Press `F5` (Run Extension) or use the "Run and Debug" panel with the default launch config. The extension activates when any CodeRooms command is invoked.

## Running the coordination server
The server lives in `server/server.ts` (TypeScript + `ws`). Build and run:
```bash
npm run server:build   # emits JS into out-server/
npm run server:start   # starts the WebSocket server
```
CLI flags and env:
- `--port` (default `5171`), `--host` (default `127.0.0.1` or `CODEROOMS_HOST`)
- Environment overrides: `CODEROOMS_PORT`, `CODEROOMS_HOST`
- Optional config file: place `coderooms.config.json` next to `server/server.ts` with `{ "host": "0.0.0.0", "port": 5171 }` to set defaults.

At startup the server logs a JSON line with the chosen host/port. Point the extension at your server via **Settings → CodeRooms → Server Url**.

## Extension configuration
- `coderooms.serverUrl`: WebSocket URL for the coordination server.
- `coderooms.mode`: default room mode (`team` or `classroom`).
- Room secrets: When creating or joining, you can enter a secret. If a room is secret-protected, joining without the secret or with a wrong one returns a clear error.

## Commands (high level)
- Start/Join/Leave room; Copy room ID; Export room archive (root).
- Share current file / Share another file (root), stop sharing active file (root), set active shared document.
- Toggle collaborator mode (direct vs suggestion), toggle follow-root cursor (collaborators).
- Role management (root): change role, kick to viewer mode.
- Accept/Reject suggestions (root).

## Security notes (MVP)
- In-memory server state; no persistence for rooms beyond in-process memory.
- No TLS termination is provided; run behind a TLS-terminating reverse proxy for internet use.
- Room secrets are hashed with SHA-256 on the server; basic rate limiting applies to join failures per IP.
- Document data is stored locally on each participant machine; exported archives are not encrypted.
