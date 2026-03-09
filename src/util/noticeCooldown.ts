export class NoticeCooldown {
  private readonly lastShownAt = new Map<string, number>();

  shouldShow(key: string, cooldownMs: number, now = Date.now()): boolean {
    if (cooldownMs <= 0) {
      return true;
    }
    const lastShownAt = this.lastShownAt.get(key);
    if (lastShownAt !== undefined && now - lastShownAt < cooldownMs) {
      return false;
    }
    this.lastShownAt.set(key, now);
    return true;
  }

  clear(): void {
    this.lastShownAt.clear();
  }
}
