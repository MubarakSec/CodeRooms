import { describe, expect, it } from 'vitest';
import {
  isPathInside,
  sanitizeRoomFolderName,
  sanitizeSharedFileName
} from '../src/core/storagePaths';

describe('storage path helpers', () => {
  it('sanitizes room folder names to safe local segments', () => {
    expect(sanitizeRoomFolderName('../ROOM1')).toBe('ROOM1');
    expect(sanitizeRoomFolderName('team room/../../secret')).toBe('secret');
    expect(sanitizeRoomFolderName('..')).toBe('room');
  });

  it('sanitizes shared file names and strips traversal characters', () => {
    expect(sanitizeSharedFileName('../notes.ts')).toBe('notes.ts');
    expect(sanitizeSharedFileName('weird<>:"name?.ts')).toBe('weird-name-.ts');
    expect(sanitizeSharedFileName('..')).toBe('shared-file.txt');
  });

  it('detects whether a path stays inside the storage base path', () => {
    expect(isPathInside('/tmp/base', '/tmp/base/file.txt')).toBe(true);
    expect(isPathInside('/tmp/base', '/tmp/base/nested/file.txt')).toBe(true);
    expect(isPathInside('/tmp/base', '/tmp/base/../escape.txt')).toBe(false);
    expect(isPathInside('/tmp/base', '/tmp/other/file.txt')).toBe(false);
  });
});
