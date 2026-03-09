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

---

## 1. Clone & Install

```bash
git clone https://github.com/mobta/CodeRooms.git
cd CodeRooms
npm install
```

This installs both extension and server dependencies (they share a single `package.json`).

---

## 2. Build the Server

```bash
npm run server:build
```

This compiles `server/*.ts` into `out-server/*.js` using TypeScript.

---

## 3. Start the Server

```bash
npm run server:start
```

The server will listen on `ws://127.0.0.1:5171` by default. You should see a JSON log line confirming the host and port.

### Customizing Host & Port

You can configure the server in three ways (highest priority first):

**CLI flags:**
```bash
node out-server/server.js --host 0.0.0.0 --port 8080
```

**Environment variables:**
```bash
CODEROOMS_HOST=0.0.0.0 CODEROOMS_PORT=8080 npm run server:start
```

**Config file** — create `coderooms.config.json` in the project root:
```json
{
  "host": "0.0.0.0",
  "port": 8080
}
```

---

## 4. Launch the Extension (Development Mode)

1. Open the `CodeRooms` folder in VS Code.
2. Press **F5** (or go to **Run and Debug → Run Extension**).
3. A new VS Code window (Extension Development Host) opens with CodeRooms active.
4. Open the Command Palette (`Ctrl+Shift+P`) and run **CodeRooms: Start Room as Root**.

> The extension connects to `ws://localhost:5171` by default. Change this in **Settings → CodeRooms → Server Url** if your server is on a different host/port.

---

## 5. Connecting a Second User

On the same machine or another machine:

1. Open VS Code with CodeRooms loaded (F5 from the repo, or install the `.vsix`).
2. Make sure the **Server Url** setting points to the same server (e.g. `ws://192.168.1.10:5171`).
3. Run **CodeRooms: Join Room** and paste the room ID shared by the root user.
4. If the room has a secret, you'll be prompted to enter it.

---

## 6. Packaging as a `.vsix` Extension

To install CodeRooms as a regular VS Code extension without running from source:

```bash
# Install the packaging tool (one-time)
npm install -g @vscode/vsce

# Build and package
npm run package
```

This produces a `coderooms-0.1.0.vsix` file. Install it in VS Code:

```bash
code --install-extension coderooms-0.1.0.vsix
```

Or in VS Code: **Extensions panel → ··· menu → Install from VSIX…**

> **Note:** The `.vsix` only contains the extension client. You still need to run the server separately.

---

## 7. Running the Server in Production

### Supported Deployment Model

- Local-only development: `ws://127.0.0.1:5171` is fine.
- Remote/shared deployment: use `wss://` with TLS enabled directly in CodeRooms or terminated at a reverse proxy.
- Plain remote `ws://`: treat as trusted-network-only, not the recommended production posture.

### Basic (no TLS)

```bash
npm run server:build
node out-server/server.js --host 0.0.0.0 --port 5171
```

### With TLS (wss://)

Provide certificate and key files:

```bash
node out-server/server.js \
  --host 0.0.0.0 \
  --port 5171 \
  --cert /path/to/fullchain.pem \
  --key /path/to/privkey.pem
```

Or via environment variables:

```bash
CODEROOMS_CERT=/path/to/fullchain.pem CODEROOMS_KEY=/path/to/privkey.pem node out-server/server.js
```

When TLS is enabled, the server creates an HTTPS/WSS listener. Point the extension at `wss://your-domain:5171`.

### Behind a Reverse Proxy (recommended)

If you prefer to terminate TLS at nginx or Caddy:

**nginx example:**
```nginx
server {
    listen 443 ssl;
    server_name coderooms.example.com;

    ssl_certificate     /etc/letsencrypt/live/coderooms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/coderooms.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5171;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

Then set the extension's server URL to `wss://coderooms.example.com`.

### Keeping the Server Running

Use a process manager like **pm2**:

```bash
npm install -g pm2
pm2 start out-server/server.js --name coderooms
pm2 save
pm2 startup   # auto-start on reboot
```

Or with **systemd** (Linux):

```ini
# /etc/systemd/system/coderooms.service
[Unit]
Description=CodeRooms WebSocket Server
After=network.target

[Service]
Type=simple
User=coderooms
WorkingDirectory=/opt/coderooms
ExecStart=/usr/bin/node out-server/server.js --host 0.0.0.0
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable coderooms
sudo systemctl start coderooms
```

---

## 8. Room Secrets & Encryption

When creating a room, you can optionally set a **room secret**:

- The secret is hashed server-side with **PBKDF2** (100 000 iterations, SHA-512). The server never stores the plaintext.
- Anyone joining the room must provide the same secret.
- If a secret is set, **chat messages are end-to-end encrypted** with AES-256-GCM — the server cannot read them.
- Document content is **not** encrypted in transit (only chat is E2E). Use TLS for transport security.

Share the room ID and secret through separate channels for best security.

---

## 9. Server Limits Reference

These are the server's built-in limits (not currently configurable at runtime):

| Limit | Value |
|-------|-------|
| Max connections per IP | 20 |
| Max rooms per IP | 10 |
| Max rooms globally | 500 |
| Max documents per room | 50 |
| Max document size | 2 MB |
| Total document memory | 256 MB |
| Max suggestions per room | 100 |
| Max chat messages per room | 500 |
| Max message payload | 512 KB |
| Max display name length | 50 chars |
| Invite token TTL | 24 hours |
| Idle room timeout | 10 minutes |

---

## 10. Running Tests

```bash
npm test
```

This runs the full [Vitest](https://vitest.dev/) suite — patch logic, OT transforms, crypto, chat, rate limiting, document sync, and integration tests.

For the full local verification pipeline:

```bash
npm run verify
```

To generate the guarded coverage report used in CI:

```bash
npm run test:coverage
```

To type-check without running:

```bash
npm run typecheck                           # extension
npx tsc -p server/tsconfig.json --noEmit    # server
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **"Cannot connect to server"** | Make sure the server is running and the `coderooms.serverUrl` setting matches the server's host:port. |
| **Extension commands don't appear** | The extension activates lazily. Type "CodeRooms" in the Command Palette to trigger activation. |
| **"Wrong secret" on join** | The room was created with a secret. Ask the room owner for it. |
| **Connection drops frequently** | The extension auto-reconnects with exponential backoff. If the server is behind a proxy, make sure WebSocket upgrade is configured and `proxy_read_timeout` is high enough. |
| **Server won't start (port in use)** | Another process is using port 5171. Use `--port` to pick a different one, or stop the other process. |
| **Tests fail on `out-server/patch.test.js`** | Build artifacts in `out-server/` are being picked up. Run `npm test` (not `vitest run` directly) — the npm script has the correct excludes. |
