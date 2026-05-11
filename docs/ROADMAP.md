# CodeRooms Roadmap

## Purpose

This roadmap documents the journey of CodeRooms from a prototype to a production-grade, secure collaboration suite. 

## North Star

CodeRooms should provide a "VS Code Native" experience for real-time collaboration that is faster, more private, and more scalable than any other open-source alternative.

## 🏆 Current Status: V1.2 (Overhaul Complete)

We have successfully moved beyond the original roadmap into a high-performance architectural state.

### Completed Milestones (2026)

- **[V1.0] Production Infrastructure**
    - [x] **SQLite Persistence:** Replaced JSON backups with a robust SQLite WAL database.
    - [x] **Horizontal Scalability:** Integrated Redis Pub/Sub for server clustering.
    - [x] **Yjs CRDT Engine:** Replaced fragile 1D OT with mathematically guaranteed Yjs CRDTs.

- **[V1.1] Protocol & Performance**
    - [x] **Pure Binary Protocol:** Moved to 100% binary transport (`Uint8Array`) via `msgpackr`.
    - [x] **Zero-Knowledge E2EE:** Implemented full End-to-End Encryption for documents and chat.
    - [x] **Yjs Awareness:** Integrated cursor and presence tracking directly into the CRDT stream.
    - [x] **Workspace Sharing:** Multi-file recursive project synchronization.

- **[V1.2] Communication & UI**
    - [x] **E2EE Voice Chat:** Integrated WebRTC audio bridge with browser-bridge technology.
    - [x] **UI/UX Revamp:** Modern animated Chat Webview with native VS Code aesthetic.
    - [x] **Inline Suggestion Review:** Integrated CodeLenses for seamless editor-based reviews.

---

## Future Goals (The Path to V2.0)

### Milestone 9: Advanced Shared Terminal
- [ ] Share terminals with interactive PTY support.
- [ ] Role-based terminal permissions (Viewer vs. Interactor).
- [ ] E2EE terminal streams.

### Milestone 10: Port Forwarding
- [ ] Automate sharing of local development ports (e.g., localhost:3000).
- [ ] Native VS Code integration for "Open in Browser" on guest machines.

### Milestone 11: Cross-IDE Support
- [ ] Build a headless CLI client for CodeRooms.
- [ ] Investigate a JetBrains plugin or web-based editor bridge.

---

## Guiding Principles

- **Zero-Knowledge:** The server never sees the code.
- **Native Experience:** Respect VS Code's design language and performance budgets.
- **Scale:** Design for clusters (Redis), not just single processes.
- **Correctness:** 100% test pass rate for all collaboration edge cases.

## Success Criteria (V1.2 Green)

- [x] Room restart/recovery is 100% trustworthy (SQLite).
- [x] Multi-document collaboration is mathematically stable (Yjs).
- [x] Full End-to-End Encryption for all data (AES-GCM).
- [x] Performance is optimal via pure binary transport.
- [x] Voice communication is integrated and private.
