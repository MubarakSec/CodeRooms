# Manual QA Checklist

Use this checklist when validating a CodeRooms release candidate in VS Code.

## Environment

- [ ] Test with a clean Extension Development Host or clean VS Code profile.
- [ ] Verify the configured `coderooms.serverUrl` matches the intended environment.
- [ ] If using TLS, verify the room uses `wss://` and the certificate is accepted cleanly.

## Core Room Flow

- [ ] Start a room as root and copy the room ID.
- [ ] Join from another VS Code window as a collaborator.
- [ ] Join from a third VS Code window as a viewer.
- [ ] Leave and reconnect each role at least once.

## Document Collaboration

- [ ] Root shares a file and collaborators receive it.
- [ ] Share multiple files and switch tabs manually while edits continue syncing.
- [ ] Verify collaborator direct-edit mode applies live edits.
- [ ] Verify suggestion mode queues edits instead of applying them directly.
- [ ] Unshare a file and confirm it disappears only after server confirmation.

## Suggestions

- [ ] Submit a single suggestion and verify it appears in the review queue.
- [ ] Accept a suggestion and verify document state updates once.
- [ ] Reject a suggestion and verify it clears from the review queue.
- [ ] Use bulk accept and bulk reject on a larger queue.
- [ ] Restart or reconnect with pending suggestions and verify replay to the owner.

## Presence and UI

- [ ] Participant roles, typing state, and current file labels update in the panel.
- [ ] The review queue groups and chunks large suggestion sets correctly.
- [ ] Chat remains usable after long message history and repeated sends.
- [ ] Status bar states are sensible for connecting, connected, reconnecting, and error.
- [ ] Keyboard shortcuts for panel/chat/reconnect still work.

## Recovery and Restart

- [ ] Disconnect the server briefly and verify auto-rejoin with the same session.
- [ ] Replay queued offline actions once after reconnect.
- [ ] Restart the server and verify recoverable room state restores without ghost participants.
- [ ] Verify owner reclaim works after restart.

## Security and Permissions

- [ ] Viewer edit actions fail closed.
- [ ] Owner-only actions stay blocked for collaborators and viewers.
- [ ] Protected rooms require the correct secret or invite token.
- [ ] Encrypted chat only decrypts when the correct room secret is used.

## Packaging

- [ ] Package the extension and install the `.vsix` into a clean profile.
- [ ] Run the same smoke path again against the packaged build.
- [ ] Record any environment-specific limitations in the release notes.
