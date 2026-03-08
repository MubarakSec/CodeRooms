# Release Checklist

Use this checklist before tagging or shipping a CodeRooms release candidate.

## Automated Gates

- [ ] `npm run verify` passes locally.
- [ ] `npm run test:coverage` passes locally.
- [ ] CI is green for the current branch/PR.
- [ ] No unexpected diffs remain in generated outputs or backups.

## Room Lifecycle

- [ ] Create a room, disconnect the root, reconnect with the same session token, and verify ownership is reclaimed.
- [ ] Join room A, switch to room B, and verify no ghost participants remain in room A.
- [ ] Leave as root and verify collaborators receive a room-closed error and cleanly disconnect.
- [ ] Restart from a persisted backup and verify recoverable sessions restore without reviving stale live participants.

## Reconnect and Replay

- [ ] Queue tracked edits while offline, reconnect, and verify they replay once with terminal `ack`/`error`.
- [ ] Reconnect while a full-document sync is pending and verify the client reconciles back to the server snapshot.
- [ ] Reconnect the root while collaborators remain active and verify participant state stays consistent.

## Suggestions

- [ ] Submit suggestions as a collaborator in suggestion mode and verify the root sees them in the review queue.
- [ ] Accept and reject single suggestions and verify the server remains authoritative for document updates.
- [ ] Run bulk accept/reject from the review queue and verify both client and server state are cleared or transitioned.
- [ ] Restart or rejoin with pending suggestions and verify they replay to the room owner.

## Multi-Document Sync

- [ ] Share two documents, switch tabs manually, and verify edits continue syncing in both files.
- [ ] Unshare a file and verify removal waits for the server confirmation path.
- [ ] Force a document resync and verify the UI recovers without duplicate patch replay.

## Security and Operational Checks

- [ ] Verify viewer chat/edit restrictions and owner-only actions still fail closed.
- [ ] Verify TLS / reverse-proxy configuration matches the supported deployment model in [SECURITY.md](SECURITY.md).
- [ ] Review logs for missing stack traces, leaked secrets, or noisy unhandled errors during the release run.
- [ ] Confirm backup files can be written and restored on the target environment.

## Packaging and Sign-Off

- [ ] Build the server with `npm run server:build`.
- [ ] Package the extension with `npm run package`.
- [ ] Smoke-test the packaged extension in a clean VS Code profile.
- [ ] Record the release commit, CI run, and known limitations in the release notes.
