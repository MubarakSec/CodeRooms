# Troubleshooting and Logging

This guide covers the most common failure modes when running CodeRooms locally or behind a reverse proxy.

## Logging Guidance

### Extension-side

- Enable `coderooms.debugLogging` in VS Code settings when debugging client behavior.
- Open the Extension Development Host developer tools to inspect extension logs.
- Treat display names, room IDs, and file names as operational data; do not paste secrets or invite tokens into bug reports.

### Server-side

- Start the server from a terminal or supervisor that captures stdout/stderr.
- Keep logs for startup, restore, join failures, authz errors, backup writes, and unhandled exceptions.
- Do not log raw room secrets, invite tokens, or plaintext encrypted-chat payloads.

Recommended production logging fields:

- timestamp
- room ID
- session/user ID
- message type or action
- error code
- remote IP or proxy-forwarded source
- reconnect/session token presence as a boolean, not the token value

## Common Problems

### The extension cannot connect

Checks:

- Confirm the server is running on the configured `coderooms.serverUrl`.
- Verify `ws://` vs `wss://` matches your deployment.
- If using a reverse proxy, confirm WebSocket upgrade headers are forwarded.
- If using TLS, confirm the certificate matches the hostname.

### A room ID works locally but not remotely

Checks:

- The server must be reachable from every participant machine.
- Do not expose remote rooms over plain `ws://` except on a trusted network.
- If a proxy rewrites paths, confirm the VS Code setting points to the real WebSocket endpoint.

### Users keep getting `ROOM_ACCESS_DENIED`

Checks:

- Confirm they are using the correct room secret or unexpired invite token.
- Tokens are single-use and intentionally do not survive a server restart.
- Repeated failed joins are rate-limited, so wait for the backoff window before retrying aggressively.

### Shared files stop syncing

Checks:

- Run `CodeRooms: Reconnect` and verify the room is rejoined with the same session.
- Use a shared file tab, not an unrelated local file tab.
- Check the server logs for `PATCH_INVALID`, `CONFLICT`, or owner-unavailable errors.
- If needed, trigger a resync and confirm the owner is still connected for full-document recovery.

### Suggestions appear delayed or crowded

Checks:

- Open the review queue in the CodeRooms panel instead of relying on popups.
- Large suggestion sets are chunked by file and range; expand the file group first.
- If the owner has restarted, verify pending suggestions replay after rejoin.

### Chat works but messages look unreadable

Checks:

- Secret-protected rooms expect the same secret on every participant.
- If chat is E2E encrypted and the wrong secret is used, ciphertext cannot be decrypted into plaintext.
- Transport security still matters because shared documents are not end-to-end encrypted.

### Restore after restart looks incomplete

Checks:

- Review [RECOVERY.md](RECOVERY.md) to confirm which state is recoverable and which state is intentionally transient.
- Corrupt backups are quarantined and skipped rather than loaded in place.
- Invite tokens, live presence, cursor state, and transient notifications do not survive restart.

## Escalation Data To Capture

When filing or investigating a bug, capture:

- CodeRooms version/commit
- VS Code version
- server URL mode (`ws://` or `wss://`)
- exact room lifecycle sequence
- error code shown in the extension
- relevant server log lines
- whether the issue happened after reconnect or restart
