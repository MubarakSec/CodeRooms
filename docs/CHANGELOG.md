# Changelog

All notable changes to CodeRooms will be documented in this file.

## [0.1.0] - 2024-01-01

### Added
- Real-time collaborative editing with WebSocket transport (msgpackr binary).
- Role-based rooms: root, collaborator, viewer.
- Team and classroom room modes.
- E2E AES-256-GCM chat encryption with PBKDF2-derived keys.
- Room secret authentication (PBKDF2, 100k iterations).
- Single-use invite token support (24h TTL).
- Suggestion workflow for collaborators (submit, accept, reject).
- Follow-root cursor tracking.
- Participant activity indicators (typing / idle).
- Room export (ZIP archive).
- Atomic room backup / restore on server.
- Rate limiting for join, chat, and suggestion endpoints.
- Runtime message validation on server.
- Path traversal protection in document storage.
- WSS / TLS support via `--cert` and `--key` flags.
- Content Security Policy for chat webview.
