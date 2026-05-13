# CodeRooms Product Enhancement Plan: Advanced Collaboration

**Goal:** Elevate CodeRooms from a real-time code editor to a complete remote pairing environment by implementing Shared Terminals and Local Network Tunneling (Port Forwarding).

## Phase 1: Shared Terminals (Read-Only)
**Objective:** Allow collaborators to view the host's terminal output in real-time (e.g., watching a build process or test run).

- [ ] **Step 1: Protocol Updates**
  - Add message types to `shared/protocol.ts`:
    - `terminalCreate`: Host notifies room a terminal is shared (includes terminal ID, name).
    - `terminalData`: Host sends terminal output chunks (stdout/stderr).
    - `terminalClose`: Host stops sharing the terminal.

- [ ] **Step 2: Host Side Capture (Extension)**
  - In `src/extension.ts`, create a `TerminalManager` class.
  - Add a command: `CodeRooms: Share Terminal`.
  - When invoked, use `vscode.window.onDidWriteTerminalData` to capture output from the active terminal.
  - Batch and send `terminalData` messages to the coordination server.

- [ ] **Step 3: Collaborator Side Rendering (Extension)**
  - When receiving `terminalCreate`, use `vscode.window.createTerminal` with a `vscode.Pseudoterminal` implementation.
  - When receiving `terminalData`, write the chunk into the `Pseudoterminal`'s `onDidWrite` event emitter so it renders in the collaborator's VS Code panel.

## Phase 2: Shared Terminals (Interactive/Read-Write)
**Objective:** Allow trusted collaborators (e.g., roles 'collaborator' or 'admin') to execute commands in the host's terminal. *Security is paramount here.*

- [ ] **Step 1: Security & Permissions**
  - Update `shared/protocol.ts` to include `terminalInput` (sent from collaborator to host).
  - Ensure the Host explicitly grants "Write Access" when sharing the terminal.

- [ ] **Step 2: Input Routing**
  - Collaborator's `Pseudoterminal` captures keystrokes via `onDidInput`.
  - Send keystrokes as `terminalInput` messages to the server.
  - The Host receives `terminalInput` and injects the keystrokes into the actual terminal.

## Phase 3: Localhost Port Forwarding (Tunneling)
**Objective:** Allow collaborators to access a web server running on the Host's `localhost` (e.g., a React app on port 3000) directly from their own browser.

- [ ] **Step 1: Protocol Updates**
  - Add message types to `shared/protocol.ts`:
    - `tunnelStart`: Host advertises a shared port.
    - `tunnelRequest`: Collaborator requests an HTTP path (e.g., `GET /index.html`).
    - `tunnelResponse`: Host returns the HTTP response headers and body payload.

- [ ] **Step 2: Extension UI & Host Proxy**
  - Add command: `CodeRooms: Forward Port`.
  - When a `tunnelRequest` arrives, the Host extension makes a local HTTP request (using Node's `http` module) to the requested port on their own machine.
  - The Host captures the response (headers, status, body) and sends it back via `tunnelResponse`.

- [ ] **Step 3: Collaborator Local Server**
  - When the Host shares a port (e.g., 3000), the Collaborator extension spins up a local Node.js HTTP server on a random open port (or the same port if available).
  - When the Collaborator opens their browser to this local server, the extension intercepts the request, pauses it, sends a `tunnelRequest` to the Host over the CodeRooms WebSocket, waits for the `tunnelResponse`, and flushes the data to the browser.
