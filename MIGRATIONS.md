# Persistence Migration Notes

This document records persisted-state compatibility expectations for CodeRooms.

## Current State

The server backup and local room metadata formats are explicitly versioned.

- Server room backups use schema-versioned persistence and quarantine corrupt payloads instead of loading them in place.
- Local extension room metadata is versioned separately from server room backups.
- Legacy persisted payloads continue to load through normalization paths where supported.

## What Requires Migration Review

Review persistence compatibility whenever changing:

- room backup schema
- stored document metadata or version tracking
- recoverable participant session fields
- suggestion persistence format
- local extension room metadata files

## Safe Change Process

1. Add or bump the stored schema version.
2. Add a normalization or upgrade path for older persisted payloads.
3. Add tests that load both the new format and the last supported format.
4. Document whether the change is backward-compatible, forward-compatible, or one-way.
5. Update [RECOVERY.md](RECOVERY.md) if restart semantics changed.

## Release Questions

Before shipping a persistence change, answer:

- Can an existing backup from the previous release still load?
- If not, is there an explicit conversion path?
- What happens if a mixed-version extension/server pair reconnects during the rollout?
- Will archived backups remain readable after the upgrade?
- Does the change affect operator expectations for recovery after restart?

## Current Compatibility Boundary

At the current milestone:

- Backup files from the current schema version are expected to restore directly.
- Older supported schema versions are normalized on load.
- Unsupported or corrupt payloads are quarantined rather than partially loaded.
- Invite tokens and other intentionally transient runtime values are still not migration targets.
