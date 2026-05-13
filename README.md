# CodeRooms

<p align="center">
  <img src="media/icon.png" alt="CodeRooms" width="128" />
</p>

**CodeRooms** is a production-grade, real-time collaborative coding environment for VS Code. It features high-performance CRDT synchronization, end-to-end encryption, and a horizontally scalable backend.

Real-time collaboration — no screen sharing, just shared buffers, roles, and integrated communication. CodeRooms pairs a robust Node.js coordination server with a native VS Code extension.

> **See [INSTALLATION.md](docs/INSTALLATION.md) for detailed setup instructions.**
>
> **See [SECURITY.md](docs/SECURITY.md) for the E2EE model and security review notes.**

---

## Features (V1.2)

| Area | What you get |
|------|-------------|
| **Sync Engine** | **Yjs CRDT:** Mathematically guaranteed document consistency. Supports massive files and complex concurrent edits without conflicts. |
| **Privacy (E2EE)** | **Full Binary E2EE:** Every keystroke and chat message is encrypted (AES-256-GCM) on the client before being sent. The server is "blind" to your code. |
| **Persistence** | **SQLite WAL:** Room state is saved atomically to a robust database. 100% crash-proof recovery. |
| **Scalability** | **Redis Pub/Sub:** Horizontally scalable backend. Run a cluster of CodeRooms servers to support thousands of concurrent developers. |
| **Voice Chat** | **E2EE P2P Voice:** Integrated audio communication via WebRTC. Secure, low-latency, and private. |
| **Shared Terminals** | Host can share read-only or read/write terminal access with collaborators directly in VS Code. |
| **Port Forwarding** | Secure localhost tunneling allows collaborators to access web apps running on the host's machine. |
| **Suggestion Mode** | Collaborator edits become inline suggestions. Root can review with **native CodeLenses** directly in the editor. |
| **Workspace Sharing** | Share single files or your **entire project workspace** with a single command, featuring native progress tracking. |
| **Modern UI** | Sleek, fast, minimalist flat Chat Webview with native VS Code styling and real-time activity glow. |
| **Protocol** | **Pure Binary:** Uses `Uint8Array` and `msgpackr`. 33% more efficient than JSON/Base64 engines. |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/mobta/CodeRooms.git
cd CodeRooms
npm install

# 2. Start the infrastructure (Optional but recommended for scale)
# Ensure Redis is running locally, then:
export REDIS_URL="redis://localhost:6379"

# 3. Build and start the server
npm run server:build
npm run server:start

# 4. Launch the extension
# Open the repo in VS Code → press F5 → "Run Extension"

# 5. Verify system health
npm run verify
```

In the Extension Development Host, run **CodeRooms: Start Room as Root** from the Command Palette.

---

## Commands

| Command | Description | Who |
|---------|-------------|-----|
| Start Room as Root | Create a new room as the owner | Anyone |
| Join Room | Join an existing room by ID | Anyone |
| Join Voice Channel | Start or join the E2EE audio bridge | Anyone |
| Share Entire Workspace | Recursively sync the project folder | Root |
| Share Terminal | Share a read-only or read/write terminal session | Root |
| Forward Port | Tunnel a localhost port to the room | Root |
| Share Current File | Share the active editor document | Root |
| Stop Sharing | Unshare the active document | Root |
| Accept / Reject | Native inline review actions for suggestions | Root |
| Toggle Follow Root | Follow or unfollow the root's cursor | Collaborator/Viewer |
| Export Room | Download all shared docs as a zip | Root |
| Open Chat | Native animated chat window | Anyone in room |

---

## Server Configuration

| Option | Env Variable | Default | Description |
|--------|----------|---------|-------------|
| Port | `CODEROOMS_PORT` | `5171` | Server listener port |
| Host | `CODEROOMS_HOST` | `127.0.0.1` | Server listener host |
| Redis | `REDIS_URL` | *(none)* | Enable horizontal scaling via Redis |
| Database | `rooms.db` | *(local)* | Automatic SQLite persistence |

---

## Security Architecture

CodeRooms implements a **Zero-Knowledge** architecture for document synchronization:
- **E2E Encryption:** All Yjs updates and chat messages are encrypted with **AES-256-GCM** using the Room Secret (derived via PBKDF2).
- **Binary Protocol:** Data is transmitted as opaque binary blobs.
- **Server Privacy:** The server only relays encrypted packets and manages room metadata. It physically cannot read the content of your files.
- **Persistence:** Metadata and encrypted snapshots are stored in **SQLite** with Write-Ahead Logging.

---

## Project Structure

```
CodeRooms/
├── src/                    # Extension source (TypeScript)
│   ├── core/               # Yjs Sync, RoomState, ChatManager
│   ├── connection/         # Binary WebSocket client
│   ├── ui/                 # Revamped ChatView, ParticipantsView
│   └── util/               # Binary Crypto, logger, room secrets
├── server/                 # Production-grade backend
│   ├── db.ts               # SQLite persistence layer
│   ├── redis.ts            # Scaling backplane
│   ├── server.ts           # Unified HTTP/WS server & voice bridge
│   ├── ot.ts               # Legacy OT (fallback only)
│   └── protocolValidation.ts # Strict binary payload validation
├── shared/                 # Shared protocol definitions
├── tests/                  # Robust test suite (246+ tests)
└── rooms.db                # Auto-generated database
```

---

## License

[MIT](LICENSE)
