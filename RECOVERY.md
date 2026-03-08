# Recovery Semantics

This document defines what CodeRooms persists, what it restores after a server restart, and what is intentionally treated as transient runtime state.

## What Survives Restart

The server backup stores room state that is safe to recover:

- Room identity and mode.
- The owner recovery session token and owner IP accounting.
- Recoverable participant sessions, including display name, role, and direct-edit mode.
- Shared document state: `docId`, text, version, URI metadata, file name, and language ID.
- Pending suggestion records that still need owner review.
- Recent persisted room chat history.
- Secret hash for protected rooms.

## What Does Not Survive Restart

These values are intentionally rebuilt or discarded on process restart:

- Live socket connections.
- Active participant presence in the room tree.
- Cursor positions and typing/idle activity.
- In-memory patch history used only for short-term OT replay.
- Invite tokens generated before the restart.
- Local extension UI state such as expanded views, active tree selection, or transient notifications.

After restart, participants rejoin using their session token. The room owner can reclaim ownership through the persisted owner session instead of relying on the old transient socket `userId`.

## Recovery Rules

- Restored rooms start with no live participants connected.
- Pending suggestions replay to the owner after the owner rejoins.
- Shared documents restore with their last persisted text and version.
- Corrupt backup payloads are quarantined and skipped instead of being loaded in place.
- Backup files are versioned so future persistence migrations can be handled explicitly.

## Operational Notes

- The primary room backup is written atomically through a temp file and rename.
- The server also keeps timestamped archived backups and prunes older archives.
- Startup rebuilds aggregate accounting from restored rooms, including total document bytes and per-owner-IP room counts.
- Local extension room storage has its own retention cleanup and is not the authoritative source of shared room state.
