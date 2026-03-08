# Security Review Notes

This document records the current security posture that was reviewed while hardening Milestones 1 through 6.

## Supported Deployment Model

- Local development may use `ws://127.0.0.1:5171`.
- Remote/shared deployments should use `wss://` with TLS enabled either directly in CodeRooms or through a reverse proxy.
- Plain remote `ws://` should be treated as trusted-network-only and not as the recommended production posture.

## Access Control Review

- Privileged actions are checked server-side in `server/authorization.ts`.
- Suggestion author identity is derived from the authenticated participant, not trusted from client payloads.
- Reconnect session identity is separate from transient socket `userId`.

## Input Validation Review

- Client messages are validated centrally in `server/protocolValidation.ts`.
- Patch payloads now require ordered ranges and bounded sizes.
- Cursor selection arrays, invite labels, IDs, room IDs, and auth fields are capped.

## Replay and Duplicate Request Review

- Tracked outbound document/chat/suggestion actions use ack keys from `shared/ackKeys.ts`.
- Duplicate join/create races are blocked by `server/roomOperationGuards.ts`.
- Duplicate suggestion submission is treated as idempotent only when the payload matches exactly; conflicting replays are rejected.
- Share/unshare and reviewed-suggestion decisions are now idempotent with explicit terminal behavior.

## Sensitive Data and Logging Review

- Room secrets are hashed with PBKDF2 and plaintext secrets are not persisted.
- Invite tokens and room secrets are not logged in server event logs.
- Chat content may be end-to-end encrypted, but shared document content is not E2E encrypted and therefore still depends on transport security.

## Abuse and Rate Limiting Review

- Join, chat, suggestion, cursor, and participant-activity paths are rate-limited.
- Connection and room creation are bounded per IP.
- Document size, total server document bytes, suggestion counts, and message payload sizes are capped.
