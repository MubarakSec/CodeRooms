# CodeRooms Security Model (V1.2)

CodeRooms is designed with a **Zero-Knowledge Architecture**. The core design principle is that the server should never be able to read your proprietary code or chat messages.

## 1. End-to-End Encryption (E2EE)

Every data packet containing code or chat is encrypted on the client *before* it is transmitted to the server.

*   **Algorithm:** AES-256-GCM (Authenticated Encryption).
*   **Key Derivation:** PBKDF2 (SHA-512, 100,000 iterations) derived from the Room Secret and Room ID.
*   **Encrypted Scopes:**
    *   **Documents:** Every Yjs CRDT update is encrypted as a binary blob.
    *   **Chat:** All messages are encrypted.
    *   **Voice Signaling:** WebRTC offers and answers are encrypted.
*   **Server Visibility:** The server only sees opaque binary blobs and room metadata (Room ID, participant list, role assignments). It physically cannot decrypt the document content.

## 2. Server-Side Guardrails

Even though the server is "blind" to the code, it implements strict infrastructure security:

*   **SQLite Persistence:** Room state is stored in an atomic SQLite database. Snapshots of the CRDT state are stored as encrypted blobs.
*   **Protocol Validation:** Every incoming binary message is strictly validated against a schema. Malformed or oversized payloads are rejected to prevent memory exhaustion.
*   **Rate Limiting:**
    *   **Join Limiter:** Prevents brute-forcing of room IDs.
    *   **Chat/Suggestion Limiter:** Prevents spam.
    *   **Connection Limiter:** Caps the number of connections per IP address.
*   **Role-Based Access Control (RBAC):** The server enforces roles (`root`, `collaborator`, `viewer`) at the protocol level. A `viewer` who attempts to send an edit will be rejected by the server even if their client is compromised.

## 3. Data Privacy

*   **Self-Hosting:** Unlike proprietary tools, you own the CodeRooms server. You can run it on your private intranet behind a VPN.
*   **No Tracking:** The server does not track user behavior or analytics beyond standard operational logging.
*   **Redis Isolation:** If using Redis for horizontal scaling, all data passing through Redis is the same encrypted binary blobs used by the clients.

## 4. Recommendations for Production

1.  **TLS/SSL:** Always run the CodeRooms server with TLS enabled (`--cert` and `--key` flags) or behind a TLS-terminating reverse proxy (like Nginx or Caddy).
2.  **Strong Secrets:** Encourage users to use the auto-generated word-based room secrets, which provide high entropy.
3.  **Redis Security:** If deploying a cluster, ensure the Redis instance is not publicly accessible and uses a strong password.
