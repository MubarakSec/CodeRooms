# Changelog

All notable changes to the **CodeRooms** project will be documented in this file.

## [1.2.0] - 2026-05-11

### Added
- **E2EE Voice Chat:** Integrated audio communication using WebRTC with End-to-End Encryption.
- **Pure Binary Protocol:** Moved to 100% binary transport (`Uint8Array`) for all synchronization and signaling.
- **Yjs Awareness:** Integrated cursor and presence tracking directly into the CRDT engine for perfect alignment.
- **Workspace Sharing:** New `Share Entire Workspace` command to recursively sync project folders with progress tracking.
- **Production Persistence:** Replaced file-based backups with a robust **SQLite (WAL mode)** database.
- **Horizontal Scaling:** Added **Redis Pub/Sub** support to allow server clustering.
- **Modern UI:** Completely revamped Chat View with bubbles, animations, and native VS Code aesthetic.
- **Inline Review:** Native CodeLenses for 1-click Accept/Reject of suggestions in the editor.

### Changed
- Refactored entire document synchronization to use **Yjs CRDTs** instead of legacy 1D OT.
- Upgraded encryption layer to support raw binary blobs for 33% better performance.
- Unified the server into a single HTTP/WS engine to serve the Voice Bridge.

### Fixed
- Resolved silent data loss in the outbound message queue during network drops.
- Fixed duplicate patch application during reconnection.
- Eliminated 40ms UI delay in the chat rendering pipeline.

## [0.1.0] - 2026-03-09
- Initial prototype release.
- Role-based rooms with 1D Operational Transformation.
- E2EE Chat (text only).
- Basic Suggestion/Classroom mode.
