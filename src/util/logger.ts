const PREFIX = "[CodeRooms]";
let debugEnabled = false;

export const logger = {
  setDebugLogging(enabled: boolean): void {
    debugEnabled = enabled;
  },
  info(message: string): void {
    if (!debugEnabled) {
      return;
    }
    console.log(`${PREFIX} INFO: ${message}`);
  },
  warn(message: string): void {
    console.warn(`${PREFIX} WARN: ${message}`);
  },
  error(message: string): void {
    console.error(`${PREFIX} ERROR: ${message}`);
  }
};
