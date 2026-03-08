import * as path from 'path';

export function sanitizeRoomFolderName(roomId: string): string {
  const baseName = path.basename(roomId);
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/-+/g, '-')
    .slice(0, 80);

  return sanitized || 'room';
}

export function sanitizeSharedFileName(fileName: string): string {
  const baseName = path.basename(fileName);
  const sanitized = baseName
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\.\./g, '')
    .trim();

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return 'shared-file.txt';
  }

  return sanitized.slice(0, 255);
}

export function isPathInside(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
