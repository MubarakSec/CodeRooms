import Database from 'better-sqlite3';
import path from 'path';
import { PersistedRoomState } from './backupPersistence';

const dbPath = path.join(process.cwd(), 'rooms.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    roomId TEXT PRIMARY KEY,
    state JSON NOT NULL
  );
`);

export function saveRoomToDb(roomId: string, state: PersistedRoomState): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO rooms (roomId, state) VALUES (?, ?)');
  stmt.run(roomId, JSON.stringify(state));
}

export function loadRoomsFromDb(): Record<string, PersistedRoomState> {
  const stmt = db.prepare('SELECT roomId, state FROM rooms');
  const rows = stmt.all() as { roomId: string; state: string }[];
  const rooms: Record<string, PersistedRoomState> = {};
  for (const row of rows) {
    rooms[row.roomId] = JSON.parse(row.state) as PersistedRoomState;
  }
  return rooms;
}

export function deleteRoomFromDb(roomId: string): void {
  const stmt = db.prepare('DELETE FROM rooms WHERE roomId = ?');
  stmt.run(roomId);
}

export function vacuumDb(): void {
  db.exec('VACUUM');
}
