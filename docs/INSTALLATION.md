# Installation Guide

Step-by-step instructions to get CodeRooms running locally, on a remote server, or installed as a packaged VS Code extension.

---

## Prerequisites

| Tool | Minimum Version | Check |
|------|----------------|-------|
| **Node.js** | 18+ | `node -v` |
| **npm** | 9+ | `npm -v` |
| **VS Code** | 1.80+ | `code --version` |
| **Git** | any | `git --version` |
| **Redis** (Optional) | 6+ | `redis-server --version` |

---

## 1. Clone & Install

```bash
git clone https://github.com/mobta/CodeRooms.git
cd CodeRooms
npm install
```

This installs both extension and server dependencies.

---

## 2. Start Infrastructure (Optional)

For production or clustering, start a **Redis** instance. If Redis is detected via the `REDIS_URL` environment variable, CodeRooms will automatically enable horizontal scaling.

```bash
# Example: Local Redis
docker run -d -p 6379:6379 redis
export REDIS_URL="redis://localhost:6379"
```

---

## 3. Build & Start the Server

```bash
npm run server:build
npm run server:start
```

The server will listen on `ws://127.0.0.1:5171` by default and automatically initialize the **SQLite** database (`rooms.db`) in the root directory.

---

## 4. Launch the Extension (Development Mode)

1. Open the `CodeRooms` folder in VS Code.
2. Press **F5** (or go to **Run and Debug → Run Extension**).
3. A new VS Code window (Extension Development Host) opens.
4. Run **CodeRooms: Start Room as Root** from the Command Palette.

---

## 5. Security & Encryption

CodeRooms uses a **Zero-Knowledge** model:
- **Full E2EE:** Both chat and code documents are end-to-end encrypted with AES-256-GCM.
- **Room Secret:** You must set a room secret to enable encryption. This secret is never sent to the server in plaintext.
- **Binary Protocol:** All data is sent as compact binary blobs.

---

## 6. Running in Production

### Behind a Reverse Proxy (Recommended)

Point your proxy (Nginx/Caddy) to the CodeRooms port. Ensure WebSocket upgrades are enabled.

**Nginx Config:**
```nginx
location / {
    proxy_pass http://127.0.0.1:5171;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

### Clustering with Redis

To handle high load, run multiple server instances on different ports/machines and point them all to the same **Redis** instance and **SQLite** database (if shared via network mount) or use a central DB if adapted.

```bash
REDIS_URL="redis://your-redis-host:6379" CODEROOMS_PORT=5171 npm run server:start
REDIS_URL="redis://your-redis-host:6379" CODEROOMS_PORT=5172 npm run server:start
```

---

## 7. Troubleshooting

| Problem | Fix |
|---------|-----|
| **"Cannot connect"** | Verify `coderooms.serverUrl` in VS Code settings. |
| **"Permission Denied"** | Ensure the server has write access to create `rooms.db`. |
| **Laggy Sync** | Ensure you are using the V1.1 binary protocol (included in latest release). Check CPU usage on the Extension Host. |
| **Voice Fails** | Voice requires an external browser tab. Ensure your browser is not blocking microphone access for the CodeRooms server URL. |
